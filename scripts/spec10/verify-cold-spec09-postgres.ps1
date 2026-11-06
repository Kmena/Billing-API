param(
  [Parameter(Mandatory = $true)]
  [string] $BackupDirectory,
  [Parameter(Mandatory = $true)]
  [ValidateSet('Billing', 'Afiliaciones')]
  [string] $Database
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = [System.IO.Path]::GetFullPath($BackupDirectory)
$manifestPath = Join-Path $root 'manifest.json'
if (-not $root.StartsWith('D:\SPEC10-', [System.StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath $manifestPath)) { throw 'SPEC10_RESTORE_SOURCE_UNSAFE' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.format -ne 'spec10-stopped-volume-backup-v1') { throw 'SPEC10_RESTORE_MANIFEST_INVALID' }
$volume = if ($Database -eq 'Billing') { 'spec09_billing_pgdata' } else { 'aflilientions_pgdata' }
$role = if ($Database -eq 'Billing') { 'billing_sandbox' } else { 'afiliaciones' }
$databaseName = $role
$entry = @($manifest.volumes | Where-Object volume -eq $volume)
if ($entry.Count -ne 1 -or $entry[0].archive -ne "$volume.tar" -or -not $entry[0].restoreVerified) {
  throw 'SPEC10_RESTORE_ARCHIVE_NOT_VERIFIED'
}
$archive = Join-Path $root $entry[0].archive
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry[0].archiveSha256) {
  throw 'SPEC10_RESTORE_ARCHIVE_HASH_MISMATCH'
}
$container = 'spec10-cold-restore-' + [guid]::NewGuid().ToString('N').Substring(0, 10)
$started = $false
try {
  $command = "tar -xf /backup/$volume.tar -C /var/lib/postgresql/data && chown -R postgres:postgres /var/lib/postgresql/data && chmod 700 /var/lib/postgresql/data && exec docker-entrypoint.sh postgres"
  $null = & docker run --detach --rm --network none --name $container --label 'spec10-disposable-restore=true' `
    --tmpfs '/var/lib/postgresql/data:rw,nosuid,size=768m' `
    --mount "type=bind,source=$root,target=/backup,readonly" `
    --entrypoint sh postgres:16-alpine -c $command 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'SPEC10_RESTORE_CONTAINER_START_FAILED' }
  $started = $true
  $ready = $false
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    $null = & docker exec $container pg_isready -U $role -d $databaseName 2>$null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'SPEC10_RESTORED_POSTGRES_NOT_READY' }
  $sql = if ($Database -eq 'Billing') {
    'SELECT (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL),(SELECT count(*) FROM fiscal_documents),(SELECT count(*) FROM fiscal_sequences),(SELECT count(*) FROM fiscal_consumer_associations);'
  } else {
    'SELECT (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL),(SELECT count(*) FROM "Client"),(SELECT count(*) FROM "Payment"),(SELECT count(*) FROM "FiscalOutbox");'
  }
  $summary = & docker exec $container psql -U $role -d $databaseName -At -v ON_ERROR_STOP=1 -c $sql 2>$null
  if ($LASTEXITCODE -ne 0 -or $summary -notmatch '^\d+\|\d+\|\d+\|\d+$') {
    throw 'SPEC10_RESTORED_POSTGRES_QUERY_FAILED'
  }
  Write-Output ("SPEC10_COLD_POSTGRES_RESTORE_PASS database=$Database counts=$summary")
} finally {
  if ($started) {
    $label = & docker inspect --format '{{ index .Config.Labels "spec10-disposable-restore" }}' $container 2>$null
    if ($LASTEXITCODE -eq 0 -and $label.Trim() -eq 'true') {
      $null = & docker stop $container 2>$null
    }
  }
}
