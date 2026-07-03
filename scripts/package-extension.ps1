$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "Building Universal Manga Translator extension..."
pnpm --filter "@umt/extension" build

$dist = Join-Path $root "apps\extension\dist"
if (-not (Test-Path (Join-Path $dist "manifest.json"))) {
  throw "Extension dist manifest not found: $dist"
}

$releaseDir = Join-Path $root "release"
New-Item -ItemType Directory -Force $releaseDir | Out-Null

$zipPath = Join-Path $releaseDir "extension-release.zip"
if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Write-Host "Packaging extension to $zipPath ..."
$items = Get-ChildItem -LiteralPath $dist -Force
Compress-Archive -Path $items.FullName -DestinationPath $zipPath -Force

if (-not (Test-Path $zipPath)) {
  throw "Failed to create extension zip: $zipPath"
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $manifestEntry = $zip.Entries | Where-Object { $_.FullName -eq "manifest.json" } | Select-Object -First 1
  if (-not $manifestEntry) {
    throw "Extension zip is invalid: manifest.json is not at the archive root"
  }
}
finally {
  $zip.Dispose()
}

Write-Host "Extension release package created:"
Write-Host $zipPath
