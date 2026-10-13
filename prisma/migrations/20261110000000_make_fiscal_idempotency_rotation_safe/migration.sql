-- Wave 1 / FO-TASK-005: make the fiscal idempotency namespace stable across
-- API-key rotation. The api_key_id column is intentionally retained as immutable
-- audit metadata and receives a non-unique lookup index.
--
-- Accepted starting states are deliberately narrow:
--   1. the API-key-scoped index restored by
--      20261109000000_reconcile_fiscal_idempotency_api_key_scope; or
--   2. the exact stable index state proven to have preceded that reconciliation.
--
-- No reservation is deleted, merged, or rewritten. The table lock closes the
-- old-key/new-key insertion window while uniqueness changes. Any duplicate
-- logical reservation or unexpected index definition aborts before DDL.

BEGIN;

LOCK TABLE "fiscal_idempotency_keys" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  stable_indexdef text;
  key_scoped_indexdef text;
BEGIN
  SELECT indexdef
    INTO stable_indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'fiscal_idempotency_keys'
    AND indexname = 'fiscal_idempotency_keys_tenant_company_operation_key';

  SELECT indexdef
    INTO key_scoped_indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'fiscal_idempotency_keys'
    AND indexname = 'fiscal_idempotency_keys_tenant_company_api_key_operation_key';

  IF stable_indexdef IS NOT NULL
     AND stable_indexdef <> 'CREATE UNIQUE INDEX fiscal_idempotency_keys_tenant_company_operation_key ON public.fiscal_idempotency_keys USING btree (tenant_id, company_id, operation, key)' THEN
    RAISE EXCEPTION
      'incompatible fiscal_idempotency_keys_tenant_company_operation_key: %',
      stable_indexdef;
  END IF;

  IF key_scoped_indexdef IS NOT NULL
     AND key_scoped_indexdef <> 'CREATE UNIQUE INDEX fiscal_idempotency_keys_tenant_company_api_key_operation_key ON public.fiscal_idempotency_keys USING btree (tenant_id, company_id, api_key_id, operation, key)' THEN
    RAISE EXCEPTION
      'incompatible fiscal_idempotency_keys_tenant_company_api_key_operation_key: %',
      key_scoped_indexdef;
  END IF;

  IF stable_indexdef IS NULL AND key_scoped_indexdef IS NULL THEN
    RAISE EXCEPTION 'missing recognized fiscal idempotency unique index';
  END IF;

  IF stable_indexdef IS NOT NULL AND key_scoped_indexdef IS NOT NULL THEN
    RAISE EXCEPTION 'both stable and API-key-scoped fiscal idempotency indexes exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "fiscal_idempotency_keys"
    GROUP BY "tenant_id", "company_id", "operation", "key"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'rotation-safe fiscal idempotency preflight failed: duplicate tenant/company/operation/key reservations exist';
  END IF;
END $$;

DROP INDEX IF EXISTS "fiscal_idempotency_keys_tenant_company_api_key_operation_key";

CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_idempotency_keys_tenant_company_operation_key"
  ON "fiscal_idempotency_keys"("tenant_id", "company_id", "operation", "key");

CREATE INDEX IF NOT EXISTS "fiscal_idempotency_keys_api_key_idx"
  ON "fiscal_idempotency_keys"("api_key_id");

DO $$
DECLARE
  stable_indexdef text;
  key_scoped_indexdef text;
BEGIN
  SELECT indexdef
    INTO stable_indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'fiscal_idempotency_keys'
    AND indexname = 'fiscal_idempotency_keys_tenant_company_operation_key';

  SELECT indexdef
    INTO key_scoped_indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'fiscal_idempotency_keys'
    AND indexname = 'fiscal_idempotency_keys_tenant_company_api_key_operation_key';

  IF stable_indexdef <> 'CREATE UNIQUE INDEX fiscal_idempotency_keys_tenant_company_operation_key ON public.fiscal_idempotency_keys USING btree (tenant_id, company_id, operation, key)' THEN
    RAISE EXCEPTION
      'incompatible stable fiscal idempotency index after rotation-safe transition: %',
      stable_indexdef;
  END IF;

  IF key_scoped_indexdef IS NOT NULL THEN
    RAISE EXCEPTION
      'API-key-scoped fiscal idempotency index remains after rotation-safe transition: %',
      key_scoped_indexdef;
  END IF;
END $$;

COMMIT;
