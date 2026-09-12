-- F2.2 idempotency scope hardening: tenant + company + api key + operation + key.

ALTER TABLE "fiscal_idempotency_keys" ADD COLUMN "api_key_id" UUID;
ALTER TABLE "fiscal_idempotency_keys" ADD COLUMN "operation" VARCHAR(60) NOT NULL DEFAULT 'fiscal-document.create';

DROP INDEX IF EXISTS "fiscal_idempotency_keys_tenant_company_key";
CREATE UNIQUE INDEX "fiscal_idempotency_keys_tenant_company_api_key_operation_key"
  ON "fiscal_idempotency_keys"("tenant_id", "company_id", "api_key_id", "operation", "key");

ALTER TABLE "fiscal_idempotency_keys"
  ADD CONSTRAINT "fiscal_idempotency_keys_api_key_id_fkey"
  FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
