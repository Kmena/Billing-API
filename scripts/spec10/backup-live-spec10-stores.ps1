param(
  [Parameter(Mandatory = $true)]
  [string] $Destination
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Docker([string[]] $Arguments) {
  $output = & docker @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'SPEC10_DOCKER_BACKUP_OPERATION_FAILED' }
  return ($output -join "`n").Trim()
}

function New-RestrictedDirectory([string] $Path) {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $acl = [System.Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  $control = [System.Security.AccessControl.AccessControlType]::Allow
  foreach ($sid in @($identity.User, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance, [System.Security.AccessControl.PropagationFlags]::None, $control)
    $acl.AddAccessRule($rule)
  }
  [void] [System.IO.FileSystemAclExtensions]::CreateDirectory($acl, $Path)
}

$target = [System.IO.Path]::GetFullPath($Destination)
$repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not $target.StartsWith('D:\SPEC10-', [System.StringComparison]::OrdinalIgnoreCase) -or
    $target.StartsWith($repo + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -or
    (Test-Path -LiteralPath $target) -or
    -not (Test-Path -LiteralPath (Split-Path -Parent $target))) {
  throw 'SPEC10_BACKUP_DESTINATION_UNSAFE'
}

$volumes = @(
  'spec09_billing_fiscal_storage',
  'spec09_billing_secret_store',
  'spec09_billing_master_key'
)
$image = 'alpine:3.20'
$digestScript = 'cd "$1" && if [ -n "$(find . -type l -print -quit)" ]; then exit 55; fi; (find . -type d -print | sort; find . -type f -exec sha256sum {} \; | sort) | sha256sum | cut -d " " -f1'
foreach ($volume in $volumes) {
  if ((Invoke-Docker @('volume', 'inspect', $volume, '--format', '{{.Name}}')) -ne $volume) {
    throw 'SPEC10_VOLUME_IDENTITY_MISMATCH'
  }
}

New-RestrictedDirectory $target
$manifest = @()
foreach ($volume in $volumes) {
  $archiveName = "$volume.tar"
  $archive = Join-Path $target $archiveName
  $sourceMount = "type=volume,source=$volume,target=/source,readonly"
  $backupMount = "type=bind,source=$target,target=/backup"
  $restoreMount = "type=bind,source=$target,target=/backup,readonly"
  $before = Invoke-Docker @('run', '--rm', '--network', 'none', '--read-only', '--mount', $sourceMount,
    '--entrypoint', 'sh', $image, '-c', $digestScript, 'sh', '/source')
  if ($before -notmatch '^[0-9a-f]{64}$') { throw 'SPEC10_SOURCE_DIGEST_INVALID' }
  [void] (Invoke-Docker @('run', '--rm', '--network', 'none', '--read-only', '--mount', $sourceMount,
    '--mount', $backupMount, '--entrypoint', 'tar', $image, '-C', '/source', '-cf', "/backup/$archiveName", '.'))
  if (-not (Test-Path -LiteralPath $archive) -or (Get-Item -LiteralPath $archive).Length -lt 1024) {
    throw 'SPEC10_ARCHIVE_MISSING_OR_SMALL'
  }
  $after = Invoke-Docker @('run', '--rm', '--network', 'none', '--read-only', '--mount', $sourceMount,
    '--entrypoint', 'sh', $image, '-c', $digestScript, 'sh', '/source')
  if ($after -ne $before) { throw 'SPEC10_SOURCE_CHANGED_DURING_BACKUP' }
  $restoreCommand = "tar -xf /backup/$archiveName -C /restore && $digestScript"
  $restored = Invoke-Docker @('run', '--rm', '--network', 'none', '--read-only',
    '--tmpfs', '/restore:rw,noexec,nosuid,size=768m', '--mount', $restoreMount,
    '--entrypoint', 'sh', $image, '-c', $restoreCommand, 'sh', '/restore')
  if ($restored -ne $before) { throw 'SPEC10_RESTORE_DIGEST_MISMATCH' }
  $manifest += [ordered]@{
    volume = $volume
    archive = $archiveName
    bytes = (Get-Item -LiteralPath $archive).Length
    archiveSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    treeDigest = $before
    restoreVerified = $true
  }
}
$manifestPath = Join-Path $target 'manifest.json'
[System.IO.File]::WriteAllText($manifestPath, (@{
  format = 'spec10-live-immutable-store-backup-v1'
  createdUtc = [DateTime]::UtcNow.ToString('o')
  volumes = $manifest
} | ConvertTo-Json -Depth 5), [System.Text.Encoding]::UTF8)
Write-Output 'SPEC10_LIVE_STORES_BACKUP_RESTORE_PASS'
