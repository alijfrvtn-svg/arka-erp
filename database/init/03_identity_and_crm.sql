-- =============================================================================
--  ARKA ADS STUDIO — 03 — Identity, RBAC, Sessions, CRM core
--  -------------------------------------------------------------------------
--  * Argon2id password hashes are produced by the app layer (node-argon2);
--    the DB stores the encoded string only.
--  * PII (IBAN / national id / PAN) is stored as app-layer envelope-encrypted
--    bytea plus a non-sensitive *_last4 for display. The plaintext never lands
--    in the DB.
--  * Soft-delete everywhere via deleted_at + partial unique indexes.
-- =============================================================================
SET search_path TO arka, public;

-- ---------------------------------------------------------------------------
--  USERS
-- ---------------------------------------------------------------------------
CREATE TABLE arka.users (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    email             TEXT          NOT NULL,          -- case-insensitive via lower() index
    full_name         TEXT          NOT NULL,
    role              arka.user_role NOT NULL DEFAULT 'GUEST',
    password_hash     TEXT          NOT NULL,          -- argon2id encoded string
    -- Step-up MFA (TOTP). Secret is envelope-encrypted by the app.
    mfa_enabled       BOOLEAN       NOT NULL DEFAULT false,
    mfa_secret_enc    BYTEA,
    mfa_recovery_enc  BYTEA,
    -- Security / lifecycle
    is_active         BOOLEAN       NOT NULL DEFAULT true,
    failed_logins     INTEGER       NOT NULL DEFAULT 0,
    locked_until      TIMESTAMPTZ,
    last_login_at     TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    balance_version   INTEGER       NOT NULL DEFAULT 0,   -- optimistic lock
    metadata          JSONB         NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,
    CONSTRAINT chk_users_email CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- One active account per email (soft-deleted rows may repeat).
CREATE UNIQUE INDEX uq_users_email_active
    ON arka.users (lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role   ON arka.users (role)  WHERE deleted_at IS NULL;
CREATE INDEX idx_users_active ON arka.users (is_active) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_users_touch  BEFORE UPDATE ON arka.users
    FOR EACH ROW EXECUTE FUNCTION arka.fn_touch_updated_at();
CREATE TRIGGER trg_users_version BEFORE UPDATE ON arka.users
    FOR EACH ROW EXECUTE FUNCTION arka.fn_bump_version();
CREATE TRIGGER trg_users_audit  AFTER INSERT OR UPDATE OR DELETE ON arka.users
    FOR EACH ROW EXECUTE FUNCTION arka.fn_audit();

-- ---------------------------------------------------------------------------
--  RBAC — permissions catalogue + role grants + Segregation of Duties
-- ---------------------------------------------------------------------------
CREATE TABLE arka.permissions (
    code        TEXT PRIMARY KEY,               -- e.g. 'ledger.post', 'fund.transfer'
    description TEXT NOT NULL,
    category    TEXT NOT NULL
);

CREATE TABLE arka.role_permissions (
    role        arka.user_role NOT NULL,
    permission  TEXT NOT NULL REFERENCES arka.permissions(code) ON DELETE CASCADE,
    PRIMARY KEY (role, permission)
);

-- Segregation of Duties: pairs of permissions that must never coexist for one role.
CREATE TABLE arka.sod_conflicts (
    permission_a TEXT NOT NULL REFERENCES arka.permissions(code) ON DELETE CASCADE,
    permission_b TEXT NOT NULL REFERENCES arka.permissions(code) ON DELETE CASCADE,
    reason       TEXT NOT NULL,
    PRIMARY KEY (permission_a, permission_b),
    CONSTRAINT chk_sod_distinct CHECK (permission_a < permission_b)
);

-- Enforce SoD at write time: reject a grant that violates any conflict rule.
CREATE OR REPLACE FUNCTION arka.fn_enforce_sod()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_conflict RECORD;
BEGIN
    SELECT c.* INTO v_conflict
    FROM arka.sod_conflicts c
    JOIN arka.role_permissions rp ON rp.role = NEW.role
     AND rp.permission = CASE WHEN c.permission_a = NEW.permission THEN c.permission_b
                              ELSE c.permission_a END
    WHERE NEW.permission IN (c.permission_a, c.permission_b)
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'SoD violation for role %: % conflicts with an existing grant (%)',
            NEW.role, NEW.permission, v_conflict.reason;
    END IF;
    RETURN NEW;
END;$$;

CREATE TRIGGER trg_role_perm_sod BEFORE INSERT OR UPDATE ON arka.role_permissions
    FOR EACH ROW EXECUTE FUNCTION arka.fn_enforce_sod();

-- ---------------------------------------------------------------------------
--  REFRESH TOKENS — rotation + reuse detection (only a SHA-256 hash is stored)
-- ---------------------------------------------------------------------------
CREATE TABLE arka.refresh_tokens (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES arka.users(id) ON DELETE CASCADE,
    token_hash    BYTEA       NOT NULL,                 -- sha256(raw token)
    family_id     UUID        NOT NULL,                 -- rotation lineage
    user_agent    TEXT,
    client_ip     INET,
    issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ,
    replaced_by   UUID REFERENCES arka.refresh_tokens(id)
);
CREATE UNIQUE INDEX uq_refresh_token_hash ON arka.refresh_tokens (token_hash);
CREATE INDEX idx_refresh_user   ON arka.refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_refresh_family ON arka.refresh_tokens (family_id);

-- ---------------------------------------------------------------------------
--  CUSTOMERS (CRM anchor)
-- ---------------------------------------------------------------------------
CREATE TABLE arka.customers (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code          TEXT        NOT NULL,
    kind          arka.customer_kind NOT NULL DEFAULT 'COMPANY',
    display_name  TEXT        NOT NULL,
    legal_name    TEXT,
    tax_id_enc    BYTEA,                     -- envelope-encrypted national/tax id
    tax_id_last4  TEXT,
    iban_enc      BYTEA,                     -- envelope-encrypted IBAN
    iban_last4    TEXT,
    email         TEXT,
    phone         TEXT,
    address       TEXT,
    -- Financial linkage: every customer maps to an AR sub-ledger account.
    ar_account_id UUID,                      -- FK added after accounts table exists
    credit_limit  NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
    notes         TEXT,
    metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by    UUID REFERENCES arka.users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_customers_code ON arka.customers (code) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_name_trgm ON arka.customers USING GIN (display_name gin_trgm_ops);

CREATE TRIGGER trg_customers_touch BEFORE UPDATE ON arka.customers
    FOR EACH ROW EXECUTE FUNCTION arka.fn_touch_updated_at();
CREATE TRIGGER trg_customers_audit AFTER INSERT OR UPDATE OR DELETE ON arka.customers
    FOR EACH ROW EXECUTE FUNCTION arka.fn_audit();

-- ---------------------------------------------------------------------------
--  CRM PIPELINE — lead-to-cash stages captured as interactions
-- ---------------------------------------------------------------------------
CREATE TABLE arka.crm_interactions (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID        NOT NULL REFERENCES arka.customers(id) ON DELETE CASCADE,
    stage        TEXT        NOT NULL,   -- CALL | MEETING | PROPOSAL | CONTRACT | FOLLOWUP
    subject      TEXT        NOT NULL,
    body         TEXT,
    owner_id     UUID REFERENCES arka.users(id),
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_action_at TIMESTAMPTZ,
    metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ
);
CREATE INDEX idx_crm_customer ON arka.crm_interactions (customer_id, occurred_at DESC);
