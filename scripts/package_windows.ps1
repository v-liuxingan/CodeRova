param([Parameter(Mandatory)][ValidatePattern('^v?\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$')][string]$Version,
      [string]$Binary = 'target/release/coderova.exe')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$name = "coderova-$Version-windows-x64"
$out = Join-Path $root 'target/packages'
$stage = Join-Path $out ($name + '-' + [Guid]::NewGuid().ToString('N'))
$package = Join-Path $stage $name
New-Item -ItemType Directory -Force $package | Out-Null
if (!(Test-Path -LiteralPath $Binary)) { throw "Missing binary: $Binary" }
Copy-Item -LiteralPath $Binary -Destination (Join-Path $package 'coderova.exe')
Copy-Item -LiteralPath (Join-Path $root 'public') -Destination $package -Recurse
Get-ChildItem (Join-Path $root 'packaging/windows') -File | Copy-Item -Destination $package
foreach ($file in @('LICENSE','THIRD_PARTY_NOTICES.md','callgraph.lsp.example.json')) {
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination $package
}
foreach ($dir in @('graphs','layouts','scenarios')) { New-Item -ItemType Directory (Join-Path $package $dir) | Out-Null }
$zip = Join-Path $out ($name + '.zip')
Compress-Archive -LiteralPath $package -DestinationPath $zip -Force
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $name.zip" | Set-Content -LiteralPath ($zip + '.sha256') -Encoding ascii
Write-Output $zip
