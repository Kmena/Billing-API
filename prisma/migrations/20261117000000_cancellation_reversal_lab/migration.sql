-- Additive laboratory orchestration. No fiscal document, v1 route or existing ledger is altered.
CREATE TABLE "fiscal_cancellation_workflows" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "environment" "HaciendaEnvironment" NOT NULL,
    "consumer_id" UUID NOT NULL,
    "association_id" UUID NOT NULL,
    "original_document_id" UUID NOT NULL,
    "cancellation_note_id" UUID,
    "replacement_document_id" UUID,
    "replacement_cancellation_note_id" UUID,
    "reversal_note_id" UUID,
    "state" VARCHAR(64) NOT NULL,
    "reason" VARCHAR(180) NOT NULL,
    "cancellation_key" VARCHAR(128) NOT NULL,
    "cancellation_hash" CHAR(64) NOT NULL,
    "draft_key" VARCHAR(128),
    "draft_hash" CHAR(64),
    "replacement_draft" JSONB,
    "replacement_observation" VARCHAR(180),
    "confirm_key" VARCHAR(128),
    "confirm_hash" CHAR(64),
    "reversal_key" VARCHAR(128),
    "reversal_hash" CHAR(64),
    "reversal_plan" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fiscal_cancellation_workflows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fcw_sandbox_only" CHECK ("environment" = 'SANDBOX'::"HaciendaEnvironment"),
    CONSTRAINT "fcw_reason_required" CHECK (length(trim("reason")) BETWEEN 3 AND 180),
    CONSTRAINT "fcw_state_known" CHECK ("state" IN (
      'CANCEL_REQUESTED', 'CREDIT_NOTE_PENDING', 'CREDIT_NOTE_ACCEPTED', 'CANCELLED',
      'REPLACEMENT_DRAFT', 'REPLACEMENT_ISSUED', 'REVERSAL_REQUESTED',
      'REPLACEMENT_CANCELLATION_PENDING', 'REPLACEMENT_CANCELLATION_ACCEPTED',
      'DEBIT_NOTE_PENDING', 'DEBIT_NOTE_ACCEPTED', 'REVERSAL_COMPLETED',
      'RECOVERY_REQUIRED', 'BLOCKED_FISCAL_POLICY'
    ))
);

CREATE UNIQUE INDEX "fcw_original_doc_key" ON "fiscal_cancellation_workflows"("original_document_id");
CREATE UNIQUE INDEX "fcw_cancel_note_key" ON "fiscal_cancellation_workflows"("cancellation_note_id");
CREATE UNIQUE INDEX "fcw_replacement_doc_key" ON "fiscal_cancellation_workflows"("replacement_document_id");
CREATE UNIQUE INDEX "fcw_replacement_nc_key" ON "fiscal_cancellation_workflows"("replacement_cancellation_note_id");
CREATE UNIQUE INDEX "fcw_reversal_nd_key" ON "fiscal_cancellation_workflows"("reversal_note_id");
CREATE INDEX "fcw_scope_state_idx" ON "fiscal_cancellation_workflows"("tenant_id", "company_id", "association_id", "state");

ALTER TABLE "fiscal_cancellation_workflows" ADD CONSTRAINT "fcw_original_doc_fkey"
  FOREIGN KEY ("original_document_id") REFERENCES "fiscal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_cancellation_workflows" ADD CONSTRAINT "fcw_cancel_note_fkey"
  FOREIGN KEY ("cancellation_note_id") REFERENCES "fiscal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_cancellation_workflows" ADD CONSTRAINT "fcw_replacement_doc_fkey"
  FOREIGN KEY ("replacement_document_id") REFERENCES "fiscal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_cancellation_workflows" ADD CONSTRAINT "fcw_replacement_nc_fkey"
  FOREIGN KEY ("replacement_cancellation_note_id") REFERENCES "fiscal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_cancellation_workflows" ADD CONSTRAINT "fcw_reversal_nd_fkey"
  FOREIGN KEY ("reversal_note_id") REFERENCES "fiscal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
