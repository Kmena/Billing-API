param(
  [string] $CaseDirectory = 'D:\SPEC10-OneInvoice-20261106',
  [switch] $PreflightOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$base = 'http://127.0.0.1:3081'
$companyId = '136b2e9a-7bc4-4a68-8598-33a8b6daef9a'
$approverEmail = 'spec09.aprobador.lab@example.test'
$phase = 'START'

function Fail([string] $Code) { throw $Code }
function Sql([string] $Container, [string] $User, [string] $Database, [string] $Query) {
  $rows = @(& docker exec $Container psql -U $User -d $Database -At -v ON_ERROR_STOP=1 -c $Query 2>$null)
  if ($LASTEXITCODE -ne 0) { Fail 'SPEC10_DB_PREFLIGHT_FAILED' }
  return ($rows -join "`n").Trim()
}
function Hidden([string] $Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [IntPtr]::Zero
  try {
    if ($secure.Length -lt 1) { Fail 'SPEC10_APPROVER_PASSWORD_EMPTY' }
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $secure.Dispose()
  }
}
function Call([string] $Method, [string] $Path, $Body, $Identity) {
  $headers = @{ Origin = $base }
  if ($Method -ne 'GET') { $headers['X-CSRF-Token'] = $Identity.csrf }
  $options = @{ Uri = "$base$Path"; Method = $Method; Headers = $headers; WebSession = $Identity.session; SkipHttpErrorCheck = $true; TimeoutSec = 25 }
  if ($null -ne $Body) { $options.ContentType = 'application/json'; $options.Body = ConvertTo-Json $Body -Depth 12 -Compress }
  $response = Invoke-WebRequest @options
  $data = if ($response.Content -and [string]$response.Headers['Content-Type'] -match 'json') { $response.Content | ConvertFrom-Json } else { $null }
  return @{ status = [int]$response.StatusCode; data = $data }
}

try {
  $phase = 'CASE'
  $recordPath = Join-Path $CaseDirectory 'case.json'
  if (-not (Test-Path -LiteralPath $recordPath)) { Fail 'SPEC10_CASE_MISSING' }
  $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
  if ($record.companyId -ne $companyId -or $record.paymentId -ne '494c6cad-641d-43ae-9f9a-debc57867339' -or
      $record.obligationId -ne 'bf0215e1-a4eb-4a2d-a99e-cd4433acdeb8') { Fail 'SPEC10_CASE_MISMATCH' }
  $api = (docker inspect aflilientions-api-1 | ConvertFrom-Json)[0]
  $billing = (docker inspect spec09-billing-billing-spec09-sandbox-1 | ConvertFrom-Json)[0]
  $historicApi = (docker inspect billing-api | ConvertFrom-Json)[0]
  $historicWorker = (docker inspect billing-worker | ConvertFrom-Json)[0]
  if ($api.State.Health.Status -ne 'healthy' -or $billing.State.Health.Status -ne 'healthy' -or
      $historicApi.State.Running -or $historicWorker.State.Running) { Fail 'SPEC10_SERVICE_PREFLIGHT_FAILED' }
  $phase = 'FLAGS'
  $apiFlags = @{}; foreach ($entry in $api.Config.Env) { $parts = $entry.Split('=', 2); $apiFlags[$parts[0]] = $parts[1] }
  $billingFlags = @{}; foreach ($entry in $billing.Config.Env) { $parts = $entry.Split('=', 2); $billingFlags[$parts[0]] = $parts[1] }
  if ($apiFlags['BILLING_MEMBERSHIP_STAG_ENABLED'] -ne 'true' -or $apiFlags['BILLING_ENABLED'] -ne 'false' -or
      $apiFlags['BILLING_MEMBERSHIP_SYNTHETIC_CLIENT_ID'] -ne $record.clientId -or
      $billingFlags['USE_REAL_HACIENDA'] -ne 'true' -or $billingFlags['BILLING_SPEC09_STAG_INVOICING'] -ne 'true' -or
      $billingFlags['SPEC10_SINGLE_STAG_POST'] -ne 'true' -or $billingFlags['EMAIL_USE_REAL'] -ne 'false' -or
      $billingFlags['HACIENDA_RECEPCION_SANDBOX_BASE_URL'] -ne 'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1' -or
      $billingFlags['HACIENDA_RECEPCION_PRODUCTION_BASE_URL'] -ne 'https://127.0.0.1:9/') { Fail 'SPEC10_FLAGS_PREFLIGHT_FAILED' }
  $billingSql = "SELECT last_assigned||'/'||next_value FROM fiscal_sequences WHERE environment='SANDBOX' AND branch_code='001' AND terminal_code='00001' AND document_type='INVOICE'; SELECT count(*) FROM fiscal_documents; SELECT count(*) FROM fiscal_submissions WHERE status NOT IN ('ACCEPTED','REJECTED','MANUAL_REVIEW_REQUIRED','SUPERSEDED');"
  $billingRows = @((Sql 'spec09-billing-postgres-1' 'billing_sandbox' 'billing_sandbox' $billingSql) -split "`n")
  if ($billingRows.Count -ne 3 -or $billingRows[0] -ne '7/8' -or $billingRows[1] -ne '1' -or $billingRows[2] -ne '0') { Fail 'SPEC10_FISCAL_PREFLIGHT_FAILED' }
  $phase = 'PAYMENT'
  $paymentSql = "SELECT status||'|'||amount FROM `"Payment`" WHERE id='$($record.paymentId)'; SELECT count(*) FROM `"FiscalOutbox`" WHERE state IN ('PENDING','RETRY','SENDING','AWAITING_HACIENDA');"
  $paymentRows = @((Sql 'aflilientions-postgres-1' 'afiliaciones' 'afiliaciones' $paymentSql) -split "`n")
  if ($paymentRows.Count -ne 2 -or $paymentRows[0] -ne 'PENDING_APPROVAL|113.00' -or $paymentRows[1] -ne '0') { Fail 'SPEC10_PAYMENT_PREFLIGHT_FAILED' }
  if ($PreflightOnly) { Write-Output 'SPEC10_APPROVAL_PREFLIGHT_PASS'; return }

  $phase = 'LOGIN'
  $password = Hidden 'Contraseña del aprobador SPEC-09 (oculta)'
  $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
  $loginBody = @{ companyId = $companyId; email = $approverEmail; password = $password } | ConvertTo-Json -Compress
  try {
    $loginReply = Invoke-WebRequest -Uri "$base/api/auth/login" -Method POST -ContentType 'application/json' -Body $loginBody -Headers @{ Origin = $base } -WebSession $session -SkipHttpErrorCheck -TimeoutSec 20
    if ([int]$loginReply.StatusCode -ne 200) { Fail 'SPEC10_APPROVER_LOGIN_FAILED' }
    $login = $loginReply.Content | ConvertFrom-Json
  } finally { $password = $null; $loginBody = $null }
  $required = @('payments.approve', 'payments.audit.view', 'payments.view')
  if ($login.user.companyId -ne $companyId -or -not $login.csrfToken -or
      $login.user.permissions.Count -ne 3 -or (Compare-Object $required $login.user.permissions)) { Fail 'SPEC10_APPROVER_SCOPE_FAILED' }
  $identity = @{ session = $session; csrf = [string]$login.csrfToken }
  $phase = 'READ_PAYMENT'
  $pending = Call 'GET' "/api/payments/$($record.paymentId)" $null $identity
  if ($pending.status -ne 200 -or $pending.data.status -ne 'PENDING_APPROVAL' -or
      $pending.data.clientId -ne $record.clientId -or $pending.data.accountId -ne $record.accountId) { Fail 'SPEC10_PAYMENT_VIEW_FAILED' }
  $allocation = @($pending.data.allocations | Where-Object { $_.obligationId -eq $record.obligationId -and $_.amount -eq '113.00' })
  if ($allocation.Count -ne 1) { Fail 'SPEC10_PAYMENT_ALLOCATION_MISMATCH' }
  $receipt = Call 'GET' "/api/payments/$($record.paymentId)/evidence" $null $identity
  if ($receipt.status -ne 200) { Fail 'SPEC10_EVIDENCE_VIEW_FAILED' }
  $phase = 'APPROVAL'
  $approval = Call 'POST' "/api/payments/$($record.paymentId)/approve" @{
    fiscalLines = @(@{ allocationId = $allocation[0].id; base = '100.00'; tax = '13.00' })
  } $identity
  if ($approval.status -ne 200 -or $approval.data.status -ne 'APPROVED' -or
      $approval.data.approvedByUserId -ne $login.user.id -or $approval.data.fiscal.state -ne 'PENDING') {
    Fail 'SPEC10_APPROVAL_RESULT_UNCONFIRMED'
  }
  Write-Output "SPEC10_PAYMENT_APPROVED_FISCAL_PENDING payment=$($record.paymentId)"
} catch {
  $code = $_.Exception.Message
  if ($code -notmatch '^SPEC10_[A-Z_]+$') { $code = "SPEC10_APPROVAL_FAILED_$phase" }
  Write-Error $code
  exit 1
} finally { $password = $null }
