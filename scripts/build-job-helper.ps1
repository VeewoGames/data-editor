[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [switch]$TestFaults,
  [string]$SourcePath,
  [string]$TestPauseBeforePublishPath,
  [string]$TestContinuePublishPath
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$toolRoot = Split-Path -Parent $scriptRoot
if (-not $SourcePath) {
  $SourcePath = Join-Path $toolRoot "native\job-helper\JobHelper.cs"
}
$sourcePath = [IO.Path]::GetFullPath($SourcePath)
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $toolRoot "native\job-helper\bin\win32-x64"
}
$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
$outputParent = Split-Path -Parent $resolvedOutput
[IO.Directory]::CreateDirectory($outputParent) | Out-Null
$buildDirectory = Join-Path $outputParent (".job-helper-build-" + [Guid]::NewGuid().ToString("N"))
[IO.Directory]::CreateDirectory($buildDirectory) | Out-Null

function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha = New-Object Security.Cryptography.SHA256Managed
    try {
      return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Get-Sha256Bytes([byte[]]$Bytes) {
  $sha = New-Object Security.Cryptography.SHA256Managed
  try {
    return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Get-CanonicalSourceBytes([byte[]]$Bytes) {
  $utf8 = New-Object Text.UTF8Encoding($false, $true)
  $sourceText = $utf8.GetString($Bytes).Replace("`r`n", "`n")
  return $utf8.GetBytes($sourceText)
}

function Test-BytesEqual([byte[]]$Left, [byte[]]$Right) {
  if ($Left.Length -ne $Right.Length) { return $false }
  for ($index = 0; $index -lt $Left.Length; $index++) {
    if ($Left[$index] -ne $Right[$index]) { return $false }
  }
  return $true
}

function Assert-Amd64Pe([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 64 -or $bytes[0] -ne 0x4d -or $bytes[1] -ne 0x5a) {
    throw "Job helper is not a PE executable."
  }
  $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
  if ($peOffset -lt 0 -or $peOffset + 6 -gt $bytes.Length) {
    throw "Job helper has an invalid PE header."
  }
  $signature = [BitConverter]::ToUInt32($bytes, $peOffset)
  $machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
  if ($signature -ne 0x00004550 -or $machine -ne 0x8664) {
    throw ("Job helper PE architecture is not AMD64 (machine=0x{0:x4})." -f $machine)
  }
}

try {
  $tempExe = Join-Path $buildDirectory "data-editor-job-helper.exe"
  $compilerOptions = "/platform:x64 /optimize+"
  if ($TestFaults) { $compilerOptions += " /define:TEST_FAULTS" }
  $compilerParameters = New-Object System.CodeDom.Compiler.CompilerParameters
  $compilerParameters.CompilerOptions = $compilerOptions
  $compilerParameters.GenerateExecutable = $true
  $compilerParameters.GenerateInMemory = $false
  $compilerParameters.OutputAssembly = $tempExe
  [void]$compilerParameters.ReferencedAssemblies.Add("System.dll")
  [void]$compilerParameters.ReferencedAssemblies.Add("System.Core.dll")
  [void]$compilerParameters.ReferencedAssemblies.Add("System.Web.Extensions.dll")
  $sourceBytes = [IO.File]::ReadAllBytes($sourcePath)
  $utf8 = New-Object Text.UTF8Encoding($false, $true)
  $sourceText = $utf8.GetString($sourceBytes)
  Add-Type -TypeDefinition $sourceText -CompilerParameters $compilerParameters

  Assert-Amd64Pe $tempExe
  $selfCheck = & $tempExe "--protocol-version=2"
  if ($LASTEXITCODE -ne 0 -or ($selfCheck | Out-String).Trim() -ne "2") {
    throw "Job helper protocol self-check failed."
  }

  if ($TestPauseBeforePublishPath) {
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($TestPauseBeforePublishPath), "ready")
    $continuePath = [IO.Path]::GetFullPath($TestContinuePublishPath)
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while (-not [IO.File]::Exists($continuePath)) {
      if ([DateTime]::UtcNow -ge $deadline) { throw "Timed out waiting for build test continuation." }
      Start-Sleep -Milliseconds 20
    }
  }
  $sourceBytesBeforePublish = [IO.File]::ReadAllBytes($sourcePath)
  if (-not (Test-BytesEqual $sourceBytes $sourceBytesBeforePublish)) {
    throw "Job helper source changed during build; refusing to publish."
  }

  $manifest = [ordered]@{
    protocolVersion = 2
    platform = "win32"
    arch = "x64"
    sourceSha256 = Get-Sha256Bytes (Get-CanonicalSourceBytes $sourceBytes)
    executableSha256 = Get-Sha256 $tempExe
    testFaults = [bool]$TestFaults
  }
  $tempManifest = Join-Path $buildDirectory "job-helper.manifest.json"
  $manifest | ConvertTo-Json | Set-Content -LiteralPath $tempManifest -Encoding UTF8

  [IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null
  $finalExe = Join-Path $resolvedOutput "data-editor-job-helper.exe"
  $finalManifest = Join-Path $resolvedOutput "job-helper.manifest.json"
  $backupExe = Join-Path $buildDirectory "previous.exe"
  $backupManifest = Join-Path $buildDirectory "previous.manifest.json"
  if (Test-Path -LiteralPath $finalExe) { Copy-Item -LiteralPath $finalExe -Destination $backupExe }
  if (Test-Path -LiteralPath $finalManifest) { Copy-Item -LiteralPath $finalManifest -Destination $backupManifest }
  try {
    Move-Item -LiteralPath $tempExe -Destination $finalExe -Force
    Move-Item -LiteralPath $tempManifest -Destination $finalManifest -Force
  } catch {
    if (Test-Path -LiteralPath $backupExe) { Copy-Item -LiteralPath $backupExe -Destination $finalExe -Force }
    elseif (Test-Path -LiteralPath $finalExe) { Remove-Item -LiteralPath $finalExe -Force }
    if (Test-Path -LiteralPath $backupManifest) { Copy-Item -LiteralPath $backupManifest -Destination $finalManifest -Force }
    elseif (Test-Path -LiteralPath $finalManifest) { Remove-Item -LiteralPath $finalManifest -Force }
    throw
  }
  Write-Host "Built $finalExe"
  Write-Host "Manifest $finalManifest"
} finally {
  $resolvedBuild = [IO.Path]::GetFullPath($buildDirectory)
  if ($resolvedBuild.StartsWith($outputParent, [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedBuild).StartsWith(".job-helper-build-")) {
    Remove-Item -LiteralPath $resolvedBuild -Recurse -Force -ErrorAction SilentlyContinue
  }
}
