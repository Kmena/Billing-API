-- F2.2 Fiscal Document Core

CREATE TYPE "FiscalDocumentType" AS ENUM ('INVOICE', 'TICKET');
CREATE TYPE "FiscalDocumentStatus" AS ENUM ('READY_FOR_XML');
CREATE TYPE "FiscalIdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

CREATE TABLE "fiscal_issuance_points" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "environment" "HaciendaEnvironment" NOT NULL,
  "branch_code" CHAR(3) NOT NULL,
  "terminal_code" CHAR(5) NOT NULL,
  "name" VARCHAR(120),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fiscal_issuance_points_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fiscal_sequences" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "environment" "HaciendaEnvironment" NOT NULL,
  "branch_code" CHAR(3) NOT NULL,
  "terminal_code" CHAR(5) NOT NULL,
  "document_type" "FiscalDocumentType" NOT NULL,
  "next_value" BIGINT NOT NULL,
  "last_assigned" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fiscal_sequences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fiscal_documents" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "environment" "HaciendaEnvironment" NOT NULL,
  "type" "FiscalDocumentType" NOT NULL,
  "status" "FiscalDocumentStatus" NOT NULL DEFAULT 'READY_FOR_XML',
  "issuance_point_id" UUID NOT NULL,
  "branch_code" CHAR(3) NOT NULL,
  "terminal_code" CHAR(5) NOT NULL,
  "sequence_value" BIGINT NOT NULL,
  "consecutive" CHAR(20) NOT NULL,
  "clave" CHAR(50) NOT NULL,
  "security_code" CHAR(8) NOT NULL,
  "situation" CHAR(1) NOT NULL DEFAULT '1',
  "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuer_snapshot" JSONB NOT NULL,
  "receiver_snapshot" JSONB,
  "currency" CHAR(3) NOT NULL,
  "exchange_rate" DECIMAL(18,5),
  "sale_condition" CHAR(2) NOT NULL,
  "payment_method" CHAR(2) NOT NULL,
  "lines" JSONB NOT NULL,
  "totals" JSONB NOT NULL,
  "idempotency_key" VARCHAR(255),
  "request_hash" CHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fiscal_idempotency_keys" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "key" VARCHAR(255) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "status" "FiscalIdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "fiscal_document_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fiscal_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiscal_issuance_points_company_id_environment_branch_code_terminal_key" ON "fiscal_issuance_points"("company_id", "environment", "branch_code", "terminal_code");
CREATE INDEX "fiscal_issuance_points_tenant_company_environment_active_idx" ON "fiscal_issuance_points"("tenant_id", "company_id", "environment", "active");
CREATE UNIQUE INDEX "fiscal_sequences_scope_key" ON "fiscal_sequences"("tenant_id", "company_id", "environment", "branch_code", "terminal_code", "document_type");
CREATE INDEX "fiscal_sequences_tenant_company_environment_idx" ON "fiscal_sequences"("tenant_id", "company_id", "environment");
CREATE UNIQUE INDEX "fiscal_documents_consecutive_key" ON "fiscal_documents"("consecutive");
CREATE UNIQUE INDEX "fiscal_documents_clave_key" ON "fiscal_documents"("clave");
CREATE INDEX "fiscal_documents_tenant_company_created_at_idx" ON "fiscal_documents"("tenant_id", "company_id", "created_at" DESC);
CREATE INDEX "fiscal_documents_tenant_company_status_idx" ON "fiscal_documents"("tenant_id", "company_id", "status");
CREATE UNIQUE INDEX "fiscal_documents_tenant_company_idempotency_key" ON "fiscal_documents"("tenant_id", "company_id", "idempotency_key");
CREATE UNIQUE INDEX "fiscal_idempotency_keys_tenant_company_key" ON "fiscal_idempotency_keys"("tenant_id", "company_id", "key");

ALTER TABLE "fiscal_issuance_points" ADD CONSTRAINT "fiscal_issuance_points_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_issuance_points" ADD CONSTRAINT "fiscal_issuance_points_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_sequences" ADD CONSTRAINT "fiscal_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_sequences" ADD CONSTRAINT "fiscal_sequences_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_issuance_point_id_fkey" FOREIGN KEY ("issuance_point_id") REFERENCES "fiscal_issuance_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_idempotency_keys" ADD CONSTRAINT "fiscal_idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_idempotency_keys" ADD CONSTRAINT "fiscal_idempotency_keys_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_idempotency_keys" ADD CONSTRAINT "fiscal_idempotency_keys_fiscal_document_id_fkey" FOREIGN KEY ("fiscal_document_id") REFERENCES "fiscal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
