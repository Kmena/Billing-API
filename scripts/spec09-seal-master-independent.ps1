param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Backup', 'Verify', 'RestoreToDisposable')]
  [string] $Mode,

  [Parameter(Mandatory = $true)]
  [string] $Directory,

  [string] $DpapiDirectory,
  [string] $DisposableContainer,
  [System.Security.SecureString] $Passphrase,
  [System.Security.SecureString] $ConfirmPassphrase
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function ConvertTo-SecretBytes([System.Security.SecureString] $Value) {
  if ($null -eq $Value) { throw 'PASSPHRASE_REQUIRED' }
  $address = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    $length = [System.Runtime.InteropServices.Marshal]::ReadInt32($address, -4) / 2
    if ($length -lt 32 -or $length -gt 1024) { throw 'PASSPHRASE_LENGTH_INVALID' }
    $characters = [char[]]::new($length)
    try {
      for ($index = 0; $index -lt $length; $index++) {
        $characters[$index] = [char][System.Runtime.InteropServices.Marshal]::ReadInt16($address, $index * 2)
      }
      return ,([System.Text.Encoding]::UTF8.GetBytes($characters))
    } finally { [Array]::Clear($characters, 0, $characters.Length) }
  } finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($address) }
}

function Invoke-DockerBytes([string[]] $Arguments, [byte[]] $InputBytes = $null) {
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

function New-RestrictedDirectory([string] $Path) {
  if ([System.IO.Directory]::Exists($Path) -or [System.IO.File]::Exists($Path)) { throw 'DESTINATION_ALREADY_EXISTS' }
  $acl = [System.Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  $propagation = [System.Security.AccessControl.PropagationFlags]::None
  $control = [System.Security.AccessControl.AccessControlType]::Allow
  $current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  foreach ($identity in @($current, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($identity, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, $propagation, $control))
  }
  [void] [System.IO.FileSystemAclExtensions]::CreateDirectory($acl, $Path)
}

try {
  $fullDirectory = [System.IO.Path]::GetFullPath($Directory)
  $repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  if ($fullDirectory.StartsWith($repo + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -or
      $fullDirectory -eq $repo) { throw 'DESTINATION_INSIDE_REPOSITORY' }
  $envelopePath = Join-Path $fullDirectory 'master-key.independent.json'
  if ($null -eq $Passphrase) { $Passphrase = Read-Host 'Frase de recuperación (mínimo 32 caracteres)' -AsSecureString }
  $passphraseBytes = ConvertTo-SecretBytes $Passphrase
  try {
    if ($Mode -eq 'Backup') {
      if (-not $DpapiDirectory) { throw 'DPAPI_DIRECTORY_REQUIRED' }
      if ($null -eq $ConfirmPassphrase) { $ConfirmPassphrase = Read-Host 'Repita la frase de recuperación' -AsSecureString }
      $confirmationBytes = ConvertTo-SecretBytes $ConfirmPassphrase
      try {
        if (-not [System.Security.Cryptography.CryptographicOperations]::FixedTimeEquals($passphraseBytes, $confirmationBytes)) {
          throw 'PASSPHRASE_CONFIRMATION_FAILED'
        }
      } finally { [Array]::Clear($confirmationBytes, 0, $confirmationBytes.Length) }
      $dpapiPath = [System.IO.Path]::GetFullPath($DpapiDirectory)
      $metadata = Get-Content -LiteralPath (Join-Path $dpapiPath 'manifest.json') -Raw | ConvertFrom-Json
      if ($metadata.format -ne 'spec09-dpapi-current-user-v2' -or
          $metadata.accountSid -ne [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value) {
        throw 'DPAPI_IDENTITY_MISMATCH'
      }
      $protected = [System.IO.File]::ReadAllBytes((Join-Path $dpapiPath 'master-key.dpapi'))
      $protectedSha = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($protected)).ToLowerInvariant()
      if ($protectedSha -ne $metadata.cipherSha256) { throw 'DPAPI_CIPHERTEXT_MISMATCH' }
      $payload = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      try {
        if ($payload.Length -ne 33) { throw 'DPAPI_PAYLOAD_INVALID' }
        $trustedSource = switch ($payload[0]) { 1 { 'installed' } 2 { 'synthetic' } default { throw 'DPAPI_SOURCE_INVALID' } }
        if ($metadata.source -ne $trustedSource) { throw 'DPAPI_SOURCE_MISMATCH' }
        $masterKey = [byte[]]::new(32)
        [Array]::Copy($payload, 1, $masterKey, 0, 32)
        try {
        $masterSha = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($masterKey)).ToLowerInvariant()
        if ($masterKey.Length -ne 32 -or $masterSha -ne $metadata.keySha256) { throw 'DPAPI_KEY_MISMATCH' }
        $salt = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
        $nonce = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(12)
        $derived = [System.Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2($passphraseBytes, $salt, 1000000, [System.Security.Cryptography.HashAlgorithmName]::SHA512, 32)
        try {
          $cipher = [byte[]]::new(32)
          $tag = [byte[]]::new(16)
          $aad = [System.Text.Encoding]::UTF8.GetBytes('spec09-independent-master-v2|' + $trustedSource)
          $aes = [System.Security.Cryptography.AesGcm]::new($derived, 16)
          try { $aes.Encrypt($nonce, $masterKey, $cipher, $tag, $aad) } finally { $aes.Dispose() }
          $envelope = [ordered]@{
            format = 'spec09-independent-master-v2'
            source = $trustedSource
            createdUtc = [DateTime]::UtcNow.ToString('o')
            kdf = 'PBKDF2-HMAC-SHA512'
            iterations = 1000000
            salt = [Convert]::ToBase64String($salt)
            nonce = [Convert]::ToBase64String($nonce)
            ciphertext = [Convert]::ToBase64String($cipher)
            tag = [Convert]::ToBase64String($tag)
            keySha256 = $masterSha
          }
          New-RestrictedDirectory $fullDirectory
          [System.IO.File]::WriteAllText($envelopePath, ($envelope | ConvertTo-Json -Compress), [System.Text.Encoding]::UTF8)
          Write-Output 'SPEC09_INDEPENDENT_MASTER_BACKUP_CREATED'
        } finally { [Array]::Clear($derived, 0, $derived.Length) }
        } finally { [Array]::Clear($masterKey, 0, $masterKey.Length) }
      } finally { [Array]::Clear($payload, 0, $payload.Length) }
      return
    }

    $envelope = Get-Content -LiteralPath $envelopePath -Raw | ConvertFrom-Json
    if ($envelope.format -ne 'spec09-independent-master-v2' -or $envelope.kdf -ne 'PBKDF2-HMAC-SHA512' -or
        $envelope.iterations -ne 1000000 -or $envelope.source -notin @('installed', 'synthetic')) { throw 'ENVELOPE_FORMAT_INVALID' }
    $salt = [Convert]::FromBase64String($envelope.salt)
    $nonce = [Convert]::FromBase64String($envelope.nonce)
    $cipher = [Convert]::FromBase64String($envelope.ciphertext)
    $tag = [Convert]::FromBase64String($envelope.tag)
    if ($salt.Length -ne 32 -or $nonce.Length -ne 12 -or $cipher.Length -ne 32 -or $tag.Length -ne 16) {
      throw 'ENVELOPE_LENGTH_INVALID'
    }
    $derived = [System.Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2($passphraseBytes, $salt, 1000000, [System.Security.Cryptography.HashAlgorithmName]::SHA512, 32)
    try {
      $masterKey = [byte[]]::new(32)
      try {
        $aad = [System.Text.Encoding]::UTF8.GetBytes('spec09-independent-master-v2|' + $envelope.source)
        $aes = [System.Security.Cryptography.AesGcm]::new($derived, 16)
        try { $aes.Decrypt($nonce, $cipher, $tag, $masterKey, $aad) } finally { $aes.Dispose() }
        $masterSha = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($masterKey)).ToLowerInvariant()
        if ($masterSha -ne $envelope.keySha256) { throw 'INDEPENDENT_KEY_MISMATCH' }
        if ($Mode -eq 'Verify') {
          Write-Output 'SPEC09_INDEPENDENT_MASTER_RECOVERY_VERIFIED'
          return
        }
        if ($envelope.source -ne 'synthetic' -or -not $DisposableContainer) { throw 'DISPOSABLE_RESTORE_REQUIRES_SYNTHETIC_KEY' }
        $label = [System.Text.Encoding]::UTF8.GetString((Invoke-DockerBytes @('inspect', '--format', '{{ index .Config.Labels "spec09-disposable-recovery" }}', $DisposableContainer))).Trim()
        if ($label -ne 'true') { throw 'DISPOSABLE_CONTAINER_GUARD' }
        [void] (Invoke-DockerBytes @('exec', '-i', $DisposableContainer, 'sh', '-c', 'umask 077; cat > /run/spec09-key/master.key') $masterKey)
        Write-Output 'SPEC09_INDEPENDENT_MASTER_DISPOSABLE_RESTORE_VERIFIED'
      } finally { [Array]::Clear($masterKey, 0, $masterKey.Length) }
    } finally { [Array]::Clear($derived, 0, $derived.Length) }
  } finally { [Array]::Clear($passphraseBytes, 0, $passphraseBytes.Length) }
} catch {
  Write-Error 'SPEC09_INDEPENDENT_MASTER_FAILED' -ErrorAction Continue
  exit 1
}
