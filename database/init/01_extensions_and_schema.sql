-- =============================================================================
--  ARKA ADS STUDIO — ERP & FINANCIAL SYSTEM
--  01 — Extensions, Schema, Roles, Enumerations
--  -------------------------------------------------------------------------
--  Legal issuer of all financial/legal documents: "Ali Jafari"
--  Design principles:
--    * Schema-per-tenant isolation  (tenant schema: arka)
--    * Absolute financial precision  NUMERIC(78,0)  (amounts in minor units)
--    * Zero hard-deletes  (soft delete via deleted_at + partial indexes)
--    * Tamper-evident audit  (JSONB AFTER triggers + hash chaining)
--  Target: PostgreSQL 16+
-- =============================================================================

SET client_min_messages = WARNING;

-- ---------------------------------------------------------------------------
--  Extensions (installed in a shared schema so every tenant can reference)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid(), digest(), hmac()
CREATE EXTENSION IF NOT EXISTS pg_trgm;       -- trigram indexes for fuzzy search
CREATE EXTENSION IF NOT EXISTS btree_gist;    -- exclusion constraints (asset booking)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- convenience uuid helpers

-- ---------------------------------------------------------------------------
--  Tenant schema
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS arka;

-- Least-privilege application role (used by the NestJS connection pool).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arka_app') THEN
    CREATE ROLE arka_app LOGIN PASSWORD 'bf6db4d6e7c9f551e1f3844a11e51b490a11befe1dae955c' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END$$;

GRANT USAGE ON SCHEMA arka TO arka_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA arka GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO arka_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA arka GRANT USAGE, SELECT ON SEQUENCES TO arka_app;

SET search_path TO arka, public;

-- ---------------------------------------------------------------------------
--  Enumerated types
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE arka.user_role AS ENUM
      ('CEO','ACCOUNTANT','SALES','DESIGNER','DEVELOPER','PHOTOGRAPHER','CUSTOMER','GUEST');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type') THEN
    CREATE TYPE arka.account_type AS ENUM
      ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'normal_balance') THEN
    CREATE TYPE arka.normal_balance AS ENUM ('DEBIT','CREDIT');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journal_status') THEN
    CREATE TYPE arka.journal_status AS ENUM ('DRAFT','POSTED','REVERSED','VOID');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action') THEN
    CREATE TYPE arka.audit_action AS ENUM ('INSERT','UPDATE','DELETE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_status') THEN
    CREATE TYPE arka.project_status AS ENUM
      ('LEAD','PROPOSAL','CONTRACT','ACTIVE','ON_HOLD','DELIVERED','CLOSED','CANCELLED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customer_kind') THEN
    CREATE TYPE arka.customer_kind AS ENUM ('INDIVIDUAL','COMPANY');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_period_status') THEN
    CREATE TYPE arka.fiscal_period_status AS ENUM ('OPEN','LOCKED','CLOSED');
  END IF;
END$$;

-- ---------------------------------------------------------------------------
--  Reusable trigger: maintain updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arka.fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
--  Reusable trigger: optimistic-lock version bump on UPDATE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION arka.fn_bump_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.balance_version := COALESCE(OLD.balance_version, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;
