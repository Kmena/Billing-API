-- Post-F2.2 remediation: fiscal document uniqueness and idempotency constraints.
-- Consecutive values are scoped by tenant/company/environment; Clave remains globally unique.
-- FiscalIdempotencyKey is the canonical idempotency uniqueness boundary.

DROP INDEX IF EXISTS "fiscal_documents_consecutive_key";

CREATE UNIQUE INDEX "fiscal_documents_tenant_company_environment_consecutive_key"
  ON "fiscal_documents"("tenant_id", "company_id", "environment", "consecutive");

DROP INDEX IF EXISTS "fiscal_documents_tenant_company_idempotency_key";

CREATE INDEX "fiscal_documents_tenant_company_idempotency_key_idx"
  ON "fiscal_documents"("tenant_id", "company_id", "idempotency_key");
