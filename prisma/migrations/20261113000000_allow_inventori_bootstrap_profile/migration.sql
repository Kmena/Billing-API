ALTER TABLE api_keys
  DROP CONSTRAINT api_keys_integration_profile_check;

ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_integration_profile_check
  CHECK (
    integration_profile IS NULL
    OR integration_profile IN ('inventori-fiscal-v1', 'inventori-bootstrap-v1')
  );
