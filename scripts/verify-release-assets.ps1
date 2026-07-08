param(
  [string]$ZipPath = "",
  [string]$ShaPath = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ZipPath)) {
  $ZipPath = Join-Path $root "release\extension-release.zip"
}
if ([string]::IsNullOrWhiteSpace($ShaPath)) {
  $ShaPath = Join-Path $root "release\extension-release.zip.sha256"
}

if (-not (Test-Path -LiteralPath $ShaPath)) {
  throw "Release checksum file not found: $ShaPath"
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

Write-Host "Release assets verified:"
Write-Host $ZipPath
Write-Host $ShaPath
