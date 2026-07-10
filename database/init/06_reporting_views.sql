-- =============================================================================
--  ARKA ADS STUDIO — 06 — Reporting Views (WITH RECURSIVE)
--  -------------------------------------------------------------------------
--    v_account_tree       — hierarchical COA with depth + materialised path
--    v_account_rollup     — balances rolled up from leaves to every ancestor
--    v_trial_balance      — posted debits/credits per postable account
--    v_general_ledger     — flattened posted lines (drill-down source)
--    v_profit_and_loss    — income vs expense, net result
--    v_balance_sheet      — assets = liabilities + equity assertion
--    v_cash_flow_summary  — movement across cash/bank accounts
--    v_ar_aging           — receivables aging buckets by customer
-- =============================================================================
SET search_path TO arka, public;

-- ---------------------------------------------------------------------------
--  Hierarchical Chart of Accounts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW arka.v_account_tree AS
WITH RECURSIVE tree AS (
    SELECT
        a.id, a.code, a.name, a.account_type, a.normal_balance,
        a.parent_id, a.is_postable, a.is_active, a.balance,
        1                          AS depth,
        ARRAY[a.code]              AS path_codes,
        a.code::text               AS path_display,
        a.code                     AS root_code
    FROM arka.accounts a
    WHERE a.parent_id IS NULL AND a.deleted_at IS NULL

    UNION ALL

    SELECT
        c.id, c.code, c.name, c.account_type, c.normal_balance,
        c.parent_id, c.is_postable, c.is_active, c.balance,
        t.depth + 1,
        t.path_codes || c.code,
        t.path_display || ' › ' || c.code,
        t.root_code
    FROM arka.accounts c
    JOIN tree t ON c.parent_id = t.id
    WHERE c.deleted_at IS NULL
)
SELECT * FROM tree;

-- ---------------------------------------------------------------------------
--  Roll-up: every account's balance including all descendants.
--  Each node's cached balance is propagated to itself and each ancestor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW arka.v_account_rollup AS
WITH RECURSIVE up AS (
    SELECT a.id AS ancestor_id, a.id AS node_id, a.balance
    FROM arka.accounts a
    WHERE a.deleted_at IS NULL

    UNION ALL

    SELECT p.id AS ancestor_id, u.node_id, u.balance
    FROM up u
    JOIN arka.accounts c ON c.id = u.ancestor_id AND c.deleted_at IS NULL
    JOIN arka.accounts p ON p.id = c.parent_id AND p.deleted_at IS NULL
)
SELECT
    a.id, a.code, a.name, a.account_type, a.normal_balance, a.is_postable,
    COALESCE(SUM(u.balance), 0)::numeric(78,0) AS rollup_balance
FROM arka.accounts a
LEFT JOIN up u ON u.ancestor_id = a.id
WHERE a.deleted_at IS NULL
GROUP BY a.id, a.code, a.name, a.account_type, a.normal_balance, a.is_postable;

-- ---------------------------------------------------------------------------
--  Trial Balance — from POSTED lines only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW arka.v_trial_balance AS
SELECT
    a.id                                        AS account_id,
    a.code,
    a.name,
    a.account_type,
    a.normal_balance,
    COALESCE(SUM(jl.debit), 0)::numeric(78,0)   AS total_debit,
    COALESCE(SUM(jl.credit), 0)::numeric(78,0)  AS total_credit,
    -- Natural balance in the account's normal direction:
    CASE WHEN a.normal_balance = 'DEBIT'
         THEN COALESCE(SUM(jl.debit - jl.credit), 0)
         ELSE COALESCE(SUM(jl.credit - jl.debit), 0)
    END::numeric(78,0)                          AS net_balance,
    -- Presentation columns (a TB always balances across all accounts):
    GREATEST(COALESCE(SUM(jl.debit - jl.credit), 0), 0)::numeric(78,0)  AS debit_balance,
    GREATEST(COALESCE(SUM(jl.credit - jl.debit), 0), 0)::numeric(78,0)  AS credit_balance
FROM arka.accounts a
LEFT JOIN arka.journal_lines jl ON jl.account_id = a.id
LEFT JOIN arka.journal_entries je
       ON je.id = jl.entry_id AND je.status = 'POSTED' AND je.deleted_at IS NULL
WHERE a.deleted_at IS NULL AND a.is_postable
GROUP BY a.id, a.code, a.name, a.account_type, a.normal_balance
ORDER BY a.code;

-- ---------------------------------------------------------------------------
--  General Ledger — flattened posted lines for drill-down / statements.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW arka.v_general_ledger AS
SELECT
    je.entry_no,
    je.entry_date,
    je.status,
    je.memo             AS entry_memo,
    je.reference,
    je.source,
    a.code              AS account_code,
    a.name              AS account_name,
    a.account_type,
    jl.line_no,
    jl.debit,
    jl.credit,
    jl.memo             AS line_memo,
    p.code              AS project_code,
    p.name              AS project_name,
    je.id               AS entry_id,
    jl.id               AS line_id,
    a.id                AS account_id,
    je.posted_at
FROM arka.journal_lines jl
JOIN arka.journal_entries je ON je.id = jl.entry_id
JOIN arka.accounts a        ON a.id = jl.account_id
LEFT JOIN arka.projects p   ON p.id = jl.project_id
WHERE je.status = 'POSTED' AND je.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
--  Profit & Loss  (income & expense roll-ups). Filter by date in the app.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW arka.v_profit_and_loss AS
SELECT
    a.account_type,
    a.code,
    a.name,
    CASE WHEN a.account_type = 'INCOME'
         THEN COALESCE(SUM(jl.credit - jl.debit), 0)
         ELSE COALESCE(SUM(jl.debit  - jl.credit), 0)
    END::numeric(78,0)  AS amount,
    je.entry_date
FROM arka.accounts a
JOIN arka.journal_lines jl   ON jl.account_id = a.id
JOIN arka.journal_entries je ON je.id = jl.entry_id
                            AND je.status = 'POSTED' AND je.deleted_at IS NULL
WHERE a.account_type IN ('INCOME','EXPENSE') AND a.deleted_at IS NULL
GROUP BY a.account_type, a.code, a.name, je.entry_date;

-- ---------------------------------------------------------------------------
--  Balance Sheet snapshot (all posted activity to date).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW arka.v_balance_sheet AS
SELECT
    a.account_type,
    a.code,
    a.name,
    r.rollup_balance    AS amount
FROM arka.accounts a
JOIN arka.v_account_rollup r ON r.id = a.id
WHERE a.account_type IN ('ASSET','LIABILITY','EQUITY')
  AND a.deleted_at IS NULL
  AND a.parent_id IS NULL;   -- top-level summary rows

-- ---------------------------------------------------------------------------
--  Cash Flow summary — net movement over accounts flagged as cash/bank
--  (identified by metadata->>'cash_flow' = 'true' in the COA seed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW arka.v_cash_flow_summary AS
SELECT
    je.entry_date,
    a.code,
    a.name,
    COALESCE(SUM(jl.debit - jl.credit), 0)::numeric(78,0) AS net_inflow
FROM arka.accounts a
JOIN arka.journal_lines jl   ON jl.account_id = a.id
JOIN arka.journal_entries je ON je.id = jl.entry_id
                            AND je.status = 'POSTED' AND je.deleted_at IS NULL
WHERE a.metadata->>'cash_flow' = 'true' AND a.deleted_at IS NULL
GROUP BY je.entry_date, a.code, a.name;

-- ---------------------------------------------------------------------------
--  Accounts-Receivable aging by customer (open, per project invoicing).
--  Buckets are computed against the customer AR account balance snapshots.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW arka.v_ar_aging AS
SELECT
    c.id                                        AS customer_id,
    c.code                                      AS customer_code,
    c.display_name,
    a.balance                                   AS receivable_balance,
    c.credit_limit,
    GREATEST(c.credit_limit - a.balance, 0)::numeric(78,0) AS available_credit
FROM arka.customers c
JOIN arka.accounts a ON a.id = c.ar_account_id
WHERE c.deleted_at IS NULL;

-- Read-only reporting surface for the app pool.
GRANT SELECT ON
    arka.v_account_tree, arka.v_account_rollup, arka.v_trial_balance,
    arka.v_general_ledger, arka.v_profit_and_loss, arka.v_balance_sheet,
    arka.v_cash_flow_summary, arka.v_ar_aging
TO arka_app;
