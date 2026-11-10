param(
  [Parameter(Mandatory)][string]$BackupDirectory,
  [switch]$Resume
)

$ErrorActionPreference = 'Stop'
$containerName = 'spec09-billing-billing-spec09-sandbox-1'
$expectedImage = 'sha256:eba8ab4c0e927f840b085bd92da4609bf7f0af34d672193f73af0d82fda3a1fb'
$sourceVolume = 'spec09_billing_master_key'
$backupFile = Join-Path $BackupDirectory 'spec09-billing-master-key.dpapi'
$manifestFile = Join-Path $BackupDirectory 'spec09-billing-master-key.manifest.json'
$entropy = [Text.Encoding]::UTF8.GetBytes('SPEC09-BILLING-MASTER-KEY-BACKUP-V1')

if (-not $IsWindows -or -not [IO.Path]::IsPathFullyQualified($BackupDirectory) -or
    -not (Test-Path -LiteralPath $BackupDirectory -PathType Container) -or
    ((Test-Path -LiteralPath $backupFile) -and -not $Resume) -or
    ($Resume -and -not (Test-Path -LiteralPath $backupFile)) -or
    (Test-Path -LiteralPath $manifestFile)) {
  throw 'SPEC09_MASTER_BACKUP_INPUT_INVALID'
}
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ([IO.Path]::GetFullPath($BackupDirectory).StartsWith($repositoryRoot + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase)) { throw 'SPEC09_MASTER_BACKUP_LOCATION_INVALID' }
$ancestor = [IO.Path]::GetFullPath($BackupDirectory)
while ($ancestor) {
  if (Test-Path -LiteralPath (Join-Path $ancestor '.git')) {
    throw 'SPEC09_MASTER_BACKUP_LOCATION_INVALID'
  }
  $parent = [IO.Directory]::GetParent($ancestor)
  if ($null -eq $parent) { break }
  $ancestor = $parent.FullName
}
$broadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
foreach ($rule in (Get-Acl -LiteralPath $BackupDirectory).Access) {
  $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if ($rule.AccessControlType -eq 'Allow' -and $sid -in $broadSids) {
    throw 'SPEC09_MASTER_BACKUP_ACL_TOO_BROAD'
  }
}

function Invoke-DockerBytes([string[]]$Arguments, [byte[]]$InputBytes) {
  $start = [Diagnostics.ProcessStartInfo]::new((Get-Command docker -ErrorAction Stop).Source)
  foreach ($argument in $Arguments) { [void]$start.ArgumentList.Add($argument) }
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = [Diagnostics.Process]::Start($start)
  $output = [IO.MemoryStream]::new()
  try {
    if ($null -ne $InputBytes) { $process.StandardInput.BaseStream.Write($InputBytes) }
    $process.StandardInput.Close()
    $process.StandardOutput.BaseStream.CopyTo($output)
    [void]$process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw 'SPEC09_MASTER_BACKUP_DOCKER_FAILED' }
    return ,($output.ToArray())
  } finally {
    [Array]::Clear($output.GetBuffer(), 0, $output.Capacity)
    $output.Dispose()
    $process.Dispose()
  }
}

$image = (& docker inspect $containerName --format '{{.Image}}' 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $image -ne $expectedImage) { throw 'SPEC09_MASTER_BACKUP_SOURCE_INVALID' }
$mounts = (& docker inspect $containerName --format '{{json .Mounts}}' 2>$null) | ConvertFrom-Json
$keyMount = @($mounts | Where-Object { $_.Name -eq $sourceVolume -and $_.Destination -eq '/run/spec09-key' })
if ($LASTEXITCODE -ne 0 -or $keyMount.Count -ne 1 -or $keyMount[0].RW -ne $false) {
  throw 'SPEC09_MASTER_BACKUP_SOURCE_INVALID'
}

$key = $null
$protected = $null
$restored = $null
$testVolume = 'spec09-master-key-restore-' + [guid]::NewGuid().ToString('N')
$testVolumeCreated = $false
try {
  $key = Invoke-DockerBytes @('exec', $containerName, 'cat', '/run/spec09-key/master.key') $null
  if ($key.Length -ne 32) { throw 'SPEC09_MASTER_BACKUP_SOURCE_INVALID' }
  $keyHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($key)).ToLowerInvariant()
  if ($Resume) {
    $protected = [IO.File]::ReadAllBytes($backupFile)
  } else {
    $protected = [Security.Cryptography.ProtectedData]::Protect(
      $key, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $stream = [IO.File]::Open($backupFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($protected) } finally { $stream.Dispose() }
  }
  $protectedHash = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash.ToLowerInvariant()
  $restored = [Security.Cryptography.ProtectedData]::Unprotect(
    [IO.File]::ReadAllBytes($backupFile), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  if (-not [Security.Cryptography.CryptographicOperations]::FixedTimeEquals($key, $restored)) {
    throw 'SPEC09_MASTER_BACKUP_DPAPI_VERIFY_FAILED'
  }

  $created = (& docker volume create --label codex.disposable=true $testVolume 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $created -ne $testVolume) { throw 'SPEC09_MASTER_BACKUP_TEST_VOLUME_FAILED' }
  $testVolumeCreated = $true
  [void](Invoke-DockerBytes @('run', '--rm', '-i', '--pull', 'never', '--network', 'none', '--read-only',
    '--mount', "type=volume,source=$testVolume,target=/restore", 'postgres:16-alpine', 'sh', '-c',
    'umask 077; cat > /restore/master.key && chmod 400 /restore/master.key') $restored)
  $testHashBytes = Invoke-DockerBytes @('run', '--rm', '--pull', 'never', '--network', 'none', '--read-only',
    '--mount', "type=volume,source=$testVolume,target=/restore,readonly", 'postgres:16-alpine', 'sh', '-c',
    'sha256sum /restore/master.key') $null
  try { $testHash = ([Text.Encoding]::UTF8.GetString($testHashBytes).Trim() -split '\s+')[0] }
  finally { [Array]::Clear($testHashBytes, 0, $testHashBytes.Length) }
  if ($testHash -ne $keyHash) {
    throw "SPEC09_MASTER_BACKUP_RESTORE_VERIFY_FAILED expectedSha256=$keyHash actualSha256=$testHash"
  }

  [pscustomobject]@{
    format = 'spec09-master-key-dpapi-v1'
    createdUtc = [DateTime]::UtcNow.ToString('o')
    sourceVolume = $sourceVolume
    sourceImage = $image
    keyBytes = $key.Length
    keySha256 = $keyHash
    encryptedFile = [IO.Path]::GetFileName($backupFile)
    encryptedSha256 = $protectedHash
    restoreTest = 'PASS'
    dpapiScope = 'CurrentUser'
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestFile -Encoding utf8 -NoNewline
  Write-Output "SPEC09_MASTER_KEY_BACKUP_AND_RESTORE_PASS encryptedSha256=$protectedHash"
} finally {
  if ($testVolumeCreated) {
    & docker volume rm $testVolume *> $null
    if ($LASTEXITCODE -ne 0) { throw 'SPEC09_MASTER_BACKUP_TEST_VOLUME_CLEANUP_FAILED' }
  }
  if ($null -ne $key) { [Array]::Clear($key, 0, $key.Length) }
  if ($null -ne $protected) { [Array]::Clear($protected, 0, $protected.Length) }
  if ($null -ne $restored) { [Array]::Clear($restored, 0, $restored.Length) }
  [Array]::Clear($entropy, 0, $entropy.Length)
}
