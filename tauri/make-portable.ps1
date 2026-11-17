# Assemble one portable build from cargo's release output.
# Usage:
#   powershell -File make-portable.ps1                                              # Standard edition
#   powershell -File make-portable.ps1 -Edition Full -Resource ecdict.jsonl.gz,popup-icon.png
param(
  [string]$Version = "0.1.0",
  [string]$Edition = "Standard",
  [string[]]$Resource = @("dictionary.zip", "popup-icon.png")
)
$ErrorActionPreference = "Stop"
$rel  = Join-Path $PSScriptRoot "src-tauri\target\release"
$out  = Join-Path $PSScriptRoot "release"
$stage = Join-Path $out "ED-$Edition-Portable-$Version"

New-Item -ItemType Directory -Force $out | Out-Null
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null

# cargo builds lowercase; present the portable binary as ED.exe
$exeSrc = Get-ChildItem $rel -Filter "ed.exe" | Select-Object -First 1
Copy-Item $exeSrc.FullName (Join-Path $stage "ED.exe")

# Copy exactly the resources that belong to this build (not whatever happens to
# be left in target/release/resources from an earlier configuration).
$resDir = Join-Path $stage "resources"
New-Item -ItemType Directory -Force $resDir | Out-Null
foreach ($name in $Resource) {
  $src = Join-Path $PSScriptRoot "src-tauri\resources\$name"
  if (-not (Test-Path $src)) { throw "resource missing: $src" }
  Copy-Item $src $resDir
}

$zip = Join-Path $out "ED-$Edition-$Version-Portable.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip
Write-Host "portable zip: $zip"
Get-ChildItem $out | Format-Table Name, Length