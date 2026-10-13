-- Reconcile a local historical idempotency index drift without recreating the
-- unavailable 20261103000000_fix_idempotency_api_key_rotation migration.
--
-- Expected legacy state:
--   (tenant_id, company_id, operation, key)
-- Canonical state from 20260911143000_fiscal_idempotency_scope:
--   (tenant_id, company_id, api_key_id, operation, key)
--
-- This migration intentionally fails closed for any other index definition or
-- for canonical-key duplicates before dropping the legacy unique index.

DO $$
DECLARE
  legacy_indexdef text;
  canonical_indexdef text;
BEGIN
  SELECT indexdef
    INTO legacy_indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'fiscal_idempotency_keys'
    AND indexname = 'fiscal_idempotency_keys_tenant_company_operation_key';

  SELECT indexdef
    INTO canonical_indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'fiscal_idempotency_keys'
    AND indexname = 'fiscal_idempotency_keys_tenant_company_api_key_operation_key';

  IF canonical_indexdef IS NOT NULL THEN
    IF canonical_indexdef <> 'CREATE UNIQUE INDEX fiscal_idempotency_keys_tenant_company_api_key_operation_key ON public.fiscal_idempotency_keys USING btree (tenant_id, company_id, api_key_id, operation, key)' THEN
      RAISE EXCEPTION
        'incompatible fiscal_idempotency_keys_tenant_company_api_key_operation_key: %',
        canonical_indexdef;
    END IF;

    IF legacy_indexdef IS NOT NULL THEN
      RAISE EXCEPTION
        'both canonical and legacy fiscal idempotency unique indexes exist';
    END IF;

    RETURN;
  END IF;

  IF legacy_indexdef IS NULL THEN
    RAISE EXCEPTION
      'missing expected fiscal_idempotency_keys_tenant_company_operation_key';
  END IF;

  IF legacy_indexdef <> 'CREATE UNIQUE INDEX fiscal_idempotency_keys_tenant_company_operation_key ON public.fiscal_idempotency_keys USING btree (tenant_id, company_id, operation, key)' THEN
    RAISE EXCEPTION
      'incompatible fiscal_idempotency_keys_tenant_company_operation_key: %',
      legacy_indexdef;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "fiscal_idempotency_keys"
    GROUP BY "tenant_id", "company_id", "api_key_id", "operation", "key"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'canonical fiscal idempotency key duplicates exist';
  END IF;
END $$;

DROP INDEX IF EXISTS "fiscal_idempotency_keys_tenant_company_operation_key";

CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_idempotency_keys_tenant_company_api_key_operation_key"
  ON "fiscal_idempotency_keys"("tenant_id", "company_id", "api_key_id", "operation", "key");

DO $$
DECLARE
  canonical_indexdef text;
BEGIN
  SELECT indexdef
    INTO canonical_indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'fiscal_idempotency_keys'
    AND indexname = 'fiscal_idempotency_keys_tenant_company_api_key_operation_key';

  IF canonical_indexdef <> 'CREATE UNIQUE INDEX fiscal_idempotency_keys_tenant_company_api_key_operation_key ON public.fiscal_idempotency_keys USING btree (tenant_id, company_id, api_key_id, operation, key)' THEN
    RAISE EXCEPTION
      'incompatible canonical fiscal idempotency index after reconciliation: %',
      canonical_indexdef;
  END IF;
END $$;