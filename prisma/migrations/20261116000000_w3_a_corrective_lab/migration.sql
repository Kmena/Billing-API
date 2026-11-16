-- W3-A disposable laboratory only. Note type and source columns already come
-- from 20261111090000/20261111100000 in the combined migration history.
ALTER TABLE fiscal_idempotency_keys_v2
  DROP CONSTRAINT fiscal_idempotency_keys_v2_operation_check;
ALTER TABLE fiscal_idempotency_keys_v2
  ADD CONSTRAINT fiscal_idempotency_keys_v2_operation_check
    CHECK (operation IN ('CREATE_INVOICE', 'CREATE_CREDIT_NOTE', 'CREATE_DEBIT_NOTE'));
