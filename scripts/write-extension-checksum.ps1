param(
  [string]$ZipPath,
  [string]$ShaPath = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ZipPath)) {
  throw "ZipPath is required"
}

if (-not (Test-Path -LiteralPath $ZipPath)) {
  throw "Extension zip not found: $ZipPath"
}

if ([string]::IsNullOrWhiteSpace($ShaPath)) {
  $ShaPath = "$ZipPath.sha256"
}

$hash = Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256
$fileName = Split-Path -Leaf $ZipPath
"$($hash.Hash.ToLowerInvariant())  $fileName" | Set-Content -LiteralPath $ShaPath -Encoding ascii

Write-Host "Extension checksum created:"
Write-Host $ShaPath
