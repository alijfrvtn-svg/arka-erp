-- =============================================================================
--  ARKA ADS STUDIO — 04 — Double-Entry Accounting Core
--  -------------------------------------------------------------------------
--  Invariants enforced *in the database*:
--    (I1) Every posted journal entry: SUM(debit) = SUM(credit)  (deferred CT).
--    (I2) A line is either a debit or a credit, never both, never negative.
--    (I3) Journal lines may only reference postable (leaf) active accounts.
--    (I4) Posting locks account rows in deterministic id order (deadlock-free)
--         and mutates cached balances atomically  (SELECT ... FOR UPDATE).
--    (I5) Posting is rejected outside an OPEN fiscal period.
--  Amounts are NUMERIC(78,0) integers in the smallest currency unit (Rial).
-- =============================================================================
SET search_path TO arka, public;

-- ---------------------------------------------------------------------------
--  FISCAL PERIODS
-- ---------------------------------------------------------------------------
CREATE TABLE arka.fiscal_periods (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    year_code   TEXT        NOT NULL,                  -- e.g. '1404'
    period_no   SMALLINT    NOT NULL CHECK (period_no BETWEEN 1 AND 12),
    starts_on   DATE        NOT NULL,
    ends_on     DATE        NOT NULL,
    status      arka.fiscal_period_status NOT NULL DEFAULT 'OPEN',
    closed_at   TIMESTAMPTZ,
    closed_by   UUID REFERENCES arka.users(id),
    CONSTRAINT chk_period_range CHECK (ends_on >= starts_on),
    CONSTRAINT uq_period UNIQUE (year_code, period_no),
    -- No two periods may overlap (btree_gist).
    CONSTRAINT excl_period_overlap
        EXCLUDE USING gist (daterange(starts_on, ends_on, '[]') WITH &&)
);
CREATE INDEX idx_period_status ON arka.fiscal_periods (status);

CREATE OR REPLACE FUNCTION arka.fn_period_for_date(p_date DATE)
RETURNS arka.fiscal_periods LANGUAGE sql STABLE AS $$
  SELECT * FROM arka.fiscal_periods
   WHERE p_date BETWEEN starts_on AND ends_on
   LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
--  CHART OF ACCOUNTS  (self-referencing hierarchy)
-- ---------------------------------------------------------------------------
CREATE TABLE arka.accounts (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT          NOT NULL,
    name            TEXT          NOT NULL,
    account_type    arka.account_type   NOT NULL,
    normal_balance  arka.normal_balance NOT NULL,
    parent_id       UUID          REFERENCES arka.accounts(id),
    is_postable     BOOLEAN       NOT NULL DEFAULT true,   -- only leaves are postable
    is_active       BOOLEAN       NOT NULL DEFAULT true,
    currency        CHAR(3)       NOT NULL DEFAULT 'IRR',
    -- Cached natural balance (positive on the account's normal side).
    balance         NUMERIC(78,0) NOT NULL DEFAULT 0,
    balance_version INTEGER       NOT NULL DEFAULT 0,      -- optimistic lock
    description     TEXT,
    metadata        JSONB         NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT chk_account_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX uq_accounts_code ON arka.accounts (code) WHERE deleted_at IS NULL;
CREATE INDEX idx_accounts_parent ON arka.accounts (parent_id);
CREATE INDEX idx_accounts_type   ON arka.accounts (account_type) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_accounts_touch   BEFORE UPDATE ON arka.accounts
    FOR EACH ROW EXECUTE FUNCTION arka.fn_touch_updated_at();
CREATE TRIGGER trg_accounts_audit   AFTER INSERT OR UPDATE OR DELETE ON arka.accounts
    FOR EACH ROW EXECUTE FUNCTION arka.fn_audit();

-- A parent account must not remain postable once it has children.
CREATE OR REPLACE FUNCTION arka.fn_parent_not_postable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.parent_id IS NOT NULL THEN
        UPDATE arka.accounts SET is_postable = false
         WHERE id = NEW.parent_id AND is_postable = true;
    END IF;
    RETURN NEW;
END;$$;
CREATE TRIGGER trg_accounts_parent_leaf AFTER INSERT OR UPDATE OF parent_id ON arka.accounts
    FOR EACH ROW EXECUTE FUNCTION arka.fn_parent_not_postable();

-- Now that accounts exist, wire the customer AR sub-ledger FK.
ALTER TABLE arka.customers
    ADD CONSTRAINT fk_customers_ar_account
    FOREIGN KEY (ar_account_id) REFERENCES arka.accounts(id);

-- ---------------------------------------------------------------------------
--  PROJECTS  (financial + delivery anchor)
-- ---------------------------------------------------------------------------
CREATE TABLE arka.projects (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code          TEXT        NOT NULL,
    name          TEXT        NOT NULL,
    customer_id   UUID        REFERENCES arka.customers(id),
    manager_id    UUID        REFERENCES arka.users(id),
    status        arka.project_status NOT NULL DEFAULT 'LEAD',
    budget        NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (budget >= 0),
    contract_value NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (contract_value >= 0),
    cost_to_date  NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (cost_to_date >= 0),
    progress_pct  NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
    starts_on     DATE,
    due_on        DATE,
    delivered_on  DATE,
    description   TEXT,
    metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by    UUID REFERENCES arka.users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    CONSTRAINT chk_project_dates CHECK (due_on IS NULL OR starts_on IS NULL OR due_on >= starts_on)
);
CREATE UNIQUE INDEX uq_projects_code ON arka.projects (code) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_customer ON arka.projects (customer_id);
CREATE INDEX idx_projects_status   ON arka.projects (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_manager  ON arka.projects (manager_id);

CREATE TRIGGER trg_projects_touch BEFORE UPDATE ON arka.projects
    FOR EACH ROW EXECUTE FUNCTION arka.fn_touch_updated_at();
CREATE TRIGGER trg_projects_audit AFTER INSERT OR UPDATE OR DELETE ON arka.projects
    FOR EACH ROW EXECUTE FUNCTION arka.fn_audit();

-- ---------------------------------------------------------------------------
--  JOURNAL ENTRIES (header)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE arka.seq_journal_no START 1000;

CREATE TABLE arka.journal_entries (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_no          BIGINT      NOT NULL DEFAULT nextval('arka.seq_journal_no'),
    entry_date        DATE        NOT NULL DEFAULT current_date,
    memo              TEXT        NOT NULL,
    reference         TEXT,                              -- external doc no / invoice no
    source            TEXT        NOT NULL DEFAULT 'MANUAL',  -- MANUAL|INVOICE|PAYROLL|DEPRECIATION|FX
    status            arka.journal_status NOT NULL DEFAULT 'DRAFT',
    fiscal_period_id  UUID        REFERENCES arka.fiscal_periods(id),
    project_id        UUID        REFERENCES arka.projects(id),
    customer_id       UUID        REFERENCES arka.customers(id),
    reversed_entry_id UUID        REFERENCES arka.journal_entries(id),  -- set on the reversing entry
    posted_at         TIMESTAMPTZ,
    posted_by         UUID        REFERENCES arka.users(id),
    created_by        UUID        REFERENCES arka.users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_journal_entry_no ON arka.journal_entries (entry_no);
CREATE INDEX idx_journal_date    ON arka.journal_entries (entry_date);
CREATE INDEX idx_journal_status  ON arka.journal_entries (status);
CREATE INDEX idx_journal_project ON arka.journal_entries (project_id);
CREATE INDEX idx_journal_period  ON arka.journal_entries (fiscal_period_id);

CREATE TRIGGER trg_journal_touch BEFORE UPDATE ON arka.journal_entries
    FOR EACH ROW EXECUTE FUNCTION arka.fn_touch_updated_at();
CREATE TRIGGER trg_journal_audit AFTER INSERT OR UPDATE OR DELETE ON arka.journal_entries
    FOR EACH ROW EXECUTE FUNCTION arka.fn_audit();

-- ---------------------------------------------------------------------------
--  JOURNAL LINES (detail)
-- ---------------------------------------------------------------------------
CREATE TABLE arka.journal_lines (
    id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id    UUID          NOT NULL REFERENCES arka.journal_entries(id) ON DELETE CASCADE,
    line_no     SMALLINT      NOT NULL,
    account_id  UUID          NOT NULL REFERENCES arka.accounts(id),
    debit       NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
    credit      NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    memo        TEXT,
    project_id  UUID REFERENCES arka.projects(id),
    metadata    JSONB         NOT NULL DEFAULT '{}'::jsonb,
    -- (I2) exactly one side non-zero
    CONSTRAINT chk_line_one_side CHECK (
        (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
    ),
    CONSTRAINT uq_line_no UNIQUE (entry_id, line_no)
);
CREATE INDEX idx_lines_entry   ON arka.journal_lines (entry_id);
CREATE INDEX idx_lines_account ON arka.journal_lines (account_id);
CREATE INDEX idx_lines_project ON arka.journal_lines (project_id);

-- (I3) postable + active account guard
CREATE OR REPLACE FUNCTION arka.fn_line_account_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_acc arka.accounts;
BEGIN
    SELECT * INTO v_acc FROM arka.accounts WHERE id = NEW.account_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'account % does not exist', NEW.account_id;
    END IF;
    IF v_acc.deleted_at IS NOT NULL OR NOT v_acc.is_active THEN
        RAISE EXCEPTION 'account % (%) is inactive/deleted', v_acc.code, v_acc.name;
    END IF;
    IF NOT v_acc.is_postable THEN
        RAISE EXCEPTION 'account % (%) is a control account and is not postable', v_acc.code, v_acc.name;
    END IF;
    RETURN NEW;
END;$$;
CREATE TRIGGER trg_line_account_guard BEFORE INSERT OR UPDATE ON arka.journal_lines
    FOR EACH ROW EXECUTE FUNCTION arka.fn_line_account_guard();

-- (I1) deferred balance check — only enforced for POSTED entries.
CREATE OR REPLACE FUNCTION arka.fn_check_entry_balanced()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_entry_id UUID;
    v_status   arka.journal_status;
    v_debit    NUMERIC(78,0);
    v_credit   NUMERIC(78,0);
    v_lines    INTEGER;
BEGIN
    v_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);

    SELECT status INTO v_status FROM arka.journal_entries WHERE id = v_entry_id;
    IF v_status IS NULL OR v_status <> 'POSTED' THEN
        RETURN NULL;               -- drafts may be unbalanced
    END IF;

    SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*)
      INTO v_debit, v_credit, v_lines
      FROM arka.journal_lines WHERE entry_id = v_entry_id;

    IF v_lines < 2 THEN
        RAISE EXCEPTION 'journal entry % must contain at least two lines', v_entry_id;
    END IF;
    IF v_debit <> v_credit THEN
        RAISE EXCEPTION 'journal entry % is unbalanced: debit=% credit=%',
            v_entry_id, v_debit, v_credit;
    END IF;
    RETURN NULL;
END;$$;

CREATE CONSTRAINT TRIGGER trg_lines_balanced
    AFTER INSERT OR UPDATE OR DELETE ON arka.journal_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION arka.fn_check_entry_balanced();

-- Also re-check when a header flips to POSTED.
CREATE OR REPLACE FUNCTION arka.fn_check_header_balanced()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_debit NUMERIC(78,0); v_credit NUMERIC(78,0); v_lines INTEGER;
BEGIN
    IF NEW.status <> 'POSTED' THEN RETURN NULL; END IF;
    SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*)
      INTO v_debit, v_credit, v_lines
      FROM arka.journal_lines WHERE entry_id = NEW.id;
    IF v_lines < 2 OR v_debit <> v_credit THEN
        RAISE EXCEPTION 'entry % cannot be POSTED: lines=% debit=% credit=%',
            NEW.id, v_lines, v_debit, v_credit;
    END IF;
    RETURN NULL;
END;$$;
CREATE CONSTRAINT TRIGGER trg_header_balanced
    AFTER UPDATE OF status ON arka.journal_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION arka.fn_check_header_balanced();
