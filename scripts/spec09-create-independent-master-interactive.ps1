param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Backup', 'Verify', 'NegativeProbe')]
  [string] $Mode,

  [Parameter(Mandatory = $true)]
  [string] $Directory,

  [string] $DpapiDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$sealScript = Join-Path $PSScriptRoot 'spec09-seal-master-independent.ps1'

try {
  if ($Mode -eq 'NegativeProbe') {
    $randomPhrase = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
    $wrong = ConvertTo-SecureString $randomPhrase -AsPlainText -Force
    $randomPhrase = $null
    try {
      & $sealScript -Mode Verify -Directory $Directory -Passphrase $wrong
    } finally { $wrong.Dispose() }
    exit 0
  }

  if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) {
    throw 'INTERACTIVE_CONSOLE_REQUIRED'
  }

  if ($Mode -eq 'Backup') {
    if (-not $DpapiDirectory) { throw 'DPAPI_DIRECTORY_REQUIRED' }
    $manifest = Get-Content -LiteralPath (Join-Path $DpapiDirectory 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.format -ne 'spec09-dpapi-current-user-v2' -or $manifest.source -ne 'installed') {
      throw 'INSTALLED_DPAPI_BACKUP_REQUIRED'
    }
    $phrase = Read-Host 'Pegue la contraseña de Bitwarden (oculta)' -AsSecureString
    $confirmation = Read-Host 'Péguela de nuevo para confirmar (oculta)' -AsSecureString
    try {
      $backupOutput = & $sealScript -Mode Backup -DpapiDirectory $DpapiDirectory -Directory $Directory -Passphrase $phrase -ConfirmPassphrase $confirmation
      if (@($backupOutput) -notcontains 'SPEC09_INDEPENDENT_MASTER_BACKUP_CREATED') { throw 'BACKUP_FAILED' }
    } finally {
      $phrase.Dispose()
      $confirmation.Dispose()
    }
    Write-Output 'SPEC09_INDEPENDENT_MASTER_CREATED_PENDING_VERIFICATION'
  }

  $verificationPhrase = Read-Host 'Vuelva a copiar la contraseña desde Bitwarden para verificar (oculta)' -AsSecureString
  try {
    $verifyOutput = & $sealScript -Mode Verify -Directory $Directory -Passphrase $verificationPhrase
    if (@($verifyOutput) -notcontains 'SPEC09_INDEPENDENT_MASTER_RECOVERY_VERIFIED') { throw 'VERIFY_FAILED' }
  } finally { $verificationPhrase.Dispose() }

  $probe = & pwsh -NoProfile -File $PSCommandPath -Mode NegativeProbe -Directory $Directory 2>&1
  $probeText = @($probe | ForEach-Object { $_.ToString() }) -join ' '
  if ($probeText -notmatch 'SPEC09_INDEPENDENT_MASTER_FAILED' -or
      $probeText -match 'SPEC09_INDEPENDENT_MASTER_RECOVERY_VERIFIED') {
    throw 'WRONG_PASSPHRASE_ACCEPTED'
  }

  $envelopePath = Join-Path $Directory 'master-key.independent.json'
  $envelope = Get-Content -LiteralPath $envelopePath -Raw | ConvertFrom-Json
  if ($envelope.format -ne 'spec09-independent-master-v2' -or $envelope.source -ne 'installed') {
    throw 'ENVELOPE_SOURCE_OR_FORMAT_INVALID'
  }
  $acl = Get-Acl -LiteralPath $Directory
  if (-not $acl.AreAccessRulesProtected) { throw 'ENVELOPE_ACL_INHERITED' }
  $allowedSids = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18')
  foreach ($entry in $acl.Access) {
    if ($entry.AccessControlType -ne 'Allow') { continue }
    $sid = $entry.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin $allowedSids) { throw 'ENVELOPE_ACL_TOO_BROAD' }
  }

  $result = [ordered]@{
    format = 'spec09-independent-master-verification-v1'
    status = 'PASS'
    source = 'installed'
    verifiedUtc = [DateTime]::UtcNow.ToString('o')
    ciphertextSha256 = (Get-FileHash -LiteralPath $envelopePath -Algorithm SHA256).Hash.ToLowerInvariant()
    wrongPhraseRejected = $true
    dpapiIndependentVerification = $true
    restrictedAcl = $true
  }
  [System.IO.File]::WriteAllText((Join-Path $Directory 'verification.json'), ($result | ConvertTo-Json -Compress), [System.Text.Encoding]::UTF8)
  Write-Output 'SPEC09_INDEPENDENT_MASTER_LOCAL_VERIFICATION_PASS'
} catch {
  Write-Error 'SPEC09_INDEPENDENT_MASTER_INTERACTIVE_FAILED' -ErrorAction Continue
  exit 1
}
