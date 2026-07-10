-- =============================================================================
--  ARKA ADS STUDIO — 08 — Bootstrap Seed Data
--  -------------------------------------------------------------------------
--  * Full Chart of Accounts (creative-agency, IRR, amounts in Rial).
--  * Jalali fiscal periods for year 1405.
--  * Sample customers, projects, and a set of *posted* journal entries so the
--    trial balance, P&L and dashboards render real numbers on first launch.
--  NOTE: The CEO login user is provisioned by the backend bootstrap (argon2id
--        hashing happens in the app layer), see backend/src/bootstrap.
-- =============================================================================
SET search_path TO arka, public;

-- ---------------------------------------------------------------------------
--  CHART OF ACCOUNTS — roots first, then sub-headers, then postable leaves.
--  (trg_accounts_parent_leaf auto-marks any account that gains a child as
--   non-postable, so parents need not be flagged manually.)
-- ---------------------------------------------------------------------------
INSERT INTO arka.accounts (code, name, account_type, normal_balance, parent_id) VALUES
  ('1', 'دارایی‌ها',                 'ASSET',     'DEBIT',  NULL),
  ('2', 'بدهی‌ها',                   'LIABILITY', 'CREDIT', NULL),
  ('3', 'حقوق صاحبان سرمایه',        'EQUITY',    'CREDIT', NULL),
  ('4', 'درآمدها',                   'INCOME',    'CREDIT', NULL),
  ('5', 'هزینه‌ها',                  'EXPENSE',   'DEBIT',  NULL);

-- Sub-headers
INSERT INTO arka.accounts (code, name, account_type, normal_balance, parent_id)
SELECT v.code, v.name, v.atype::arka.account_type, v.nb::arka.normal_balance,
       (SELECT id FROM arka.accounts WHERE code = v.parent)
FROM (VALUES
  ('10',   'دارایی‌های جاری',        'ASSET',     'DEBIT',  '1'),
  ('15',   'دارایی‌های ثابت',        'ASSET',     'DEBIT',  '1'),
  ('20',   'بدهی‌های جاری',          'LIABILITY', 'CREDIT', '2'),
  ('25',   'بدهی‌های بلندمدت',       'LIABILITY', 'CREDIT', '2'),
  ('50',   'هزینه‌های عملیاتی',      'EXPENSE',   'DEBIT',  '5')
) AS v(code, name, atype, nb, parent);

-- AR control (parent of per-customer sub-ledgers) under Current Assets
INSERT INTO arka.accounts (code, name, account_type, normal_balance, parent_id)
SELECT '1100', 'حساب‌های دریافتنی (کنترل)', 'ASSET', 'DEBIT',
       (SELECT id FROM arka.accounts WHERE code = '10');

-- Postable leaves
INSERT INTO arka.accounts (code, name, account_type, normal_balance, parent_id, metadata)
SELECT v.code, v.name, v.atype::arka.account_type, v.nb::arka.normal_balance,
       (SELECT id FROM arka.accounts WHERE code = v.parent),
       v.meta::jsonb
FROM (VALUES
  -- Current assets
  ('1010', 'صندوق',                        'ASSET','DEBIT','10','{"cash_flow":"true"}'),
  ('1020', 'بانک ملت - حساب اصلی',         'ASSET','DEBIT','10','{"cash_flow":"true"}'),
  ('1030', 'بانک - حساب عملیاتی',          'ASSET','DEBIT','10','{"cash_flow":"true"}'),
  ('1200', 'پیش‌پرداخت‌ها',                'ASSET','DEBIT','10','{}'),
  ('1300', 'مالیات ارزش افزوده دریافتنی',  'ASSET','DEBIT','10','{}'),
  -- Fixed assets
  ('1500', 'تجهیزات عکاسی',                'ASSET','DEBIT','15','{}'),
  ('1510', 'رایانه و تجهیزات مک',          'ASSET','DEBIT','15','{}'),
  ('1520', 'تجهیزات نور و صدا',            'ASSET','DEBIT','15','{}'),
  ('1590', 'استهلاک انباشته',              'ASSET','CREDIT','15','{}'),   -- contra-asset
  -- Current liabilities
  ('2010', 'حساب‌های پرداختنی',            'LIABILITY','CREDIT','20','{}'),
  ('2020', 'حقوق پرداختنی',                'LIABILITY','CREDIT','20','{}'),
  ('2030', 'مالیات ارزش افزوده پرداختنی',  'LIABILITY','CREDIT','20','{}'),
  ('2040', 'بیمه پرداختنی',                'LIABILITY','CREDIT','20','{}'),
  ('2050', 'مالیات پرداختنی',              'LIABILITY','CREDIT','20','{}'),
  -- Long-term liabilities
  ('2500', 'تسهیلات و وام‌ها',             'LIABILITY','CREDIT','25','{}'),
  -- Operating expenses
  ('5010', 'حقوق و دستمزد',                'EXPENSE','DEBIT','50','{}'),
  ('5020', 'اجاره',                        'EXPENSE','DEBIT','50','{}'),
  ('5030', 'آب، برق و انرژی',              'EXPENSE','DEBIT','50','{}'),
  ('5040', 'اشتراک نرم‌افزار',             'EXPENSE','DEBIT','50','{}'),
  ('5050', 'اجاره تجهیزات',                'EXPENSE','DEBIT','50','{}'),
  ('5060', 'بازاریابی و تبلیغات',          'EXPENSE','DEBIT','50','{}'),
  ('5070', 'هزینه استهلاک',                'EXPENSE','DEBIT','50','{}'),
  ('5080', 'هزینه بیمه',                   'EXPENSE','DEBIT','50','{}'),
  ('5090', 'کارمزد بانکی',                 'EXPENSE','DEBIT','50','{}'),
  ('5100', 'هزینه پیمانکار/فریلنسر',       'EXPENSE','DEBIT','50','{}'),
  ('5900', 'هزینه‌های متفرقه',             'EXPENSE','DEBIT','50','{}')
) AS v(code, name, atype, nb, parent, meta);

-- Equity leaves (directly under root 3)
INSERT INTO arka.accounts (code, name, account_type, normal_balance, parent_id)
SELECT v.code, v.name, 'EQUITY'::arka.account_type, v.nb::arka.normal_balance,
       (SELECT id FROM arka.accounts WHERE code = '3')
FROM (VALUES
  ('3010', 'سرمایه - علی جعفری',  'CREDIT'),
  ('3020', 'برداشت مالک',          'DEBIT'),    -- contra-equity
  ('3030', 'سود انباشته',          'CREDIT'),
  ('3040', 'خلاصه سود و زیان',     'CREDIT')
) AS v(code, name, nb);

-- Income leaves (directly under root 4)
INSERT INTO arka.accounts (code, name, account_type, normal_balance, parent_id)
SELECT v.code, v.name, 'INCOME'::arka.account_type, 'CREDIT'::arka.normal_balance,
       (SELECT id FROM arka.accounts WHERE code = '4')
FROM (VALUES
  ('4010', 'خدمات عکاسی'),
  ('4020', 'خدمات طراحی UI/UX'),
  ('4030', 'خدمات موشن‌گرافیک'),
  ('4040', 'تولید تبلیغات'),
  ('4090', 'سایر درآمدها')
) AS v(code, name);

-- ---------------------------------------------------------------------------
--  FISCAL PERIODS — Jalali year 1405 (Gregorian boundaries).
-- ---------------------------------------------------------------------------
INSERT INTO arka.fiscal_periods (year_code, period_no, starts_on, ends_on) VALUES
  ('1405', 1,  DATE '2026-03-21', DATE '2026-04-20'),
  ('1405', 2,  DATE '2026-04-21', DATE '2026-05-21'),
  ('1405', 3,  DATE '2026-05-22', DATE '2026-06-21'),
  ('1405', 4,  DATE '2026-06-22', DATE '2026-07-22'),
  ('1405', 5,  DATE '2026-07-23', DATE '2026-08-22'),
  ('1405', 6,  DATE '2026-08-23', DATE '2026-09-22'),
  ('1405', 7,  DATE '2026-09-23', DATE '2026-10-22'),
  ('1405', 8,  DATE '2026-10-23', DATE '2026-11-21'),
  ('1405', 9,  DATE '2026-11-22', DATE '2026-12-21'),
  ('1405', 10, DATE '2026-12-22', DATE '2027-01-20'),
  ('1405', 11, DATE '2027-01-21', DATE '2027-02-19'),
  ('1405', 12, DATE '2027-02-20', DATE '2027-03-20');

-- ---------------------------------------------------------------------------
--  No sample customers / projects / journal entries are seeded.
--  The system starts clean; all business data is entered by the user.
--  (Chart of accounts, fiscal periods and the CEO/accountant logins remain.)
-- ---------------------------------------------------------------------------

ANALYZE;
