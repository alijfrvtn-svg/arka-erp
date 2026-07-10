-- =============================================================================
--  ARKA ADS STUDIO — 05 — Posting Engine, Reversal, Fiscal Close
--  -------------------------------------------------------------------------
--  All balance mutations funnel through these SECURITY DEFINER functions so
--  the invariants can never be bypassed by ad-hoc SQL from the app pool.
--    * fn_post_journal_entry   — validates + locks accounts in id order + posts
--    * fn_reverse_journal_entry — books a mirror entry, marks original REVERSED
--    * fn_recompute_account_balance — self-healing recompute from posted lines
--    * fn_close_fiscal_period  — advisory-locked year/period close to Retained
-- =============================================================================
SET search_path TO arka, public;

-- ---------------------------------------------------------------------------
--  POST — the single mutating gate for the ledger.
--  Deadlock avoidance: every concurrent poster acquires account row locks in
--  ascending id order, so no two transactions can build a lock cycle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arka.fn_post_journal_entry(
    p_entry_id UUID,
    p_actor    UUID DEFAULT NULL
) RETURNS arka.journal_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arka, public
AS $$
DECLARE
    v_entry   arka.journal_entries;
    v_period  arka.fiscal_periods;
    v_debit   NUMERIC(78,0);
    v_credit  NUMERIC(78,0);
    v_lines   INTEGER;
BEGIN
    -- 1) Serialise on the header row.
    SELECT * INTO v_entry FROM arka.journal_entries
      WHERE id = p_entry_id AND deleted_at IS NULL
      FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'journal entry % not found', p_entry_id USING ERRCODE = 'no_data_found';
    END IF;
    IF v_entry.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'journal entry % is % and cannot be posted', v_entry.entry_no, v_entry.status
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 2) Fiscal period must exist and be OPEN.
    v_period := arka.fn_period_for_date(v_entry.entry_date);
    IF v_period.id IS NULL THEN
        RAISE EXCEPTION 'no fiscal period defined for date %', v_entry.entry_date;
    END IF;
    IF v_period.status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period %/% is % — posting rejected',
            v_period.year_code, v_period.period_no, v_period.status;
    END IF;

    -- 3) Balance validation.
    SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*)
      INTO v_debit, v_credit, v_lines
      FROM arka.journal_lines WHERE entry_id = p_entry_id;
    IF v_lines < 2 THEN
        RAISE EXCEPTION 'entry % must have >= 2 lines', v_entry.entry_no;
    END IF;
    IF v_debit <> v_credit THEN
        RAISE EXCEPTION 'entry % unbalanced: debit=% credit=%', v_entry.entry_no, v_debit, v_credit;
    END IF;

    -- 4) Lock every involved account row in deterministic (ascending id) order.
    PERFORM 1 FROM arka.accounts
      WHERE id IN (SELECT DISTINCT account_id FROM arka.journal_lines WHERE entry_id = p_entry_id)
      ORDER BY id
      FOR UPDATE;

    -- 5) Atomically fold the deltas into cached balances.
    UPDATE arka.accounts a
       SET balance = a.balance + agg.delta,
           balance_version = a.balance_version + 1,
           updated_at = now()
      FROM (
            SELECT jl.account_id,
                   SUM(CASE WHEN acc.normal_balance = 'DEBIT'
                            THEN jl.debit - jl.credit
                            ELSE jl.credit - jl.debit END) AS delta
              FROM arka.journal_lines jl
              JOIN arka.accounts acc ON acc.id = jl.account_id
             WHERE jl.entry_id = p_entry_id
             GROUP BY jl.account_id
           ) agg
     WHERE a.id = agg.account_id;

    -- 6) Flip the header to POSTED (fires the deferred header balance CT as backstop).
    UPDATE arka.journal_entries
       SET status = 'POSTED',
           posted_at = now(),
           posted_by = COALESCE(p_actor, arka.current_actor_id()),
           fiscal_period_id = v_period.id
     WHERE id = p_entry_id
    RETURNING * INTO v_entry;

    RETURN v_entry;
END;
$$;

-- ---------------------------------------------------------------------------
--  REVERSE — books the exact mirror of a posted entry and marks it REVERSED.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arka.fn_reverse_journal_entry(
    p_entry_id UUID,
    p_actor    UUID DEFAULT NULL,
    p_date     DATE DEFAULT NULL,
    p_memo     TEXT DEFAULT NULL
) RETURNS arka.journal_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arka, public
AS $$
DECLARE
    v_src      arka.journal_entries;
    v_new_id   UUID;
    v_result   arka.journal_entries;
    v_date     DATE;
BEGIN
    SELECT * INTO v_src FROM arka.journal_entries
      WHERE id = p_entry_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'journal entry % not found', p_entry_id;
    END IF;
    IF v_src.status <> 'POSTED' THEN
        RAISE EXCEPTION 'only POSTED entries can be reversed (entry % is %)',
            v_src.entry_no, v_src.status;
    END IF;

    v_date := COALESCE(p_date, current_date);

    INSERT INTO arka.journal_entries
        (memo, entry_date, reference, source, status, project_id, customer_id,
         reversed_entry_id, created_by)
    VALUES
        (COALESCE(p_memo, 'Reversal of #' || v_src.entry_no || ' — ' || v_src.memo),
         v_date, v_src.reference, 'REVERSAL', 'DRAFT', v_src.project_id, v_src.customer_id,
         v_src.id, COALESCE(p_actor, arka.current_actor_id()))
    RETURNING id INTO v_new_id;

    -- Mirror the lines (swap debit <-> credit).
    INSERT INTO arka.journal_lines (entry_id, line_no, account_id, debit, credit, memo, project_id)
    SELECT v_new_id, line_no, account_id, credit, debit,
           'Reversal: ' || COALESCE(memo, ''), project_id
      FROM arka.journal_lines WHERE entry_id = p_entry_id;

    -- Post the reversal (locks + balances applied through the standard gate).
    v_result := arka.fn_post_journal_entry(v_new_id, p_actor);

    -- Mark the source as REVERSED.
    UPDATE arka.journal_entries SET status = 'REVERSED' WHERE id = p_entry_id;

    RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
--  SELF-HEAL — recompute a single account's cached balance from posted lines.
--  Used by an integrity job; also handy after restores.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arka.fn_recompute_account_balance(p_account_id UUID)
RETURNS NUMERIC(78,0)
LANGUAGE plpgsql AS $$
DECLARE v_bal NUMERIC(78,0);
BEGIN
    PERFORM 1 FROM arka.accounts WHERE id = p_account_id FOR UPDATE;

    SELECT COALESCE(SUM(
             CASE WHEN acc.normal_balance = 'DEBIT'
                  THEN jl.debit - jl.credit
                  ELSE jl.credit - jl.debit END), 0)
      INTO v_bal
      FROM arka.journal_lines jl
      JOIN arka.journal_entries je ON je.id = jl.entry_id
      JOIN arka.accounts acc ON acc.id = jl.account_id
     WHERE jl.account_id = p_account_id
       AND je.status = 'POSTED'
       AND je.deleted_at IS NULL;

    UPDATE arka.accounts
       SET balance = v_bal, balance_version = balance_version + 1
     WHERE id = p_account_id;
    RETURN v_bal;
END;$$;

-- ---------------------------------------------------------------------------
--  FISCAL CLOSE — advisory-locked so only one close can run system-wide.
--  Rolls net income (Income - Expense) of the period into a Retained Earnings
--  equity account and locks the period.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arka.fn_close_fiscal_period(
    p_period_id           UUID,
    p_retained_account_id UUID,
    p_pl_summary_acct_id  UUID,
    p_actor               UUID DEFAULT NULL
) RETURNS arka.journal_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arka, public
AS $$
DECLARE
    v_period   arka.fiscal_periods;
    v_income   NUMERIC(78,0);
    v_expense  NUMERIC(78,0);
    v_net      NUMERIC(78,0);
    v_entry_id UUID;
    v_result   arka.journal_entries;
    v_open     INTEGER;
BEGIN
    -- Only one fiscal-close may execute across the whole database at a time.
    IF NOT pg_try_advisory_xact_lock(hashtext('arka.fiscal.close')) THEN
        RAISE EXCEPTION 'another fiscal close is already in progress';
    END IF;

    SELECT * INTO v_period FROM arka.fiscal_periods WHERE id = p_period_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'period % not found', p_period_id; END IF;
    IF v_period.status = 'CLOSED' THEN
        RAISE EXCEPTION 'period %/% already CLOSED', v_period.year_code, v_period.period_no;
    END IF;

    -- Refuse to close while draft entries remain in the period window.
    SELECT COUNT(*) INTO v_open
      FROM arka.journal_entries
     WHERE status = 'DRAFT' AND deleted_at IS NULL
       AND entry_date BETWEEN v_period.starts_on AND v_period.ends_on;
    IF v_open > 0 THEN
        RAISE EXCEPTION 'cannot close: % draft entries still in period', v_open;
    END IF;

    -- Net income for the period from posted lines.
    SELECT
      COALESCE(SUM(CASE WHEN acc.account_type = 'INCOME'  THEN jl.credit - jl.debit ELSE 0 END),0),
      COALESCE(SUM(CASE WHEN acc.account_type = 'EXPENSE' THEN jl.debit - jl.credit ELSE 0 END),0)
      INTO v_income, v_expense
      FROM arka.journal_lines jl
      JOIN arka.journal_entries je ON je.id = jl.entry_id
      JOIN arka.accounts acc ON acc.id = jl.account_id
     WHERE je.status = 'POSTED' AND je.deleted_at IS NULL
       AND je.entry_date BETWEEN v_period.starts_on AND v_period.ends_on;

    v_net := v_income - v_expense;   -- positive = profit

    -- Closing entry: move net result into Retained Earnings via a summary account.
    INSERT INTO arka.journal_entries (memo, entry_date, source, status, created_by)
    VALUES ('Fiscal close ' || v_period.year_code || '/' || v_period.period_no,
            v_period.ends_on, 'CLOSING', 'DRAFT', COALESCE(p_actor, arka.current_actor_id()))
    RETURNING id INTO v_entry_id;

    IF v_net > 0 THEN
        -- Profit: debit P&L summary, credit retained earnings.
        INSERT INTO arka.journal_lines (entry_id, line_no, account_id, debit, credit, memo)
        VALUES (v_entry_id, 1, p_pl_summary_acct_id, v_net, 0, 'Net profit to summary'),
               (v_entry_id, 2, p_retained_account_id, 0, v_net, 'Net profit to retained earnings');
    ELSIF v_net < 0 THEN
        INSERT INTO arka.journal_lines (entry_id, line_no, account_id, debit, credit, memo)
        VALUES (v_entry_id, 1, p_retained_account_id, -v_net, 0, 'Net loss from retained earnings'),
               (v_entry_id, 2, p_pl_summary_acct_id, 0, -v_net, 'Net loss to summary');
    ELSE
        -- Zero net result: no closing entry is needed (a 0/0 line would violate
        -- chk_line_one_side). Discard the empty header.
        DELETE FROM arka.journal_entries WHERE id = v_entry_id;
        v_entry_id := NULL;
    END IF;

    IF v_entry_id IS NOT NULL THEN
        v_result := arka.fn_post_journal_entry(v_entry_id, p_actor);
    END IF;

    UPDATE arka.fiscal_periods
       SET status = 'CLOSED', closed_at = now(),
           closed_by = COALESCE(p_actor, arka.current_actor_id())
     WHERE id = p_period_id;

    RETURN v_result;
END;
$$;

-- Application pool executes the gates but cannot mutate cached balances directly.
-- (Column-level restriction requires revoking the table-level UPDATE first, then
--  re-granting UPDATE only on the non-balance columns.)
REVOKE UPDATE ON arka.accounts FROM arka_app;
GRANT UPDATE (name, is_active, description, metadata, parent_id, currency,
              updated_at, deleted_at)
    ON arka.accounts TO arka_app;

GRANT EXECUTE ON FUNCTION
    arka.fn_post_journal_entry(UUID, UUID),
    arka.fn_reverse_journal_entry(UUID, UUID, DATE, TEXT),
    arka.fn_recompute_account_balance(UUID),
    arka.fn_close_fiscal_period(UUID, UUID, UUID, UUID)
TO arka_app;
