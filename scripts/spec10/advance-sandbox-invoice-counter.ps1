param(
  [Parameter(Mandatory = $true)]
  [string] $BackupDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function DockerText([string[]] $Arguments) {
  $result = & docker @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'SPEC10_COUNTER_PREFLIGHT_FAILED' }
  return ($result -join "`n").Trim()
}

$root = [IO.Path]::GetFullPath($BackupDirectory)
if (-not $root.StartsWith('D:\SPEC10-', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'SPEC10_COUNTER_BACKUP_PATH_INVALID'
}
$manifest = Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.format -ne 'spec10-stopped-volume-backup-v1') { throw 'SPEC10_COUNTER_BACKUP_FORMAT_INVALID' }
foreach ($volume in @('spec09_billing_pgdata','aflilientions_pgdata','spec09_billing_fiscal_storage','spec09_billing_secret_store')) {
  $entry = @($manifest.volumes | Where-Object volume -eq $volume)
  if ($entry.Count -ne 1 -or -not $entry[0].restoreVerified -or $entry[0].archive -ne "$volume.tar") {
    throw 'SPEC10_COUNTER_BACKUP_INCOMPLETE'
  }
  $path = Join-Path $root $entry[0].archive
  if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry[0].archiveSha256) {
    throw 'SPEC10_COUNTER_BACKUP_HASH_MISMATCH'
  }
}
foreach ($name in @('billing-api','billing-worker','spec09-billing-billing-spec09-sandbox-1')) {
  if ((DockerText @('inspect','--format','{{.State.Running}}',$name)) -ne 'false') {
    throw 'SPEC10_COUNTER_WRITER_ACTIVE'
  }
}
if ((DockerText @('inspect','--format','{{.State.Health.Status}}','spec09-billing-postgres-1')) -ne 'healthy') {
  throw 'SPEC10_COUNTER_DATABASE_NOT_HEALTHY'
}

$historic = DockerText @('exec','billing-postgres','sh','-c',
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 -c "SELECT last_assigned || ''|'' || next_value FROM fiscal_sequences WHERE environment=''SANDBOX'' AND branch_code=''001'' AND terminal_code=''00001'' AND document_type=''INVOICE''"')
if ($historic -ne '7|8') { throw 'SPEC10_HISTORICAL_COUNTER_CHANGED' }

$sql = @'
BEGIN ISOLATION LEVEL SERIALIZABLE;
DO $block$
DECLARE seq record;
BEGIN
  SELECT * INTO seq FROM fiscal_sequences
    WHERE environment='SANDBOX' AND branch_code='001' AND terminal_code='00001'
      AND document_type='INVOICE' FOR UPDATE;
  IF NOT FOUND OR seq.last_assigned <> 1 OR seq.next_value <> 2 THEN
    RAISE EXCEPTION 'SPEC10_SEQUENCE_STATE_CHANGED';
  END IF;
  IF (SELECT count(*) FROM fiscal_sequences
      WHERE environment='SANDBOX' AND branch_code='001' AND terminal_code='00001'
        AND document_type='INVOICE') <> 1 THEN
    RAISE EXCEPTION 'SPEC10_SEQUENCE_NOT_UNIQUE';
  END IF;
  IF EXISTS (SELECT 1 FROM fiscal_documents
      WHERE environment='SANDBOX' AND branch_code='001' AND terminal_code='00001'
        AND type='INVOICE' AND sequence_value > 7) THEN
    RAISE EXCEPTION 'SPEC10_HIGHER_DOCUMENT_EXISTS';
  END IF;
  IF EXISTS (SELECT 1 FROM fiscal_idempotency_keys_v2 WHERE state <> 'COMMITTED') THEN
    RAISE EXCEPTION 'SPEC10_PENDING_RESERVATION_EXISTS';
  END IF;
  UPDATE fiscal_sequences SET last_assigned=7, next_value=8, updated_at=now() WHERE id=seq.id;
  INSERT INTO audit_logs
    (id,tenant_id,company_id,actor,action,resource,event_class,metadata,created_at)
  VALUES
    (gen_random_uuid(),seq.tenant_id,seq.company_id,'spec10-local-operator',
     'spec10.sandbox.sequence.cutover','fiscal_sequences','FISCAL_AUDIT',
     jsonb_build_object('environment','SANDBOX','branch','001','terminal','00001',
       'documentType','INVOICE','previousLastAssigned',1,'previousNextValue',2,
       'newLastAssigned',7,'newNextValue',8,
       'reason','Historical Billing consumed 1-7; SPEC-09 consumed 1; only these two issuers confirmed by operator'),
     now());
END
$block$;
COMMIT;
SELECT last_assigned || '|' || next_value FROM fiscal_sequences
  WHERE environment='SANDBOX' AND branch_code='001' AND terminal_code='00001'
    AND document_type='INVOICE';
'@
$result = $sql | & docker exec -i spec09-billing-postgres-1 sh -c 'psql -X -qAt -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' 2>$null
if ($LASTEXITCODE -ne 0 -or ($result -join "`n").Trim() -ne '7|8') {
  throw 'SPEC10_COUNTER_CUTOVER_FAILED_OR_UNVERIFIED'
}
Write-Output 'SPEC10_SANDBOX_INVOICE_COUNTER_7_TO_8_AUDITED'
