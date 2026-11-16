-- Additive technical storage. Applying this migration never enables note issuance.
ALTER TABLE "fiscal_documents"
  ADD COLUMN "source_fiscal_document_id" UUID,
  ADD COLUMN "reference_snapshot" JSONB;
ALTER TABLE "fiscal_documents"
  ADD CONSTRAINT "fiscal_documents_source_fkey"
  FOREIGN KEY ("source_fiscal_document_id") REFERENCES "fiscal_documents"("id") ON DELETE RESTRICT;
ALTER TABLE "fiscal_documents"
  ADD CONSTRAINT "fiscal_notes_lab_shape_check"
  CHECK ("type" NOT IN ('CREDIT_NOTE', 'DEBIT_NOTE') OR
    ("environment" = 'SANDBOX' AND "source_fiscal_document_id" IS NOT NULL AND "reference_snapshot" IS NOT NULL));
CREATE INDEX "fiscal_documents_source_scope_idx"
  ON "fiscal_documents"("tenant_id", "company_id", "source_fiscal_document_id");

CREATE TABLE "fiscal_note_audit" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "fiscal_document_id" UUID NOT NULL REFERENCES "fiscal_documents"("id") ON DELETE RESTRICT,
  "source_document_id" UUID NOT NULL,
  "api_key_id" UUID NOT NULL,
  "action" VARCHAR(60) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "fiscal_note_audit_tenant_id_company_id_source_document_id_idx"
  ON "fiscal_note_audit"("tenant_id", "company_id", "source_document_id");
