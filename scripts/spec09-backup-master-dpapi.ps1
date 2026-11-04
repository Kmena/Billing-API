param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Backup', 'Verify', 'RestoreToDisposable')]
  [string] $Mode,

  [Parameter(Mandatory = $true)]
  [string] $Directory,

  [ValidateSet('Installed', 'Synthetic')]
  [string] $Source = 'Installed',

  [string] $SyntheticKeyFile,
  [string] $DisposableContainer
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Bytes([string[]] $Arguments, [byte[]] $InputBytes = $null) {
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = 'docker'
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.RedirectStandardInput = $null -ne $InputBytes
  foreach ($argument in $Arguments) { [void] $start.ArgumentList.Add($argument) }
  $process = [System.Diagnostics.Process]::Start($start)
  try {
    if ($null -ne $InputBytes) {
      $process.StandardInput.BaseStream.Write($InputBytes, 0, $InputBytes.Length)
      $process.StandardInput.Close()
    }
    $output = [System.IO.MemoryStream]::new()
    try {
      $process.StandardOutput.BaseStream.CopyTo($output)
      $process.WaitForExit()
      if ($process.ExitCode -ne 0) { throw 'DOCKER_OPERATION_FAILED' }
      return ,($output.ToArray())
    } finally { $output.Dispose() }
  } finally { $process.Dispose() }
}

function Get-InstalledKey {
  $name = [System.Text.Encoding]::UTF8.GetString((Invoke-Bytes @('volume', 'inspect', 'spec09_billing_master_key', '--format', '{{.Name}}'))).Trim()
  if ($name -ne 'spec09_billing_master_key') { throw 'UNEXPECTED_MASTER_VOLUME' }
  return ,(Invoke-Bytes @('run', '--rm', '--network', 'none', '--mount', 'type=volume,source=spec09_billing_master_key,target=/source,readonly', '--entrypoint', 'cat', 'alpine:3.20', '/source/master.key'))
}

function New-RestrictedDirectory([string] $Path) {
  if ([System.IO.Directory]::Exists($Path) -or [System.IO.File]::Exists($Path)) { throw 'DESTINATION_ALREADY_EXISTS' }
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $acl = [System.Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  $propagation = [System.Security.AccessControl.PropagationFlags]::None
  $control = [System.Security.AccessControl.AccessControlType]::Allow
  foreach ($sid in @($identity.User, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, $propagation, $control)
    $acl.AddAccessRule($rule)
  }
  [void] [System.IO.FileSystemAclExtensions]::CreateDirectory($acl, $Path)
}

try {
  $fullDirectory = [System.IO.Path]::GetFullPath($Directory)
  $repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  if ($fullDirectory.StartsWith($repo + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -or
      $fullDirectory -eq $repo) { throw 'DESTINATION_INSIDE_REPOSITORY' }

  $cipherPath = Join-Path $fullDirectory 'master-key.dpapi'
  $manifestPath = Join-Path $fullDirectory 'manifest.json'
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value

  if ($Mode -eq 'Backup') {
    if ($Source -eq 'Synthetic') {
      if (-not $SyntheticKeyFile) { throw 'SYNTHETIC_FILE_REQUIRED' }
      $key = [System.IO.File]::ReadAllBytes([System.IO.Path]::GetFullPath($SyntheticKeyFile))
    } else {
      if ($SyntheticKeyFile) { throw 'UNEXPECTED_SYNTHETIC_FILE' }
      $key = Get-InstalledKey
    }
    if ($key.Length -ne 32) { throw 'MASTER_KEY_LENGTH_INVALID' }
    try {
      if ($Source -eq 'Installed') {
        $secondRead = Get-InstalledKey
        try {
          if ($secondRead.Length -ne 32 -or -not [System.Security.Cryptography.CryptographicOperations]::FixedTimeEquals($key, $secondRead)) {
            throw 'MASTER_KEY_CHANGED_DURING_BACKUP'
          }
        } finally { [Array]::Clear($secondRead, 0, $secondRead.Length) }
      }
      $payload = [byte[]]::new(33)
      $payload[0] = if ($Source -eq 'Installed') { 1 } else { 2 }
      [Array]::Copy($key, 0, $payload, 1, 32)
      $cipher = [System.Security.Cryptography.ProtectedData]::Protect($payload, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      $roundTrip = [System.Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      try {
        if (-not [System.Security.Cryptography.CryptographicOperations]::FixedTimeEquals($payload, $roundTrip)) { throw 'DPAPI_ROUND_TRIP_FAILED' }
      } finally {
        [Array]::Clear($roundTrip, 0, $roundTrip.Length)
        [Array]::Clear($payload, 0, $payload.Length)
      }
      New-RestrictedDirectory $fullDirectory
      [System.IO.File]::WriteAllBytes($cipherPath, $cipher)
      $manifest = [ordered]@{
        format = 'spec09-dpapi-current-user-v2'
        source = $Source.ToLowerInvariant()
        accountSid = $sid
        computer = $env:COMPUTERNAME
        createdUtc = [DateTime]::UtcNow.ToString('o')
        cipherSha256 = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($cipher)).ToLowerInvariant()
        keySha256 = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($key)).ToLowerInvariant()
      }
      [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Compress), [System.Text.Encoding]::UTF8)
      Write-Output 'SPEC09_MASTER_DPAPI_BACKUP_CREATED'
    } finally { [Array]::Clear($key, 0, $key.Length) }
    return
  }

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.format -ne 'spec09-dpapi-current-user-v2' -or $manifest.accountSid -ne $sid) { throw 'DPAPI_IDENTITY_MISMATCH' }
  $cipher = [System.IO.File]::ReadAllBytes($cipherPath)
  $cipherSha = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($cipher)).ToLowerInvariant()
  if ($cipherSha -ne $manifest.cipherSha256) { throw 'DPAPI_CIPHERTEXT_MISMATCH' }
  $payload = [System.Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  try {
    if ($payload.Length -ne 33) { throw 'DPAPI_PAYLOAD_INVALID' }
    $trustedSource = switch ($payload[0]) { 1 { 'installed' } 2 { 'synthetic' } default { throw 'DPAPI_SOURCE_INVALID' } }
    if ($manifest.source -ne $trustedSource) { throw 'DPAPI_SOURCE_MISMATCH' }
    $key = [byte[]]::new(32)
    [Array]::Copy($payload, 1, $key, 0, 32)
    try {
    $keySha = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($key)).ToLowerInvariant()
    if ($key.Length -ne 32 -or $keySha -ne $manifest.keySha256) { throw 'DPAPI_KEY_MISMATCH' }
    if ($Mode -eq 'Verify') {
      Write-Output 'SPEC09_MASTER_DPAPI_RECOVERY_VERIFIED'
      return
    }
    if ($trustedSource -ne 'synthetic' -or -not $DisposableContainer) { throw 'DISPOSABLE_RESTORE_REQUIRES_SYNTHETIC_KEY' }
    $label = [System.Text.Encoding]::UTF8.GetString((Invoke-Bytes @('inspect', '--format', '{{ index .Config.Labels "spec09-disposable-recovery" }}', $DisposableContainer))).Trim()
    if ($label -ne 'true') { throw 'DISPOSABLE_CONTAINER_GUARD' }
    [void] (Invoke-Bytes @('exec', '-i', $DisposableContainer, 'sh', '-c', 'umask 077; cat > /run/spec09-key/master.key') $key)
    Write-Output 'SPEC09_MASTER_DPAPI_DISPOSABLE_RESTORE_VERIFIED'
    } finally { [Array]::Clear($key, 0, $key.Length) }
  } finally { [Array]::Clear($payload, 0, $payload.Length) }
} catch {
  Write-Error 'SPEC09_MASTER_DPAPI_FAILED' -ErrorAction Continue
  exit 1
}
