param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('billing', 'affiliations')]
  [string] $Service,
  [Parameter(Mandatory = $true)]
  [ValidateSet('validate', 'validate-rollback', 'install', 'rollback')]
  [string] $Action
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$backupRoot = 'D:\SPEC10-Install-20261106-2247'
$billingRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$affiliationsRoot = 'C:\Users\kmena\.codex\worktrees\spec10-fiscal-ux\Aflilientions'
$inventory = Get-Content -LiteralPath (Join-Path $backupRoot 'inventory.json') -Raw | ConvertFrom-Json

function Container([string] $Name) {
  $result = & docker inspect $Name 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'SPEC10_CONTAINER_INSPECT_FAILED' }
  return @($result | ConvertFrom-Json)[0]
}
function Variable($Container, [string] $Name) {
  $entry = @($Container.Config.Env | Where-Object { ($_ -split '=', 2)[0] -eq $Name })
  if ($entry.Count -ne 1) { throw "SPEC10_REQUIRED_ENV_MISSING:$Name" }
  return ($entry[0] -split '=', 2)[1]
}
function Set-ProcessVariable([string] $Name, [string] $Value) {
  if (-not $Value) { throw "SPEC10_EMPTY_ENV:$Name" }
  [System.Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}
function Check-Backups {
  $dumps = @(Get-ChildItem -LiteralPath $backupRoot -File -Filter '*.dump')
  if (@($dumps | Where-Object Name -Like 'billing-*').Count -ne 1 -or
      @($dumps | Where-Object Name -Like 'afiliaciones-*').Count -ne 1) {
    throw 'SPEC10_DATABASE_BACKUPS_MISSING'
  }
  $stores = Get-Content -LiteralPath (Join-Path $backupRoot 'stores\manifest.json') -Raw | ConvertFrom-Json
  $expected = @('spec09_billing_fiscal_storage', 'spec09_billing_secret_store', 'spec09_billing_master_key')
  if ($stores.volumes.Count -ne 3) { throw 'SPEC10_STORE_BACKUP_COUNT' }
  foreach ($name in $expected) {
    $entry = @($stores.volumes | Where-Object volume -eq $name)
    if ($entry.Count -ne 1 -or -not $entry[0].restoreVerified -or
        -not (Test-Path -LiteralPath (Join-Path $backupRoot "stores\$name.tar"))) {
      throw 'SPEC10_STORE_BACKUP_NOT_VERIFIED'
    }
  }
}

Check-Backups
$installedBilling = Container 'spec09-billing-billing-spec09-sandbox-1'
$installedApi = Container 'aflilientions-api-1'
$installedWeb = Container 'aflilientions-web-1'
$billingDb = Container 'spec09-billing-postgres-1'
$affiliationsDb = Container 'aflilientions-postgres-1'
$billingRecord = @($inventory.containers | Where-Object name -eq 'spec09-billing-billing-spec09-sandbox-1')[0]
$apiRecord = @($inventory.containers | Where-Object name -eq 'aflilientions-api-1')[0]
$webRecord = @($inventory.containers | Where-Object name -eq 'aflilientions-web-1')[0]
if ($Action -eq 'install') {
  if ($Service -eq 'billing' -and $installedBilling.Image -ne $billingRecord.imageId) {
    throw 'SPEC10_BILLING_BASELINE_CHANGED'
  }
  if ($Service -eq 'affiliations' -and
      ($installedApi.Image -ne $apiRecord.imageId -or $installedWeb.Image -ne $webRecord.imageId)) {
    throw 'SPEC10_AFFILIATIONS_BASELINE_CHANGED'
  }
}

$base = if ($Service -eq 'billing') { $billingRecord } else { $apiRecord }
$paths = @($base.composeFiles -split ',')
foreach ($path in $paths) {
  if (-not (Test-Path -LiteralPath $path)) { throw 'SPEC10_COMPOSE_FILE_MISSING' }
}
$rollbackMode = $Action -in @('validate-rollback', 'rollback')
$suffix = if ($rollbackMode) { 'rollback' } else { 'read' }
$overlay = if ($Service -eq 'billing') {
  Join-Path $billingRoot "scripts\spec10\compose.billing.documents-$suffix.yaml"
} else {
  Join-Path $affiliationsRoot "scripts\spec10-compose.documents-$suffix.yaml"
}
if (-not (Test-Path -LiteralPath $overlay)) { throw 'SPEC10_OVERLAY_MISSING' }

Set-ProcessVariable 'BILLING_SANDBOX_DB_PASSWORD' (Variable $billingDb 'POSTGRES_PASSWORD')
Set-ProcessVariable 'POSTGRES_PASSWORD' (Variable $affiliationsDb 'POSTGRES_PASSWORD')
Set-ProcessVariable 'SPEC09_STAG_INVOICING' 'false'
Set-ProcessVariable 'SPEC09_BILLING_BOOTSTRAP' 'D:\SPEC10-Email-20261106\billing-bootstrap.post-email.cjs'
Set-ProcessVariable 'SPEC10_EMAIL_BOOTSTRAP_PATH' 'D:\SPEC10-Email-20261106\billing-bootstrap.post-email.cjs'
Set-ProcessVariable 'SPEC10_DOCUMENTS_BOOTSTRAP_PATH' (Join-Path $billingRoot 'scripts\spec10\billing-bootstrap.documents.cjs')
$ca = @($installedApi.Mounts | Where-Object Destination -eq '/run/spec09-ca/ca.crt')[0].Source
$target = @($installedApi.Mounts | Where-Object Destination -eq '/run/spec09-enrollment-target/provision.json')[0].Source
$keyDir = @($installedApi.Mounts | Where-Object Destination -eq '/run/spec09-m2m')[0].Source
Set-ProcessVariable 'SPEC09_BILLING_TLS_DIR' (Split-Path -Parent $ca)
Set-ProcessVariable 'SPEC09_BILLING_CA_FILE' $ca
Set-ProcessVariable 'SPEC09_BILLING_TARGET_FILE' $target
Set-ProcessVariable 'SPEC09_M2M_KEY_DIR' $keyDir
Set-ProcessVariable 'SPEC09_MEMBERSHIP_COMPANY_ID' (Variable $installedApi 'BILLING_MEMBERSHIP_SYNTHETIC_COMPANY_ID')
Set-ProcessVariable 'SPEC09_MEMBERSHIP_CLIENT_ID' (Variable $installedApi 'BILLING_MEMBERSHIP_SYNTHETIC_CLIENT_ID')
Set-ProcessVariable 'AFILIACIONES_API_IMAGE' $apiRecord.imageTag
Set-ProcessVariable 'AFILIACIONES_WEB_IMAGE' $webRecord.imageTag
Set-ProcessVariable 'WEB_PORT' '3081'

$project = if ($Service -eq 'billing') { 'spec09-billing' } else { 'aflilientions' }
$compose = @('compose', '-p', $project)
foreach ($path in $paths) { $compose += @('-f', $path) }
$compose += @('-f', $overlay)
$resolved = & docker @compose 'config' '--format' 'json' 2>$null
if ($LASTEXITCODE -ne 0) { throw 'SPEC10_COMPOSE_CONFIG_FAILED' }
$config = ($resolved -join "`n") | ConvertFrom-Json
$candidate = if ($Service -eq 'billing') { $config.services.'billing-spec09-sandbox' } else { $config.services.api }
if ($Service -eq 'billing') {
  $expectedImage = if ($rollbackMode) { $billingRecord.imageTag } else { 'billing-spec10:documents-install-20261106' }
  if ($candidate.image -ne $expectedImage -or $candidate.environment.USE_REAL_HACIENDA -ne 'false' -or
      $candidate.environment.FISCAL_WORKER_ENABLE_IN_TESTS -ne 'false' -or
      $candidate.environment.EMAIL_USE_REAL -ne 'false' -or
      $candidate.environment.SPEC10_DOCUMENTS_READ -ne $(if ($rollbackMode) { 'false' } else { 'true' })) {
    throw 'SPEC10_BILLING_COMPOSE_SAFETY_FAILED'
  }
} else {
  $expectedApi = if ($rollbackMode) { $apiRecord.imageTag } else { 'afiliaciones-spec10-api:documents-install-20261106' }
  $expectedWeb = if ($rollbackMode) { $webRecord.imageTag } else { 'afiliaciones-spec10-web:documents-install-20261106' }
  if ($candidate.image -ne $expectedApi -or $config.services.web.image -ne $expectedWeb -or
      $candidate.environment.BILLING_ENABLED -ne 'false' -or
      $candidate.environment.BILLING_MEMBERSHIP_STAG_ENABLED -ne 'false' -or
      $candidate.environment.BILLING_DOCUMENTS_READ_ENABLED -ne $(if ($rollbackMode) { 'false' } else { 'true' })) {
    throw 'SPEC10_AFFILIATIONS_COMPOSE_SAFETY_FAILED'
  }
}
Write-Output "SPEC10_COMPOSE_VALIDATED $Service $Action"
if ($Action -in @('validate', 'validate-rollback')) { exit 0 }
$services = if ($Service -eq 'billing') { @('billing-spec09-sandbox') } else { @('api', 'web') }
foreach ($name in $services) {
  & docker @compose 'up' '-d' '--no-deps' '--no-build' $name | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "SPEC10_COMPOSE_UP_FAILED:$name" }
}
Write-Output "SPEC10_COMPOSE_APPLIED $Service $Action"
