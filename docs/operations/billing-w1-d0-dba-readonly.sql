-- W1-D0 DBA evidence template. Run only with separately authorized read-only
-- access to the intended target database. No DDL, DML or migrate resolve.
BEGIN TRANSACTION READ ONLY;

SELECT migration_name, checksum, started_at, finished_at, rolled_back_at
FROM public._prisma_migrations
ORDER BY started_at, migration_name;

SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'api_keys', 'audit_logs', 'companies', 'company_economic_activities',
    'fiscal_branches', 'fiscal_documents', 'fiscal_idempotency_keys',
    'fiscal_integration_associations', 'fiscal_issuance_points',
    'fiscal_sequences', 'fiscal_terminals', 'fiscal_xml_artifacts',
    'hacienda_connections', 'refresh_tokens', 'tenants', 'users'
  )
ORDER BY table_name, ordinal_position;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'api_keys', 'audit_logs', 'companies', 'company_economic_activities',
    'fiscal_branches', 'fiscal_documents', 'fiscal_idempotency_keys',
    'fiscal_integration_associations', 'fiscal_issuance_points',
    'fiscal_sequences', 'fiscal_terminals', 'fiscal_xml_artifacts',
    'hacienda_connections', 'refresh_tokens', 'tenants', 'users'
  )
ORDER BY tablename, indexname;

SELECT rel.relname AS table_name,
       constraint_record.conname AS constraint_name,
       constraint_record.contype AS constraint_type,
       pg_get_constraintdef(constraint_record.oid) AS definition
FROM pg_constraint AS constraint_record
JOIN pg_class AS rel ON rel.oid = constraint_record.conrelid
JOIN pg_namespace AS namespace_record ON namespace_record.oid = rel.relnamespace
WHERE namespace_record.nspname = 'public'
  AND rel.relname IN (
    'api_keys', 'audit_logs', 'companies', 'company_economic_activities',
    'fiscal_branches', 'fiscal_documents', 'fiscal_idempotency_keys',
    'fiscal_integration_associations', 'fiscal_issuance_points',
    'fiscal_sequences', 'fiscal_terminals', 'fiscal_xml_artifacts',
    'hacienda_connections', 'refresh_tokens', 'tenants', 'users'
  )
ORDER BY rel.relname, constraint_record.conname;

COMMIT;
