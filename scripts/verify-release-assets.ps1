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

$checksumParts = $line -split "\s+"
$expected = $checksumParts[0].ToLowerInvariant()
if ($expected -notmatch "^[0-9a-f]{64}$") {
  throw "Release checksum file does not start with a SHA256 hash: $ShaPath"
}

$expectedChecksumFileName = Split-Path -Leaf $ZipPath
if ($checksumParts.Count -lt 2 -or [string]::IsNullOrWhiteSpace($checksumParts[1])) {
  throw "Release checksum file must include the zip filename: $ShaPath"
}
$actualChecksumFileName = Split-Path -Leaf ([string]$checksumParts[1])
if ($actualChecksumFileName -ne $expectedChecksumFileName) {
  throw "Release checksum filename mismatch: expected $expectedChecksumFileName, got $actualChecksumFileName"
}

$actual = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) {
  throw "Release checksum mismatch: expected $expected, got $actual"
}

try {
  $buildInfo = Get-Content -LiteralPath $BuildInfoPath -Raw | ConvertFrom-Json
}
catch {
  throw "Release build metadata is not valid JSON: $BuildInfoPath"
}

function Assert-BuildInfoField {
  param(
    [object]$Info,
    [string]$Name
  )
  $property = $Info.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
    throw "Release build metadata missing required field: $Name"
  }
}

foreach ($field in @("product", "packageVersion", "extensionVersion", "commit", "zipFile", "sha256", "builtAtUtc")) {
  Assert-BuildInfoField -Info $buildInfo -Name $field
}
if ($null -eq $buildInfo.PSObject.Properties["dirty"]) {
  throw "Release build metadata missing required field: dirty"
}

if ($buildInfo.product -ne "Universal Manga Translator") {
  throw "Release build metadata product mismatch: $($buildInfo.product)"
}

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

# The version recorded in the zip's own manifest must match the build metadata,
# otherwise a stale build could be shipped while the source tree has moved on.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  $manifestEntry = $zip.Entries | Where-Object { $_.FullName -eq "manifest.json" } | Select-Object -First 1
  if ($null -eq $manifestEntry) {
    throw "Release zip is missing manifest.json"
  }
  $manifestReader = New-Object System.IO.StreamReader($manifestEntry.Open())
  try {
    $zipManifest = $manifestReader.ReadToEnd() | ConvertFrom-Json
  }
  finally {
    $manifestReader.Dispose()
  }
}
finally {
  $zip.Dispose()
}
$zipManifestVersion = [string]$zipManifest.version
if ($zipManifestVersion -ne $buildInfo.extensionVersion) {
  throw "Release zip manifest version mismatch: expected $($buildInfo.extensionVersion), got $zipManifestVersion"
}

# PowerShell 7's ConvertFrom-Json parses ISO date strings into DateTime, so
# stringify dates back to their UTC ISO form before validating the format.
$builtAtRaw = $buildInfo.builtAtUtc
if ($builtAtRaw -is [datetime] -or $builtAtRaw -is [datetimeoffset]) {
  $builtAtUtc = ([datetimeoffset]$builtAtRaw).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
}
else {
  $builtAtUtc = [string]$builtAtRaw
}
if ($builtAtUtc -notmatch "^\d{4}-\d{2}-\d{2}T.*Z$") {
  throw "Release build metadata builtAtUtc must be an ISO UTC timestamp: $builtAtUtc"
}
try {
  [void][DateTimeOffset]::Parse($builtAtUtc, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal)
}
catch {
  throw "Release build metadata builtAtUtc must be an ISO UTC timestamp: $builtAtUtc"
}

Write-Host "Release assets verified:"
Write-Host $ZipPath
Write-Host $ShaPath
Write-Host $BuildInfoPath
