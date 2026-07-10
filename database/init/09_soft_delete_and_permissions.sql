-- =============================================================================
--  ARKA ADS STUDIO — 09 — Soft-delete metadata, per-user permissions, code seqs
--  -------------------------------------------------------------------------
--  Idempotent (IF NOT EXISTS) so it is safe both on a fresh init and when
--  applied to an already-running database.
-- =============================================================================
SET search_path TO arka, public;

-- ---- Soft-delete audit metadata (who deleted + mandatory reason) ------------
ALTER TABLE arka.journal_entries ADD COLUMN IF NOT EXISTS deleted_by     UUID REFERENCES arka.users(id);
ALTER TABLE arka.journal_entries ADD COLUMN IF NOT EXISTS deleted_reason TEXT;

ALTER TABLE arka.projects         ADD COLUMN IF NOT EXISTS deleted_by     UUID REFERENCES arka.users(id);
ALTER TABLE arka.projects         ADD COLUMN IF NOT EXISTS deleted_reason TEXT;

ALTER TABLE arka.customers        ADD COLUMN IF NOT EXISTS deleted_by     UUID REFERENCES arka.users(id);
ALTER TABLE arka.customers        ADD COLUMN IF NOT EXISTS deleted_reason TEXT;

-- ---- Per-user explicit permission grants ------------------------------------
-- When a user has ANY rows here, those replace the role defaults (full control
-- from the "create user" checkboxes). Empty ⇒ fall back to role_permissions.
CREATE TABLE IF NOT EXISTS arka.user_permissions (
    user_id    UUID NOT NULL REFERENCES arka.users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL REFERENCES arka.permissions(code) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON arka.user_permissions (user_id);

-- ---- Sequences for auto-generated human codes -------------------------------
CREATE SEQUENCE IF NOT EXISTS arka.seq_project_code  START 3001;
CREATE SEQUENCE IF NOT EXISTS arka.seq_customer_code START 2001;

-- ---- Effective permissions view (custom overrides role) ---------------------
CREATE OR REPLACE VIEW arka.v_effective_permissions AS
SELECT u.id AS user_id,
       COALESCE(up.permission, rp.permission) AS permission
FROM arka.users u
LEFT JOIN arka.user_permissions up ON up.user_id = u.id
LEFT JOIN arka.role_permissions rp ON rp.role = u.role
     AND NOT EXISTS (SELECT 1 FROM arka.user_permissions x WHERE x.user_id = u.id)
WHERE u.deleted_at IS NULL
  AND COALESCE(up.permission, rp.permission) IS NOT NULL;

GRANT SELECT ON arka.v_effective_permissions TO arka_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON arka.user_permissions TO arka_app;
GRANT USAGE, SELECT ON SEQUENCE arka.seq_project_code, arka.seq_customer_code TO arka_app;
