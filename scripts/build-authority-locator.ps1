$ErrorActionPreference = 'Stop'
$toolRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$source = Join-Path $toolRoot 'native/authority-locator/AuthorityLocator.cs'
$output = Join-Path $toolRoot 'native/authority-locator/bin/win32-x64'
[IO.Directory]::CreateDirectory($output) | Out-Null
$temporary = Join-Path $output ('.build-' + [Guid]::NewGuid().ToString('N') + '.exe')
try {
    $parameters = New-Object System.CodeDom.Compiler.CompilerParameters
    $parameters.CompilerOptions = '/platform:x64 /optimize+'
    $parameters.GenerateExecutable = $true
    $parameters.OutputAssembly = $temporary
    [void]$parameters.ReferencedAssemblies.Add('System.dll')
    $bytes = [IO.File]::ReadAllBytes($source)
    Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString($bytes)) -CompilerParameters $parameters
    $probe = & $temporary '--user-profile'
    if($LASTEXITCODE -ne 0 -or -not [IO.Path]::IsPathRooted($probe)) {throw 'AUTHORITY_LOCATOR_SELF_CHECK_FAILED'}
    if(-not [Linq.Enumerable]::SequenceEqual([byte[]]$bytes,[byte[]][IO.File]::ReadAllBytes($source))) {throw 'AUTHORITY_LOCATOR_SOURCE_CHANGED'}
    $final = Join-Path $output 'data-editor-authority-locator.exe'
    Move-Item -LiteralPath $temporary -Destination $final -Force
    $normalized = [Text.Encoding]::UTF8.GetBytes(([Text.Encoding]::UTF8.GetString($bytes)).Replace("`r`n","`n"))
    $sha = [Security.Cryptography.SHA256]::Create()
    try {$sourceDigest=([BitConverter]::ToString($sha.ComputeHash($normalized))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
    [ordered]@{version=1;platform='win32';arch='x64';sourceSha256=$sourceDigest;executableSha256=(Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'authority-locator.manifest.json') -Encoding utf8
    Write-Output "Built $final"
} finally {if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}}
