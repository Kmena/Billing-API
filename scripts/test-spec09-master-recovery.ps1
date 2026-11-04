$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$temporaryRoot = [System.IO.Path]::GetFullPath((Join-Path $env:TEMP ('spec09-master-recovery-' + [guid]::NewGuid().ToString('N'))))
$temporaryParent = [System.IO.Path]::GetFullPath($env:TEMP)
if (-not $temporaryRoot.StartsWith($temporaryParent + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'UNSAFE_TEMPORARY_ROOT'
}
$container = 'spec09-master-recovery-' + [guid]::NewGuid().ToString('N').Substring(0, 10)
$created = $false
[void] [System.IO.Directory]::CreateDirectory($temporaryRoot)
try {
  $keyFile = Join-Path $temporaryRoot 'synthetic.key'
  $dpapiDir = Join-Path $temporaryRoot 'dpapi'
  $independentDir = Join-Path $temporaryRoot 'independent'
  $syntheticKey = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
  [System.IO.File]::WriteAllBytes($keyFile, $syntheticKey)
  $expected = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($syntheticKey)).ToLowerInvariant()
  [Array]::Clear($syntheticKey, 0, $syntheticKey.Length)

  & (Join-Path $PSScriptRoot 'spec09-backup-master-dpapi.ps1') -Mode Backup -Directory $dpapiDir -Source Synthetic -SyntheticKeyFile $keyFile
  & (Join-Path $PSScriptRoot 'spec09-backup-master-dpapi.ps1') -Mode Verify -Directory $dpapiDir
  $tamperedDir = Join-Path $temporaryRoot 'tampered'
  [void] [System.IO.Directory]::CreateDirectory($tamperedDir)
  Copy-Item -LiteralPath (Join-Path $dpapiDir 'master-key.dpapi') -Destination $tamperedDir
  $tampered = Get-Content -LiteralPath (Join-Path $dpapiDir 'manifest.json') -Raw | ConvertFrom-Json
  $tampered.source = 'installed'
  [System.IO.File]::WriteAllText((Join-Path $tamperedDir 'manifest.json'), ($tampered | ConvertTo-Json -Compress), [System.Text.Encoding]::UTF8)
  $probe = & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'spec09-backup-master-dpapi.ps1') -Mode Verify -Directory $tamperedDir 2>&1
  if ($LASTEXITCODE -eq 0 -or @($probe | Where-Object { "$_" -match 'master.key|synthetic.key' }).Count -gt 0) {
    throw 'TAMPERED_SOURCE_ACCEPTED_OR_DISCLOSED'
  }
  Write-Output 'SPEC09_DPAPI_SOURCE_TAMPER_REJECTED'
  $phrase = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
  $securePhrase = ConvertTo-SecureString $phrase -AsPlainText -Force
  $phrase = $null
  try {
    & (Join-Path $PSScriptRoot 'spec09-seal-master-independent.ps1') -Mode Backup -Directory $independentDir -DpapiDirectory $dpapiDir -Passphrase $securePhrase -ConfirmPassphrase $securePhrase
    Rename-Item -LiteralPath $dpapiDir -NewName 'dpapi-unavailable'
    & (Join-Path $PSScriptRoot 'spec09-seal-master-independent.ps1') -Mode Verify -Directory $independentDir -Passphrase $securePhrase

    $run = & docker run -d --name $container --label spec09-disposable-recovery=true --network none --tmpfs /run/spec09-key:rw,noexec,nosuid,size=1m alpine:3.20 sleep 300
    if ($LASTEXITCODE -ne 0 -or -not $run) { throw 'DISPOSABLE_CONTAINER_START_FAILED' }
    $created = $true
    & (Join-Path $PSScriptRoot 'spec09-seal-master-independent.ps1') -Mode RestoreToDisposable -Directory $independentDir -DisposableContainer $container -Passphrase $securePhrase
    $actual = (& docker exec $container sha256sum /run/spec09-key/master.key).Split(' ')[0]
    if ($LASTEXITCODE -ne 0 -or $actual -ne $expected) { throw 'INDEPENDENT_RESTORE_MISMATCH' }
    [void] (& docker restart $container)
    if ($LASTEXITCODE -ne 0) { throw 'DISPOSABLE_RESTART_FAILED' }
    & (Join-Path $PSScriptRoot 'spec09-seal-master-independent.ps1') -Mode RestoreToDisposable -Directory $independentDir -DisposableContainer $container -Passphrase $securePhrase
    $actual = (& docker exec $container sha256sum /run/spec09-key/master.key).Split(' ')[0]
    if ($LASTEXITCODE -ne 0 -or $actual -ne $expected) { throw 'RESTART_RESTORE_MISMATCH' }
    Write-Output 'SPEC09_SYNTHETIC_INDEPENDENT_RECOVERY_PASS'
  } finally { $securePhrase.Dispose() }
} finally {
  if ($created) {
    $label = (& docker inspect --format '{{ index .Config.Labels "spec09-disposable-recovery" }}' $container).Trim()
    if ($LASTEXITCODE -ne 0 -or $label -ne 'true') { throw 'DISPOSABLE_CONTAINER_GUARD' }
    [void] (& docker rm -f $container)
  }
  if ([System.IO.Directory]::Exists($temporaryRoot)) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
