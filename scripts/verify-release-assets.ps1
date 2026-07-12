param(
  [string]$ZipPath = "",
  [string]$ShaPath = "",
  [string]$BuildInfoPath = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ZipPath)) {
  $ZipPath = Join-Path $root "release\extension-release.zip"
}
if ([string]::IsNullOrWhiteSpace($ShaPath)) {
  $ShaPath = Join-Path $root "release\extension-release.zip.sha256"
}
if ([string]::IsNullOrWhiteSpace($BuildInfoPath)) {
  $BuildInfoPath = Join-Path $root "release\build-info.json"
}

if (-not (Test-Path -LiteralPath $ShaPath)) {
  throw "Release checksum file not found: $ShaPath"
}
if (-not (Test-Path -LiteralPath $BuildInfoPath)) {
  throw "Release build metadata file not found: $BuildInfoPath"
}

& (Join-Path $PSScriptRoot "verify-extension-package.ps1") -ZipPath $ZipPath

$line = (Get-Content -LiteralPath $ShaPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($line)) {
  throw "Release checksum file is empty: $ShaPath"
}

$expected = ($line -split "\s+")[0].ToLowerInvariant()
if ($expected -notmatch "^[0-9a-f]{64}$") {
  throw "Release checksum file does not start with a SHA256 hash: $ShaPath"
}

$actual = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) {
  throw "Release checksum mismatch: expected $expected, got $actual"
}

$buildInfo = Get-Content -LiteralPath $BuildInfoPath -Raw | ConvertFrom-Json
$expectedZipFile = Split-Path -Leaf $ZipPath
if ($buildInfo.zipFile -ne $expectedZipFile) {
  throw "Release build metadata zip filename mismatch: expected $expectedZipFile, got $($buildInfo.zipFile)"
}

$buildInfoHash = [string]$buildInfo.sha256
if ($buildInfoHash.ToLowerInvariant() -ne $expected) {
  throw "Release build metadata checksum mismatch: expected $expected, got $buildInfoHash"
}

$packageJson = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$manifestJson = Get-Content -LiteralPath (Join-Path $root "apps\extension\public\manifest.json") -Raw | ConvertFrom-Json
if ($buildInfo.packageVersion -ne $packageJson.version) {
  throw "Release build metadata package version mismatch: expected $($packageJson.version), got $($buildInfo.packageVersion)"
}
if ($buildInfo.extensionVersion -ne $manifestJson.version) {
  throw "Release build metadata extension version mismatch: expected $($manifestJson.version), got $($buildInfo.extensionVersion)"
}

$commit = [string]$buildInfo.commit
if ($commit -notmatch "^([0-9a-f]{40}|unknown)$") {
  throw "Release build metadata commit must be a 40-character lowercase git SHA or unknown: $commit"
}
if ($buildInfo.dirty -isnot [bool]) {
  throw "Release build metadata dirty must be a boolean"
}

Write-Host "Release assets verified:"
Write-Host $ZipPath
Write-Host $ShaPath
Write-Host $BuildInfoPath
