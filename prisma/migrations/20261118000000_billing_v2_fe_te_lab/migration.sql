-- Test-only M2M v2 operation namespace for electronic tickets. Existing FE and
-- corrective operations remain valid. No fiscal document tables are changed.
ALTER TABLE fiscal_idempotency_keys_v2
  DROP CONSTRAINT fiscal_idempotency_keys_v2_operation_check;

ALTER TABLE fiscal_idempotency_keys_v2
  ADD CONSTRAINT fiscal_idempotency_keys_v2_operation_check
    CHECK (operation IN ('CREATE_INVOICE', 'CREATE_TICKET', 'CREATE_CREDIT_NOTE', 'CREATE_DEBIT_NOTE'));
