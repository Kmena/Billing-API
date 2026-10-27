-- W2-B2 lab: represent a terminal XML validation failure after allocation.
-- This versioned migration is exercised only on disposable PostgreSQL in W2-B2.
ALTER TABLE fiscal_idempotency_keys_v2
  DROP CONSTRAINT fiscal_idempotency_keys_v2_state_check,
  DROP CONSTRAINT fiscal_idempotency_keys_v2_state_document_check;

ALTER TABLE fiscal_idempotency_keys_v2
  ADD CONSTRAINT fiscal_idempotency_keys_v2_state_check
    CHECK (state IN ('RESERVED', 'COMMITTED', 'RECOVERY_REQUIRED',
      'ABORTED_BEFORE_ALLOCATION', 'FAILED_TERMINAL')),
  ADD CONSTRAINT fiscal_idempotency_keys_v2_state_document_check
    CHECK ((state IN ('COMMITTED', 'FAILED_TERMINAL') AND fiscal_document_id IS NOT NULL)
      OR (state IN ('RESERVED', 'ABORTED_BEFORE_ALLOCATION') AND fiscal_document_id IS NULL)
      OR state = 'RECOVERY_REQUIRED');
