-- W3-A disposable laboratory only. DBA review required before target integration.
ALTER TYPE "FiscalDocumentType" ADD VALUE 'CREDIT_NOTE';
ALTER TYPE "FiscalDocumentType" ADD VALUE 'DEBIT_NOTE';

ALTER TABLE fiscal_documents
  ADD COLUMN source_fiscal_document_id uuid,
  ADD COLUMN reference_snapshot jsonb;

ALTER TABLE fiscal_documents
  ADD CONSTRAINT fiscal_documents_source_document_fkey
    FOREIGN KEY (source_fiscal_document_id) REFERENCES fiscal_documents(id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX fiscal_documents_corrections_source_idx
  ON fiscal_documents(tenant_id, company_id, source_fiscal_document_id);

ALTER TABLE fiscal_idempotency_keys_v2
  DROP CONSTRAINT fiscal_idempotency_keys_v2_operation_check;
ALTER TABLE fiscal_idempotency_keys_v2
  ADD CONSTRAINT fiscal_idempotency_keys_v2_operation_check
    CHECK (operation IN ('CREATE_INVOICE', 'CREATE_CREDIT_NOTE', 'CREATE_DEBIT_NOTE'));
