-- W1-D2 laboratory expand migration. Apply only through the guarded disposable
-- PostgreSQL harness until ADR-BIL-011/012 and the DBA gate are formally approved.
-- Existing v1 association, reservation, credentials, documents and indexes remain.

CREATE UNIQUE INDEX companies_id_tenant_v2_key ON companies(id, tenant_id);
CREATE UNIQUE INDEX api_keys_id_tenant_v2_key ON api_keys(id, tenant_id);

ALTER TABLE api_keys DROP CONSTRAINT api_keys_integration_profile_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_integration_profile_check
  CHECK (integration_profile IS NULL OR integration_profile IN
    ('inventori-fiscal-v1', 'inventori-bootstrap-v1', 'billing-consumer-v2'));

CREATE TABLE fiscal_consumers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  provider varchar(64) NOT NULL,
  external_consumer_key varchar(128) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT fiscal_consumers_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fiscal_consumers_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  CONSTRAINT fiscal_consumers_provider_check CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT fiscal_consumers_external_key_check CHECK (length(btrim(external_consumer_key)) > 0)
);
CREATE UNIQUE INDEX fiscal_consumers_tenant_provider_external_key
  ON fiscal_consumers(tenant_id, provider, external_consumer_key);
CREATE UNIQUE INDEX fiscal_consumers_id_tenant_key ON fiscal_consumers(id, tenant_id);

CREATE TABLE fiscal_consumer_companies (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  consumer_id uuid NOT NULL,
  company_id uuid NOT NULL,
  external_company_key varchar(128) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT fiscal_consumer_companies_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fiscal_consumer_companies_consumer_fkey FOREIGN KEY (consumer_id, tenant_id)
    REFERENCES fiscal_consumers(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fiscal_consumer_companies_company_fkey FOREIGN KEY (company_id, tenant_id)
    REFERENCES companies(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fiscal_consumer_companies_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  CONSTRAINT fiscal_consumer_companies_external_key_check CHECK (length(btrim(external_company_key)) > 0)
);
CREATE UNIQUE INDEX fiscal_consumer_companies_tenant_consumer_company_key
  ON fiscal_consumer_companies(tenant_id, consumer_id, company_id);
CREATE UNIQUE INDEX fiscal_consumer_companies_tenant_consumer_external_key
  ON fiscal_consumer_companies(tenant_id, consumer_id, external_company_key);
CREATE UNIQUE INDEX fiscal_consumer_companies_id_tenant_key
  ON fiscal_consumer_companies(id, tenant_id);

CREATE TABLE fiscal_consumer_associations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  consumer_company_id uuid NOT NULL,
  environment "HaciendaEnvironment" NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT fiscal_consumer_associations_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fiscal_consumer_associations_mapping_fkey FOREIGN KEY (consumer_company_id, tenant_id)
    REFERENCES fiscal_consumer_companies(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fiscal_consumer_associations_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED'))
);
CREATE UNIQUE INDEX fiscal_consumer_associations_company_environment_key
  ON fiscal_consumer_associations(consumer_company_id, environment);
CREATE UNIQUE INDEX fiscal_consumer_associations_id_tenant_key
  ON fiscal_consumer_associations(id, tenant_id);
CREATE UNIQUE INDEX fiscal_consumer_associations_id_tenant_environment_key
  ON fiscal_consumer_associations(id, tenant_id, environment);

CREATE TABLE fiscal_consumer_key_bindings (
  api_key_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  association_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_consumer_key_bindings_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fiscal_consumer_key_bindings_key_fkey FOREIGN KEY (api_key_id, tenant_id)
    REFERENCES api_keys(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fiscal_consumer_key_bindings_association_fkey FOREIGN KEY (association_id, tenant_id)
    REFERENCES fiscal_consumer_associations(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX fiscal_consumer_key_bindings_key_tenant_key
  ON fiscal_consumer_key_bindings(api_key_id, tenant_id);
CREATE INDEX fiscal_consumer_key_bindings_association_idx
  ON fiscal_consumer_key_bindings(association_id, tenant_id);

-- A binding cannot reuse an Inventori key or cross the TEST/LIVE environment.
CREATE FUNCTION billing_validate_consumer_v2_key_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE key_profile text; key_environment "ApiKeyEnv"; association_environment "HaciendaEnvironment";
BEGIN
  SELECT integration_profile, environment INTO key_profile, key_environment
    FROM api_keys WHERE id = NEW.api_key_id AND tenant_id = NEW.tenant_id;
  SELECT environment INTO association_environment
    FROM fiscal_consumer_associations WHERE id = NEW.association_id AND tenant_id = NEW.tenant_id;
  IF key_profile IS DISTINCT FROM 'billing-consumer-v2'
     OR (key_environment = 'TEST' AND association_environment IS DISTINCT FROM 'SANDBOX')
     OR (key_environment = 'LIVE' AND association_environment IS DISTINCT FROM 'PRODUCTION') THEN
    RAISE EXCEPTION 'invalid v2 credential binding' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fiscal_consumer_key_binding_validate
  BEFORE INSERT OR UPDATE ON fiscal_consumer_key_bindings
  FOR EACH ROW EXECUTE FUNCTION billing_validate_consumer_v2_key_binding();

CREATE FUNCTION billing_protect_bound_consumer_v2_key() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM fiscal_consumer_key_bindings WHERE api_key_id = OLD.id)
     AND (NEW.integration_profile IS DISTINCT FROM OLD.integration_profile
          OR NEW.environment IS DISTINCT FROM OLD.environment
          OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
    RAISE EXCEPTION 'bound v2 key identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER api_keys_protect_bound_consumer_v2_key
  BEFORE UPDATE ON api_keys FOR EACH ROW
  EXECUTE FUNCTION billing_protect_bound_consumer_v2_key();

CREATE TABLE fiscal_idempotency_keys_v2 (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  association_id uuid NOT NULL,
  environment "HaciendaEnvironment" NOT NULL,
  operation varchar(60) NOT NULL,
  key varchar(128) NOT NULL,
  request_hash_version varchar(80) NOT NULL,
  request_hash char(64) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'RESERVED',
  fiscal_document_id uuid,
  first_api_key_id uuid,
  attempt_count integer NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT fiscal_idempotency_keys_v2_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fiscal_idempotency_keys_v2_association_fkey
    FOREIGN KEY (association_id, tenant_id, environment)
    REFERENCES fiscal_consumer_associations(id, tenant_id, environment)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fiscal_idempotency_keys_v2_document_fkey FOREIGN KEY (fiscal_document_id)
    REFERENCES fiscal_documents(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fiscal_idempotency_keys_v2_first_key_fkey FOREIGN KEY (first_api_key_id, tenant_id)
    REFERENCES api_keys(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fiscal_idempotency_keys_v2_operation_check CHECK (operation = 'CREATE_INVOICE'),
  CONSTRAINT fiscal_idempotency_keys_v2_key_check CHECK (length(btrim(key)) > 0),
  CONSTRAINT fiscal_idempotency_keys_v2_hash_version_check
    CHECK (request_hash_version ~ '^[a-z][a-z0-9.-]*$'),
  CONSTRAINT fiscal_idempotency_keys_v2_hash_check CHECK (request_hash ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT fiscal_idempotency_keys_v2_state_check
    CHECK (state IN ('RESERVED', 'COMMITTED', 'RECOVERY_REQUIRED', 'ABORTED_BEFORE_ALLOCATION')),
  CONSTRAINT fiscal_idempotency_keys_v2_state_document_check
    CHECK ((state = 'COMMITTED' AND fiscal_document_id IS NOT NULL)
      OR (state IN ('RESERVED', 'ABORTED_BEFORE_ALLOCATION') AND fiscal_document_id IS NULL)
      OR state = 'RECOVERY_REQUIRED'),
  CONSTRAINT fiscal_idempotency_keys_v2_counters_check
    CHECK (attempt_count >= 0 AND version >= 0)
);
CREATE UNIQUE INDEX fiscal_idempotency_keys_v2_namespace_key
  ON fiscal_idempotency_keys_v2(association_id, environment, operation, key);
CREATE INDEX fiscal_idempotency_keys_v2_recovery_idx
  ON fiscal_idempotency_keys_v2(tenant_id, association_id, state, lease_expires_at);

-- Nullable origin columns preserve every historical v1 document untouched.
ALTER TABLE fiscal_documents
  ADD COLUMN origin_consumer_id uuid,
  ADD COLUMN origin_association_id uuid,
  ADD CONSTRAINT fiscal_documents_v2_origin_pair_check
    CHECK ((origin_consumer_id IS NULL) = (origin_association_id IS NULL)),
  ADD CONSTRAINT fiscal_documents_v2_origin_consumer_fkey
    FOREIGN KEY (origin_consumer_id, tenant_id) REFERENCES fiscal_consumers(id, tenant_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT fiscal_documents_v2_origin_association_fkey
    FOREIGN KEY (origin_association_id, tenant_id, environment)
    REFERENCES fiscal_consumer_associations(id, tenant_id, environment)
    ON UPDATE RESTRICT ON DELETE RESTRICT;
CREATE INDEX fiscal_documents_v2_origin_idx
  ON fiscal_documents(tenant_id, origin_association_id, created_at DESC);

CREATE FUNCTION billing_validate_v2_document_origin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origin_association_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM fiscal_consumer_associations a
      JOIN fiscal_consumer_companies m ON m.id = a.consumer_company_id
    WHERE a.id = NEW.origin_association_id AND a.tenant_id = NEW.tenant_id
      AND a.environment = NEW.environment AND m.consumer_id = NEW.origin_consumer_id
      AND m.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'v2 document origin does not match consumer and issuer' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fiscal_documents_validate_v2_origin
  BEFORE INSERT OR UPDATE OF origin_consumer_id, origin_association_id, company_id, tenant_id, environment
  ON fiscal_documents FOR EACH ROW
  EXECUTE FUNCTION billing_validate_v2_document_origin();
