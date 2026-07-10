-- =============================================================================
--  ARKA ADS STUDIO — 02 — Tamper-evident Audit Trail (JSONB + Hash Chain)
--  -------------------------------------------------------------------------
--  * Generic AFTER trigger captures OLD/NEW as JSONB for every audited table.
--  * Each row is chained: row_hash = sha256(prev_hash || canonical_payload).
--  * A transaction-level advisory lock serialises hash computation so the
--    chain is deterministic even under heavy concurrency.
--  * Verify integrity anytime with arka.fn_verify_audit_chain().
-- =============================================================================
SET search_path TO arka, public;

CREATE TABLE arka.audit_log (
    id            BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name    TEXT         NOT NULL,
    record_id     TEXT         NOT NULL,               -- pk of the affected row (text form)
    action        arka.audit_action NOT NULL,
    actor_id      UUID,                                -- app.current_user_id (may be NULL for system)
    actor_role    TEXT,
    client_ip     INET,
    old_data      JSONB,
    new_data      JSONB,
    changed_cols  TEXT[],
    tx_id         BIGINT       NOT NULL DEFAULT txid_current(),
    changed_at    TIMESTAMPTZ  NOT NULL,
    prev_hash     BYTEA        NOT NULL,
    row_hash      BYTEA        NOT NULL
);

CREATE INDEX idx_audit_table_record ON arka.audit_log (table_name, record_id);
CREATE INDEX idx_audit_actor        ON arka.audit_log (actor_id);
CREATE INDEX idx_audit_changed_at   ON arka.audit_log (changed_at DESC);
CREATE INDEX idx_audit_new_data_gin ON arka.audit_log USING GIN (new_data);

COMMENT ON TABLE arka.audit_log IS
  'Append-only, hash-chained audit trail. Never UPDATE/DELETE rows here.';

-- ---------------------------------------------------------------------------
--  Session context helpers — the app sets these per request via SET LOCAL.
--    SELECT set_config('app.current_user_id',   '<uuid>', true);
--    SELECT set_config('app.current_user_role', 'ACCOUNTANT', true);
--    SELECT set_config('app.client_ip',         '203.0.113.7', true);
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arka.current_actor_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION arka.current_actor_role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_role', true), '');
$$;

CREATE OR REPLACE FUNCTION arka.current_client_ip()
RETURNS inet LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.client_ip', true), '')::inet;
$$;

-- ---------------------------------------------------------------------------
--  Canonical payload builder — the single source of truth for hashing so the
--  live trigger and the verifier can never drift apart.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arka.fn_audit_payload(
    p_table   TEXT,
    p_action  arka.audit_action,
    p_record  TEXT,
    p_old     JSONB,
    p_new     JSONB,
    p_actor   UUID,
    p_when    TIMESTAMPTZ
) RETURNS BYTEA
LANGUAGE sql IMMUTABLE AS $$
  SELECT convert_to(
      p_table || '|' || p_action::text || '|' || COALESCE(p_record, '') || '|' ||
      COALESCE(p_old::text, '') || '|' || COALESCE(p_new::text, '') || '|' ||
      COALESCE(p_actor::text, '') || '|' || p_when::text,
  'UTF8');
$$;

-- ---------------------------------------------------------------------------
--  Generic audit trigger with hash chaining.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arka.fn_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_old        JSONB;
    v_new        JSONB;
    v_record_id  TEXT;
    v_changed    TEXT[];
    v_prev_hash  BYTEA;
    v_row_hash   BYTEA;
    v_action     arka.audit_action;
    v_when       TIMESTAMPTZ := clock_timestamp();
BEGIN
    -- Serialise hash-chain writes for the lifetime of the transaction.
    PERFORM pg_advisory_xact_lock(hashtext('arka.audit_log.chain'));

    IF TG_OP = 'INSERT' THEN
        v_action := 'INSERT'; v_new := to_jsonb(NEW); v_old := NULL;
        v_record_id := (v_new ->> 'id');
    ELSIF TG_OP = 'UPDATE' THEN
        v_action := 'UPDATE'; v_new := to_jsonb(NEW); v_old := to_jsonb(OLD);
        v_record_id := (v_new ->> 'id');
        SELECT array_agg(key)
          INTO v_changed
          FROM jsonb_each(v_new) n
         WHERE n.value IS DISTINCT FROM (v_old -> n.key);
    ELSE  -- DELETE (soft-delete UPDATE is the normal path; hard delete is guarded elsewhere)
        v_action := 'DELETE'; v_old := to_jsonb(OLD); v_new := NULL;
        v_record_id := (v_old ->> 'id');
    END IF;

    SELECT row_hash INTO v_prev_hash FROM arka.audit_log ORDER BY id DESC LIMIT 1;
    IF v_prev_hash IS NULL THEN
        v_prev_hash := digest('ARKA-AUDIT-GENESIS', 'sha256');
    END IF;

    v_row_hash := digest(
        v_prev_hash ||
        arka.fn_audit_payload(TG_TABLE_NAME, v_action, v_record_id,
                              v_old, v_new, arka.current_actor_id(), v_when),
        'sha256');

    INSERT INTO arka.audit_log
        (table_name, record_id, action, actor_id, actor_role, client_ip,
         old_data, new_data, changed_cols, changed_at, prev_hash, row_hash)
    VALUES
        (TG_TABLE_NAME, v_record_id, v_action,
         arka.current_actor_id(), arka.current_actor_role(), arka.current_client_ip(),
         v_old, v_new, v_changed, v_when, v_prev_hash, v_row_hash);

    RETURN NULL;  -- AFTER trigger
END;
$$;

-- ---------------------------------------------------------------------------
--  Integrity verifier — returns the first broken link, or no rows if intact.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arka.fn_verify_audit_chain()
RETURNS TABLE(broken_at_id BIGINT, expected_hash BYTEA, stored_hash BYTEA)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    r       RECORD;
    v_prev  BYTEA := digest('ARKA-AUDIT-GENESIS', 'sha256');
    v_calc  BYTEA;
BEGIN
    FOR r IN SELECT * FROM arka.audit_log ORDER BY id ASC LOOP
        v_calc := digest(
            r.prev_hash ||
            arka.fn_audit_payload(r.table_name, r.action, r.record_id,
                                  r.old_data, r.new_data, r.actor_id, r.changed_at),
            'sha256');

        IF r.prev_hash IS DISTINCT FROM v_prev OR r.row_hash IS DISTINCT FROM v_calc THEN
            broken_at_id := r.id; expected_hash := v_calc; stored_hash := r.row_hash;
            RETURN NEXT;
            RETURN;
        END IF;
        v_prev := r.row_hash;
    END LOOP;
END;
$$;

-- Harden: block UPDATE/DELETE on the audit log entirely.
CREATE OR REPLACE FUNCTION arka.fn_audit_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP;
END;$$;

CREATE TRIGGER trg_audit_immutable
  BEFORE UPDATE OR DELETE ON arka.audit_log
  FOR EACH ROW EXECUTE FUNCTION arka.fn_audit_immutable();
