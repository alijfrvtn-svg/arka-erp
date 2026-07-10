-- =============================================================================
--  ARKA ADS STUDIO — 10 — Human Resources, Team Workspace (Tasks), Payroll
--  -------------------------------------------------------------------------
--  Idempotent. Adds: positions, personnel, tasks (personal/group),
--  payroll_runs + payslips, code sequences, and the task.manage permission.
-- =============================================================================
SET search_path TO arka, public;

-- ---- Job positions ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS arka.positions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_positions_title ON arka.positions (lower(title));

-- ---- Personnel (HR master) --------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS arka.seq_employee_code START 1001;

CREATE TABLE IF NOT EXISTS arka.personnel (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_code     TEXT NOT NULL,
    user_id           UUID REFERENCES arka.users(id),      -- optional login link
    first_name        TEXT NOT NULL,
    last_name         TEXT NOT NULL,
    national_id_enc   BYTEA,                               -- envelope-encrypted
    national_id_last4 TEXT,
    birth_date        DATE,
    gender            TEXT,
    phone             TEXT,
    email             TEXT,
    address           TEXT,
    position_id       UUID REFERENCES arka.positions(id),
    department        TEXT,
    hire_date         DATE,
    base_salary       NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
    iban_enc          BYTEA,
    iban_last4        TEXT,
    employment_status TEXT NOT NULL DEFAULT 'ACTIVE',      -- ACTIVE|ON_LEAVE|TERMINATED
    emergency_contact TEXT,
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by        UUID REFERENCES arka.users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,
    deleted_by        UUID REFERENCES arka.users(id),
    deleted_reason    TEXT,
    CONSTRAINT chk_emp_status CHECK (employment_status IN ('ACTIVE','ON_LEAVE','TERMINATED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_personnel_code ON arka.personnel (employee_code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_personnel_user ON arka.personnel (user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_personnel_position ON arka.personnel (position_id);

DROP TRIGGER IF EXISTS trg_personnel_touch ON arka.personnel;
CREATE TRIGGER trg_personnel_touch BEFORE UPDATE ON arka.personnel
    FOR EACH ROW EXECUTE FUNCTION arka.fn_touch_updated_at();
DROP TRIGGER IF EXISTS trg_personnel_audit ON arka.personnel;
CREATE TRIGGER trg_personnel_audit AFTER INSERT OR UPDATE OR DELETE ON arka.personnel
    FOR EACH ROW EXECUTE FUNCTION arka.fn_audit();

-- ---- Tasks (team workspace: personal + group) -------------------------------
CREATE SEQUENCE IF NOT EXISTS arka.seq_task_code START 1;

CREATE TABLE IF NOT EXISTS arka.tasks (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_code      TEXT NOT NULL,
    title          TEXT NOT NULL,
    description    TEXT,
    kind           TEXT NOT NULL DEFAULT 'PERSONAL',       -- PERSONAL | GROUP
    assignee_id    UUID REFERENCES arka.users(id),         -- NULL when GROUP
    project_id     UUID REFERENCES arka.projects(id),
    status         TEXT NOT NULL DEFAULT 'TODO',           -- TODO|IN_PROGRESS|DONE|BLOCKED
    priority       TEXT NOT NULL DEFAULT 'NORMAL',         -- LOW|NORMAL|HIGH|URGENT
    due_date       DATE,
    progress_pct   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
    created_by     UUID REFERENCES arka.users(id),
    completed_at   TIMESTAMPTZ,
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ,
    deleted_by     UUID REFERENCES arka.users(id),
    deleted_reason TEXT,
    CONSTRAINT chk_task_kind     CHECK (kind IN ('PERSONAL','GROUP')),
    CONSTRAINT chk_task_status   CHECK (status IN ('TODO','IN_PROGRESS','DONE','BLOCKED')),
    CONSTRAINT chk_task_priority CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON arka.tasks (assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_kind     ON arka.tasks (kind) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_project  ON arka.tasks (project_id);

DROP TRIGGER IF EXISTS trg_tasks_touch ON arka.tasks;
CREATE TRIGGER trg_tasks_touch BEFORE UPDATE ON arka.tasks
    FOR EACH ROW EXECUTE FUNCTION arka.fn_touch_updated_at();
DROP TRIGGER IF EXISTS trg_tasks_audit ON arka.tasks;
CREATE TRIGGER trg_tasks_audit AFTER INSERT OR UPDATE OR DELETE ON arka.tasks
    FOR EACH ROW EXECUTE FUNCTION arka.fn_audit();

-- ---- Payroll ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arka.payroll_runs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_code      TEXT NOT NULL,                        -- e.g. 1405-04
    run_date         DATE NOT NULL DEFAULT current_date,
    status           TEXT NOT NULL DEFAULT 'DRAFT',        -- DRAFT|POSTED
    total_net        NUMERIC(78,0) NOT NULL DEFAULT 0,
    journal_entry_id UUID REFERENCES arka.journal_entries(id),
    notes            TEXT,
    created_by       UUID REFERENCES arka.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_payroll_status CHECK (status IN ('DRAFT','POSTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_period ON arka.payroll_runs (period_code);

CREATE TABLE IF NOT EXISTS arka.payslips (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id       UUID NOT NULL REFERENCES arka.payroll_runs(id) ON DELETE CASCADE,
    personnel_id UUID NOT NULL REFERENCES arka.personnel(id),
    base_salary  NUMERIC(78,0) NOT NULL DEFAULT 0,
    additions    NUMERIC(78,0) NOT NULL DEFAULT 0,
    deductions   NUMERIC(78,0) NOT NULL DEFAULT 0,
    tax          NUMERIC(78,0) NOT NULL DEFAULT 0,
    insurance    NUMERIC(78,0) NOT NULL DEFAULT 0,
    net          NUMERIC(78,0) NOT NULL DEFAULT 0,
    detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payslips_run ON arka.payslips (run_id);
CREATE INDEX IF NOT EXISTS idx_payslips_personnel ON arka.payslips (personnel_id);

-- ---- Permissions ------------------------------------------------------------
INSERT INTO arka.permissions (code, description, category) VALUES
  ('task.manage', 'Create and assign team tasks', 'workspace')
ON CONFLICT (code) DO NOTHING;

-- CEO manages tasks. Payroll (payroll.run) stays with ACCOUNTANT by SoD design
-- (it conflicts with user.manage which the CEO holds). The owner can still
-- self-grant payroll.run to any account via the per-user permission checkboxes.
INSERT INTO arka.role_permissions (role, permission) VALUES
  ('CEO','task.manage')
ON CONFLICT DO NOTHING;

-- ---- Convenience view: personnel with position + linked user ---------------
CREATE OR REPLACE VIEW arka.v_personnel AS
SELECT p.id, p.employee_code, p.user_id, p.first_name, p.last_name,
       (p.first_name || ' ' || p.last_name) AS full_name,
       p.national_id_last4, p.birth_date, p.gender, p.phone, p.email, p.address,
       p.position_id, pos.title AS position_title, p.department, p.hire_date,
       p.base_salary, p.iban_last4, p.employment_status, p.emergency_contact,
       u.email AS login_email, p.created_at, p.deleted_at, p.deleted_reason,
       p.deleted_by
FROM arka.personnel p
LEFT JOIN arka.positions pos ON pos.id = p.position_id
LEFT JOIN arka.users u ON u.id = p.user_id;

-- ---- Grants -----------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  arka.positions, arka.personnel, arka.tasks, arka.payroll_runs, arka.payslips TO arka_app;
GRANT SELECT ON arka.v_personnel TO arka_app;
GRANT USAGE, SELECT ON SEQUENCE arka.seq_employee_code, arka.seq_task_code TO arka_app;
