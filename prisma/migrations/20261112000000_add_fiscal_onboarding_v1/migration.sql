-- Wave 3 / FO-TASK-015, FO-TASK-019.
-- Additive, forward-only fiscal onboarding persistence. This migration does not
-- modify fiscal documents, idempotency reservations, claves, consecutives or
-- sequence values.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM fiscal_issuance_points
    WHERE active = true AND is_default = true
    GROUP BY tenant_id, company_id, environment
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'wave3 preflight failed: multiple active default issuance points exist for one tenant/company/environment';
  END IF;
END $$;

ALTER TABLE api_keys
  ADD COLUMN integration_profile varchar(80);

ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_integration_profile_check
  CHECK (integration_profile IS NULL OR integration_profile = 'inventori-fiscal-v1');

CREATE TABLE fiscal_integration_associations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  provider varchar(40) NOT NULL DEFAULT 'INVENTORI',
  external_company_key varchar(128) NOT NULL,
  profile_version varchar(80) NOT NULL DEFAULT 'inventori-fiscal-v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT fiscal_integration_associations_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fiscal_integration_associations_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fiscal_integration_associations_profile_check
    CHECK (profile_version = 'inventori-fiscal-v1')
);

CREATE UNIQUE INDEX fiscal_integration_associations_company_id_key
  ON fiscal_integration_associations(company_id);
CREATE UNIQUE INDEX fiscal_integration_associations_tenant_provider_external_key
  ON fiscal_integration_associations(tenant_id, provider, external_company_key);
CREATE INDEX fiscal_integration_associations_tenant_company_idx
  ON fiscal_integration_associations(tenant_id, company_id);

CREATE TABLE fiscal_branches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  environment "HaciendaEnvironment" NOT NULL,
  code char(3) NOT NULL,
  name varchar(120) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT fiscal_branches_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fiscal_branches_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fiscal_branches_code_check CHECK (code ~ '^[0-9]{3}$')
);

CREATE UNIQUE INDEX fiscal_branches_company_environment_code_key
  ON fiscal_branches(company_id, environment, code);
CREATE INDEX fiscal_branches_tenant_company_environment_active_idx
  ON fiscal_branches(tenant_id, company_id, environment, active);

CREATE TABLE fiscal_terminals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  environment "HaciendaEnvironment" NOT NULL,
  code char(5) NOT NULL,
  name varchar(120) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT fiscal_terminals_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fiscal_terminals_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fiscal_terminals_branch_id_fkey
    FOREIGN KEY (branch_id) REFERENCES fiscal_branches(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fiscal_terminals_code_check CHECK (code ~ '^[0-9]{5}$')
);

CREATE UNIQUE INDEX fiscal_terminals_branch_code_key ON fiscal_terminals(branch_id, code);
CREATE INDEX fiscal_terminals_tenant_company_environment_active_idx
  ON fiscal_terminals(tenant_id, company_id, environment, active);

ALTER TABLE fiscal_issuance_points
  ADD COLUMN branch_id uuid,
  ADD COLUMN terminal_id uuid;

INSERT INTO fiscal_branches (id, tenant_id, company_id, environment, code, name, active, created_at, updated_at)
SELECT (
    substr(md5(company_id::text || ':' || environment::text || ':' || branch_code), 1, 8) || '-' ||
    substr(md5(company_id::text || ':' || environment::text || ':' || branch_code), 9, 4) || '-' ||
    substr(md5(company_id::text || ':' || environment::text || ':' || branch_code), 13, 4) || '-' ||
    substr(md5(company_id::text || ':' || environment::text || ':' || branch_code), 17, 4) || '-' ||
    substr(md5(company_id::text || ':' || environment::text || ':' || branch_code), 21, 12)
  )::uuid,
  tenant_id, company_id, environment, branch_code,
  coalesce(min(name), 'Fiscal branch ' || branch_code), bool_or(active), min(created_at), max(updated_at)
FROM fiscal_issuance_points
GROUP BY tenant_id, company_id, environment, branch_code;

INSERT INTO fiscal_terminals (id, tenant_id, company_id, branch_id, environment, code, name, active, created_at, updated_at)
SELECT (
    substr(md5(p.company_id::text || ':' || p.environment::text || ':' || p.branch_code || ':' || p.terminal_code), 1, 8) || '-' ||
    substr(md5(p.company_id::text || ':' || p.environment::text || ':' || p.branch_code || ':' || p.terminal_code), 9, 4) || '-' ||
    substr(md5(p.company_id::text || ':' || p.environment::text || ':' || p.branch_code || ':' || p.terminal_code), 13, 4) || '-' ||
    substr(md5(p.company_id::text || ':' || p.environment::text || ':' || p.branch_code || ':' || p.terminal_code), 17, 4) || '-' ||
    substr(md5(p.company_id::text || ':' || p.environment::text || ':' || p.branch_code || ':' || p.terminal_code), 21, 12)
  )::uuid,
  p.tenant_id, p.company_id, b.id, p.environment, p.terminal_code,
  coalesce(p.name, 'Fiscal terminal ' || p.terminal_code), p.active, p.created_at, p.updated_at
FROM fiscal_issuance_points p
JOIN fiscal_branches b
  ON b.company_id = p.company_id AND b.environment = p.environment AND b.code = p.branch_code;

UPDATE fiscal_issuance_points p
SET branch_id = b.id, terminal_id = t.id
FROM fiscal_branches b
JOIN fiscal_terminals t ON t.branch_id = b.id
WHERE b.company_id = p.company_id
  AND b.environment = p.environment
  AND b.code = p.branch_code
  AND t.code = p.terminal_code;

ALTER TABLE fiscal_issuance_points
  ADD CONSTRAINT fiscal_issuance_points_branch_id_fkey
    FOREIGN KEY (branch_id) REFERENCES fiscal_branches(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT fiscal_issuance_points_terminal_id_fkey
    FOREIGN KEY (terminal_id) REFERENCES fiscal_terminals(id) ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX fiscal_issuance_points_branch_id_idx ON fiscal_issuance_points(branch_id);
CREATE INDEX fiscal_issuance_points_terminal_id_idx ON fiscal_issuance_points(terminal_id);
CREATE UNIQUE INDEX fiscal_issuance_points_one_active_default_per_environment
  ON fiscal_issuance_points(tenant_id, company_id, environment)
  WHERE active = true AND is_default = true;
