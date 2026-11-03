-- Laboratory-only enrollment profile. Apply only in guarded disposable PostgreSQL.
ALTER TABLE api_keys DROP CONSTRAINT api_keys_integration_profile_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_integration_profile_check
  CHECK (integration_profile IS NULL OR integration_profile IN
    ('inventori-fiscal-v1', 'inventori-bootstrap-v1', 'billing-consumer-v2',
     'affiliations-enrollment-v2'));

ALTER TABLE fiscal_onboarding_mutations_v2
  DROP CONSTRAINT fiscal_onboarding_mutation_v2_operation_check;
ALTER TABLE fiscal_onboarding_mutations_v2
  ADD CONSTRAINT fiscal_onboarding_mutation_v2_operation_check
  CHECK (operation IN ('CERTIFICATE_UPLOAD', 'CREDENTIALS_CONFIGURE',
                       'CREDENTIALS_ROTATE', 'INITIAL_ENROLLMENT'));

CREATE OR REPLACE FUNCTION billing_validate_consumer_v2_key_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  key_profile text;
  key_name text;
  key_environment "ApiKeyEnv";
  association_environment "HaciendaEnvironment";
  association_company_id uuid;
  external_company_key text;
BEGIN
  SELECT integration_profile, name, environment
    INTO key_profile, key_name, key_environment
    FROM api_keys WHERE id = NEW.api_key_id AND tenant_id = NEW.tenant_id;
  SELECT a.environment, m.company_id, m.external_company_key
    INTO association_environment, association_company_id, external_company_key
    FROM fiscal_consumer_associations a
    JOIN fiscal_consumer_companies m ON m.id = a.consumer_company_id
    WHERE a.id = NEW.association_id AND a.tenant_id = NEW.tenant_id;
  IF key_profile IS DISTINCT FROM 'billing-consumer-v2'
     AND key_profile IS DISTINCT FROM 'affiliations-enrollment-v2' THEN
    RAISE EXCEPTION 'invalid v2 credential binding' USING ERRCODE = '23514';
  END IF;
  IF (key_environment = 'TEST' AND association_environment IS DISTINCT FROM 'SANDBOX')
     OR (key_environment = 'LIVE' AND association_environment IS DISTINCT FROM 'PRODUCTION') THEN
    RAISE EXCEPTION 'invalid v2 credential binding' USING ERRCODE = '23514';
  END IF;
  IF key_profile = 'affiliations-enrollment-v2'
     AND (key_environment IS DISTINCT FROM 'TEST'
       OR key_name IS DISTINCT FROM 'affiliations-enrollment:' || external_company_key
       OR (SELECT count(*) FROM api_key_companies WHERE api_key_id = NEW.api_key_id) <> 1
       OR NOT EXISTS (SELECT 1 FROM api_key_companies
                      WHERE api_key_id = NEW.api_key_id
                        AND company_id = association_company_id)) THEN
    RAISE EXCEPTION 'invalid enrollment credential binding' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION billing_protect_bound_consumer_v2_key() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM fiscal_consumer_key_bindings WHERE api_key_id = OLD.id)
     AND (NEW.integration_profile IS DISTINCT FROM OLD.integration_profile
          OR NEW.environment IS DISTINCT FROM OLD.environment
          OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
          OR (OLD.integration_profile = 'affiliations-enrollment-v2'
              AND NEW.name IS DISTINCT FROM OLD.name)) THEN
    RAISE EXCEPTION 'bound v2 key identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
