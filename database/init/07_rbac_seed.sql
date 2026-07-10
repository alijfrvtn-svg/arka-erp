-- =============================================================================
--  ARKA ADS STUDIO — 07 — RBAC Catalogue, Role Grants, Segregation of Duties
--  -------------------------------------------------------------------------
--  Maker/checker model. Grants are deliberately arranged so NO single role
--  ever holds a conflicting pair — the fn_enforce_sod trigger would reject it.
-- =============================================================================
SET search_path TO arka, public;

-- ---------------------------------------------------------------------------
--  1) Permission catalogue
-- ---------------------------------------------------------------------------
INSERT INTO arka.permissions (code, description, category) VALUES
  ('ledger.view',      'View journal entries and ledgers',            'ledger'),
  ('ledger.create',    'Draft journal entries',                       'ledger'),
  ('ledger.post',      'Post (finalise) journal entries',             'ledger'),
  ('ledger.reverse',   'Reverse posted journal entries',              'ledger'),
  ('fund.transfer',    'Execute bank/cashbox fund transfers',         'treasury'),
  ('invoice.issue',    'Issue customer invoices',                     'sales'),
  ('invoice.approve',  'Approve issued invoices',                     'sales'),
  ('report.financial', 'Access financial statements',                 'reporting'),
  ('report.ceo',       'Access CEO dashboard & board reports',        'reporting'),
  ('project.view',     'View projects',                               'projects'),
  ('project.manage',   'Create/update/close projects & tasks',        'projects'),
  ('customer.view',    'View customers',                              'crm'),
  ('customer.manage',  'Create/update customers',                     'crm'),
  ('hr.view',          'View personnel records',                      'hr'),
  ('hr.manage',        'Manage personnel lifecycle',                  'hr'),
  ('payroll.run',      'Execute payroll runs',                        'hr'),
  ('asset.view',       'View assets/inventory',                       'assets'),
  ('asset.manage',     'Check-in/out, maintenance, depreciation',     'assets'),
  ('user.manage',      'Create/disable user accounts',                'admin'),
  ('role.manage',      'Assign roles & permissions',                  'admin'),
  ('audit.view',       'Read the audit trail',                        'admin'),
  ('ai.query',         'Use AI analytics / chat-with-database',       'analytics'),
  ('system.admin',     'System configuration & monitoring',           'admin')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
--  2) Segregation-of-Duties conflicts (permission_a < permission_b enforced)
-- ---------------------------------------------------------------------------
INSERT INTO arka.sod_conflicts (permission_a, permission_b, reason) VALUES
  ('fund.transfer',   'ledger.reverse', 'A person who moves funds must not also reverse the ledger record of it'),
  ('invoice.approve', 'invoice.issue',  'Invoice issuer must differ from invoice approver (maker/checker)'),
  ('ledger.post',     'user.manage',    'Ledger poster must not administer users/roles (privilege escalation)'),
  ('payroll.run',     'user.manage',    'Payroll operator must not administer user accounts')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
--  3) Role grants (validated against SoD on insert)
-- ---------------------------------------------------------------------------

-- CEO — oversight, correction authority, administration. Executes NO postings
-- or transfers (that is the accountant's execution duty).
INSERT INTO arka.role_permissions (role, permission) VALUES
  ('CEO','ledger.view'), ('CEO','ledger.reverse'), ('CEO','invoice.approve'),
  ('CEO','report.financial'), ('CEO','report.ceo'),
  ('CEO','project.view'), ('CEO','project.manage'),
  ('CEO','customer.view'), ('CEO','customer.manage'), ('CEO','hr.view'), ('CEO','hr.manage'),
  ('CEO','asset.view'), ('CEO','user.manage'), ('CEO','role.manage'),
  ('CEO','audit.view'), ('CEO','ai.query'), ('CEO','system.admin')
ON CONFLICT DO NOTHING;

-- ACCOUNTANT — financial execution: drafts, posts, transfers, invoices, payroll.
INSERT INTO arka.role_permissions (role, permission) VALUES
  ('ACCOUNTANT','ledger.view'), ('ACCOUNTANT','ledger.create'),
  ('ACCOUNTANT','ledger.post'), ('ACCOUNTANT','fund.transfer'),
  ('ACCOUNTANT','invoice.issue'), ('ACCOUNTANT','report.financial'),
  ('ACCOUNTANT','customer.view'), ('ACCOUNTANT','project.view'),
  ('ACCOUNTANT','asset.view'), ('ACCOUNTANT','hr.view'),
  ('ACCOUNTANT','payroll.run')
ON CONFLICT DO NOTHING;

-- SALES — CRM & invoice origination.
INSERT INTO arka.role_permissions (role, permission) VALUES
  ('SALES','customer.view'), ('SALES','customer.manage'),
  ('SALES','project.view'), ('SALES','invoice.issue'), ('SALES','ai.query')
ON CONFLICT DO NOTHING;

-- DESIGNER / DEVELOPER — delivery contributors.
INSERT INTO arka.role_permissions (role, permission) VALUES
  ('DESIGNER','project.view'),  ('DESIGNER','asset.view'),
  ('DEVELOPER','project.view'), ('DEVELOPER','asset.view')
ON CONFLICT DO NOTHING;

-- PHOTOGRAPHER — delivery + gear custody.
INSERT INTO arka.role_permissions (role, permission) VALUES
  ('PHOTOGRAPHER','project.view'), ('PHOTOGRAPHER','asset.view'),
  ('PHOTOGRAPHER','asset.manage')
ON CONFLICT DO NOTHING;

-- CUSTOMER — self-service (row scope enforced in the app layer).
INSERT INTO arka.role_permissions (role, permission) VALUES
  ('CUSTOMER','project.view')
ON CONFLICT DO NOTHING;

-- GUEST — no grants (authentication landing only).

-- ---------------------------------------------------------------------------
--  Convenience: effective permissions per user
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW arka.v_user_permissions AS
SELECT u.id AS user_id, u.email, u.role, rp.permission
FROM arka.users u
JOIN arka.role_permissions rp ON rp.role = u.role
WHERE u.deleted_at IS NULL;

GRANT SELECT ON arka.v_user_permissions TO arka_app;
