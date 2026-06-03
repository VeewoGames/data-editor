param(
  [string]$ProjectRoot = "",
  [string]$PluginName = "data-editor",
  [string]$PluginInstallRoot = "",
  [string]$MarketplacePath = "",
  [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"

function Resolve-DefaultProjectRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
}

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

if (-not $ProjectRoot) {
  $ProjectRoot = Resolve-DefaultProjectRoot
} else {
  $ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
}

$homeDir = [Environment]::GetFolderPath("UserProfile")
if (-not $PluginInstallRoot) {
  $PluginInstallRoot = Join-Path $homeDir "plugins"
}
if (-not $MarketplacePath) {
  $MarketplacePath = Join-Path $homeDir ".agents\plugins\marketplace.json"
}
if (-not $ConfigPath) {
  $ConfigPath = Join-Path $homeDir ".codex\data-editor-plugin-config.json"
}

$templateRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\codex-plugin")).Path
$destinationRoot = Join-Path $PluginInstallRoot $PluginName

Ensure-Directory $PluginInstallRoot
if (Test-Path -LiteralPath $destinationRoot) {
  Remove-Item -LiteralPath $destinationRoot -Recurse -Force
}
Copy-Item -LiteralPath $templateRoot -Destination $destinationRoot -Recurse -Force

Ensure-Directory (Split-Path -Parent $ConfigPath)
$config = @{
  projectRoot = $ProjectRoot
} | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($ConfigPath, $config, (New-Object System.Text.UTF8Encoding($false)))

Ensure-Directory (Split-Path -Parent $MarketplacePath)
if (Test-Path -LiteralPath $MarketplacePath) {
  $marketplace = Get-Content -LiteralPath $MarketplacePath -Raw | ConvertFrom-Json
} else {
  $marketplace = [pscustomobject]@{
    name = "personal"
    interface = [pscustomobject]@{
      displayName = "Personal"
    }
    plugins = @()
  }
}

$pluginEntry = [pscustomobject]@{
  name = $PluginName
  source = [pscustomobject]@{
    source = "local"
    path = "./plugins/$PluginName"
  }
  policy = [pscustomobject]@{
    installation = "AVAILABLE"
    authentication = "ON_INSTALL"
  }
  category = "Productivity"
}

$existing = @($marketplace.plugins | Where-Object { $_.name -ne $PluginName })
$marketplace.plugins = @($existing + $pluginEntry)

$marketplaceJson = $marketplace | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($MarketplacePath, $marketplaceJson, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Installed plugin template to: $destinationRoot"
Write-Host "Updated marketplace: $MarketplacePath"
Write-Host "Wrote config: $ConfigPath"
Write-Host "Configured project root: $ProjectRoot"
