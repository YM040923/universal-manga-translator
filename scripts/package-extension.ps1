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
$shaPath = Join-Path $releaseDir "extension-release.zip.sha256"
if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
if (Test-Path $shaPath) {
  Remove-Item -LiteralPath $shaPath -Force
}

Write-Host "Packaging extension to $zipPath ..."
$items = Get-ChildItem -LiteralPath $dist -Force
Compress-Archive -Path $items.FullName -DestinationPath $zipPath -Force

if (-not (Test-Path $zipPath)) {
  throw "Failed to create extension zip: $zipPath"
}

& (Join-Path $PSScriptRoot "verify-extension-package.ps1") -ZipPath $zipPath
& (Join-Path $PSScriptRoot "write-extension-checksum.ps1") -ZipPath $zipPath -ShaPath $shaPath
& (Join-Path $PSScriptRoot "write-release-build-info.ps1") -ZipPath $zipPath -ShaPath $shaPath -OutPath (Join-Path $releaseDir "build-info.json")
& (Join-Path $PSScriptRoot "verify-release-assets.ps1") -ZipPath $zipPath -ShaPath $shaPath

Write-Host "Extension release package created:"
Write-Host $zipPath
Write-Host $shaPath
Write-Host (Join-Path $releaseDir "build-info.json")
