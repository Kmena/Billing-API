param(
  [string] $CaseDirectory = 'D:\SPEC10-OneInvoice-20261106'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$base = 'http://127.0.0.1:3081'
$companyId = '136b2e9a-7bc4-4a68-8598-33a8b6daef9a'
$clientId = 'f66d0aa0-d855-4fe1-99fe-7aaa3329ba3b'
$affiliationId = '06f9fdba-104c-4914-9a14-f42141c616fc'
$accountId = '1da020a8-38c5-456b-b6d3-4fb7a063664a'
$nextPeriodEnd = '2027-01-04'
$evidence = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'

function Fail([string] $Code) { throw $Code }
function Sql([string] $Query) {
  $rows = @(& docker exec aflilientions-postgres-1 psql -U afiliaciones -d afiliaciones -At -v ON_ERROR_STOP=1 -c $Query 2>$null)
  if ($LASTEXITCODE -ne 0) { Fail 'SPEC10_AFFILIATIONS_DB_READ_FAILED' }
  return ($rows -join "`n").Trim()
}
function Hidden([string] $Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [IntPtr]::Zero
  try {
    if ($secure.Length -lt 1) { Fail 'SPEC10_ADMIN_PASSWORD_EMPTY' }
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $secure.Dispose()
  }
}
function Login([string] $Email, [string] $Password) {
  $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
  $body = @{ companyId = $companyId; email = $Email; password = $Password } | ConvertTo-Json -Compress
  try {
    $reply = Invoke-WebRequest -Uri "$base/api/auth/login" -Method POST -ContentType 'application/json' -Body $body -Headers @{ Origin = $base } -WebSession $session -SkipHttpErrorCheck -TimeoutSec 20
    if ([int]$reply.StatusCode -ne 200) { Fail 'SPEC10_ADMIN_LOGIN_FAILED' }
    $data = $reply.Content | ConvertFrom-Json
    if ($data.user.companyId -ne $companyId -or -not $data.csrfToken -or $data.user.permissions -notcontains 'periods.generate' -or $data.user.permissions -notcontains 'payments.create') {
      Fail 'SPEC10_ADMIN_SCOPE_FAILED'
    }
    return @{ session = $session; csrf = [string]$data.csrfToken; user = $data.user }
  } finally { $body = $null; $Password = $null }
}
function Call([string] $Method, [string] $Path, $Body, $Identity) {
  $headers = @{ Origin = $base }
  if ($Method -ne 'GET') { $headers['X-CSRF-Token'] = $Identity.csrf }
  $options = @{ Uri = "$base$Path"; Method = $Method; Headers = $headers; WebSession = $Identity.session; SkipHttpErrorCheck = $true; TimeoutSec = 25 }
  if ($null -ne $Body) { $options.ContentType = 'application/json'; $options.Body = ConvertTo-Json $Body -Depth 12 -Compress }
  $reply = Invoke-WebRequest @options
  $data = if ($reply.Content -and [string]$reply.Headers['Content-Type'] -match 'json') { $reply.Content | ConvertFrom-Json } else { $null }
  return @{ status = [int]$reply.StatusCode; data = $data }
}

try {
  if (-not [IO.Path]::GetFullPath($CaseDirectory).StartsWith('D:\SPEC10-', [StringComparison]::OrdinalIgnoreCase)) { Fail 'SPEC10_CASE_PATH_UNSAFE' }
  $recordPath = Join-Path $CaseDirectory 'case.json'
  if (-not (Test-Path -LiteralPath $CaseDirectory)) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($sid in @($identity.User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    }
    [void][IO.FileSystemAclExtensions]::CreateDirectory($acl, $CaseDirectory)
  }
  $api = (docker inspect aflilientions-api-1 | ConvertFrom-Json)[0]
  $billing = (docker inspect spec09-billing-billing-spec09-sandbox-1 | ConvertFrom-Json)[0]
  if ($api.State.Health.Status -ne 'healthy' -or $billing.State.Health.Status -ne 'healthy') { Fail 'SPEC10_SERVICE_NOT_HEALTHY' }
  $apiFlags = @{}; foreach ($entry in $api.Config.Env) { $parts = $entry.Split('=', 2); $apiFlags[$parts[0]] = $parts[1] }
  $billingFlags = @{}; foreach ($entry in $billing.Config.Env) { $parts = $entry.Split('=', 2); $billingFlags[$parts[0]] = $parts[1] }
  if ($apiFlags['BILLING_MEMBERSHIP_STAG_ENABLED'] -ne 'false' -or $billingFlags['USE_REAL_HACIENDA'] -ne 'false' -or $billingFlags['EMAIL_USE_REAL'] -ne 'false') { Fail 'SPEC10_PREPARE_FLAGS_UNSAFE' }
  if ((Sql 'SELECT count(*) FROM "FiscalOutbox" WHERE state IN (''PENDING'',''RETRY'',''SENDING'',''AWAITING_HACIENDA'')') -ne '0') { Fail 'SPEC10_FISCAL_OUTBOX_NOT_EMPTY' }
  $adminEmail = Sql 'SELECT u.email FROM "User" u JOIN "Role" r ON r.id=u."roleId" WHERE r.code=''ADMIN'' AND u.status=''ACTIVE'''
  if ($adminEmail -notmatch '^[^@\s]+@[^@\s]+$') { Fail 'SPEC10_ADMIN_NOT_UNIQUE' }
  $password = Hidden 'Contraseña del ADMIN de Afiliaciones (oculta)'
  try { $admin = Login $adminEmail $password } finally { $password = $null }

  $periodQuery = "SELECT ap.id || '|' || o.id || '|' || o.amount || '|' || o.status FROM `"AffiliationPeriod`" ap JOIN `"Obligation`" o ON o.`"periodId`"=ap.id WHERE ap.`"affiliationId`"='$affiliationId' AND ap.`"periodEnd`"='$nextPeriodEnd'::date"
  $periodRow = Sql $periodQuery
  if (-not $periodRow) {
    $created = Call 'POST' "/api/affiliations/$affiliationId/periods/generate" @{ throughDate = $nextPeriodEnd } $admin
    if ($created.status -ne 200 -or $created.data.generatedCount -ne 1) { Fail 'SPEC10_SINGLE_PERIOD_GENERATION_FAILED' }
    $periodRow = Sql $periodQuery
  }
  $parts = $periodRow -split '\|'
  if ($parts.Count -ne 4 -or $parts[2] -ne '113.00' -or $parts[3] -ne 'PENDING') { Fail 'SPEC10_NEW_OBLIGATION_INVALID' }
  $periodId = $parts[0]; $obligationId = $parts[1]
  if ((Sql "SELECT count(*) FROM `"PaymentAllocation`" WHERE `"obligationId`"='$obligationId'") -ne '0') { Fail 'SPEC10_NEW_OBLIGATION_ALREADY_PAID' }
  $eligible = Call 'GET' "/api/payments/eligible-obligations?clientId=$clientId" $null $admin
  if ($eligible.status -ne 200 -or @($eligible.data | Where-Object { $_.id -eq $obligationId -and $_.periodId -eq $periodId -and $_.balance -eq '113.00' }).Count -ne 1) { Fail 'SPEC10_NEW_OBLIGATION_NOT_ELIGIBLE' }
  $accounts = Call 'GET' '/api/payments/destination-accounts?method=SINPE&currency=CRC' $null $admin
  if ($accounts.status -ne 200 -or @($accounts.data | Where-Object { $_.id -eq $accountId -and $_.kind -eq 'BANK' }).Count -ne 1) { Fail 'SPEC10_SINPE_ACCOUNT_UNAVAILABLE' }

  if (Test-Path -LiteralPath $recordPath) { $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json }
  else {
    $record = [ordered]@{ companyId = $companyId; clientId = $clientId; affiliationId = $affiliationId;
      periodId = $periodId; obligationId = $obligationId; accountId = $accountId;
      requestKey = [guid]::NewGuid().ToString(); reference = 'SPEC10-STAG-SYNTH-' + [guid]::NewGuid().ToString('N').Substring(0, 12).ToUpperInvariant();
      paidAt = [datetime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); paymentId = $null }
    $record | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $recordPath -Encoding UTF8
  }
  if ($record.companyId -ne $companyId -or $record.clientId -ne $clientId -or $record.periodId -ne $periodId -or $record.obligationId -ne $obligationId -or $record.accountId -ne $accountId) { Fail 'SPEC10_CASE_RECORD_MISMATCH' }
  $body = @{ requestKey = $record.requestKey; clientId = $clientId; accountId = $accountId; amount = '113.00'; currency = 'CRC';
    paidAt = $record.paidAt; method = 'SINPE'; reference = $record.reference; notes = 'Prueba STAG sintética; no se realizó transferencia bancaria';
    evidence = @{ fileName = 'spec10-comprobante-sintetico.png'; mimeType = 'image/png'; contentBase64 = $evidence };
    allocations = @(@{ obligationId = $obligationId; amount = '113.00' }) }
  $payment = Call 'POST' '/api/payments/evidenced' $body $admin
  if ($payment.status -notin @(200,201) -or $payment.data.status -ne 'PENDING_APPROVAL' -or $payment.data.accountId -ne $accountId -or $payment.data.submittedByUserId -ne $admin.user.id -or $payment.data.fiscal) { Fail 'SPEC10_PAYMENT_CREATE_FAILED' }
  if ($record.paymentId -and $record.paymentId -ne $payment.data.id) { Fail 'SPEC10_PAYMENT_IDEMPOTENCY_FAILED' }
  $record.paymentId = $payment.data.id
  $record | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $recordPath -Encoding UTF8
  $own = Call 'POST' "/api/payments/$($payment.data.id)/approve" @{} $admin
  if ($own.status -ne 403 -or $own.data.error.code -ne 'PAYMENT_SELF_APPROVAL_FORBIDDEN') { Fail 'SPEC10_SELF_APPROVAL_GUARD_FAILED' }
  Write-Output "SPEC10_PAYMENT_PENDING_REVIEW payment=$($payment.data.id) obligation=$obligationId period=$periodId"
} catch {
  $code = $_.Exception.Message
  if ($code -notmatch '^SPEC10_[A-Z_]+$') { $code = 'SPEC10_PAYMENT_PREPARE_UNEXPECTED_FAILURE' }
  Write-Error $code
  exit 1
} finally { $password = $null }
