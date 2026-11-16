# Assemble the portable build from cargo's release output.
# Usage: powershell -File make-portable.ps1 [-Version 0.1.0]
param([string]$Version = "0.1.0")
$ErrorActionPreference = "Stop"
$rel  = Join-Path $PSScriptRoot "src-tauri\target\release"
$out  = Join-Path $PSScriptRoot "release"
$stage = Join-Path $out "CDictionary-Portable-$Version"

New-Item -ItemType Directory -Force $out | Out-Null
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null

# cargo builds lowercase; present the portable binary as CDictionary.exe
$exeSrc = Get-ChildItem $rel -Filter "cdictionary.exe" | Select-Object -First 1
Copy-Item $exeSrc.FullName (Join-Path $stage "CDictionary.exe")
# bundled resources (dictionary.zip, popup-icon.png) live next to the binary after tauri build
if (-not (Test-Path (Join-Path $stage "resources"))) {
  if (Test-Path (Join-Path $rel "resources")) {
    Copy-Item -Recurse (Join-Path $rel "resources") (Join-Path $stage "resources")
  } else {
    New-Item -ItemType Directory -Force (Join-Path $stage "resources") | Out-Null
    Copy-Item (Join-Path $PSScriptRoot "src-tauri\resources\*") (Join-Path $stage "resources")
  }
}

$zip = Join-Path $out "CDictionary-$Version-Portable.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip
Write-Host "portable zip: $zip"
Get-ChildItem $out | Format-Table Name, Length
