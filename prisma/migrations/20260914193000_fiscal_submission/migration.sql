-- F3 Hacienda asynchronous submission persistence
-- Forward-only migration. Existing READY_TO_SUBMIT documents are not backfilled; submissions are created lazily.

ALTER TYPE "FiscalDocumentStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';
ALTER TYPE "FiscalDocumentStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

CREATE TYPE "FiscalSubmissionStatus" AS ENUM (
  'REQUESTED',
  'QUEUED',
  'SUBMITTING',
  'POST_OUTCOME_UNKNOWN',
  'ACKNOWLEDGED',
  'PROCESSING',
  'ACCEPTED',
  'REJECTED',
  'TECHNICAL_RETRY_PENDING',
  'MANUAL_REVIEW_REQUIRED'
);

CREATE TABLE "fiscal_submissions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "fiscal_document_id" UUID NOT NULL,
  "environment" "HaciendaEnvironment" NOT NULL,
  "document_type" "FiscalDocumentType" NOT NULL,
  "clave" CHAR(50) NOT NULL,
  "signed_xml_sha256" CHAR(64) NOT NULL,
  "signed_xml_storage_key" VARCHAR(700) NOT NULL,
  "status" "FiscalSubmissionStatus" NOT NULL DEFAULT 'REQUESTED',
  "technical_status" VARCHAR(80),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "reconciliation_attempt_count" INTEGER NOT NULL DEFAULT 0,
  "first_submitted_at" TIMESTAMP(3),
  "last_attempt_at" TIMESTAMP(3),
  "next_attempt_at" TIMESTAMP(3),
  "accepted_at" TIMESTAMP(3),
  "rejected_at" TIMESTAMP(3),
  "provider_location" VARCHAR(700),
  "provider_reference" VARCHAR(255),
  "last_http_status" INTEGER,
  "last_normalized_error_code" VARCHAR(120),
  "last_sanitized_error_message" VARCHAR(500),
  "last_provider_status" VARCHAR(40),
  "last_provider_metadata" JSONB,
  "response_storage_key" VARCHAR(700),
  "response_sha256" CHAR(64),
  "response_content_type" VARCHAR(120),
  "response_received_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fiscal_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiscal_submissions_fiscal_document_id_key" ON "fiscal_submissions"("fiscal_document_id");
CREATE UNIQUE INDEX "fiscal_submissions_clave_key" ON "fiscal_submissions"("clave");
CREATE INDEX "fiscal_submission_scope_status_idx" ON "fiscal_submissions"("tenant_id", "company_id", "status");
CREATE INDEX "fiscal_submission_due_work_idx" ON "fiscal_submissions"("status", "next_attempt_at");
CREATE INDEX "fiscal_submission_environment_status_idx" ON "fiscal_submissions"("environment", "status");

ALTER TABLE "fiscal_submissions" ADD CONSTRAINT "fiscal_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_submissions" ADD CONSTRAINT "fiscal_submissions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_submissions" ADD CONSTRAINT "fiscal_submissions_fiscal_document_id_fkey" FOREIGN KEY ("fiscal_document_id") REFERENCES "fiscal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
