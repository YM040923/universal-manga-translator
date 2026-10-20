param(
  [string]$ZipPath,
  [string]$ShaPath = ""
)

$ErrorActionPreference = "Stop"

# Get-FileHash is unavailable in some automated Windows PowerShell sessions, so hash through .NET.
function Get-UmtFileSha256 {
  param([string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  try {
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
      [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace("-", "").ToLowerInvariant()
    } finally { $hasher.Dispose() }
  } finally { $stream.Dispose() }
}

if ([string]::IsNullOrWhiteSpace($ZipPath)) {
  throw "ZipPath is required"
}

if (-not (Test-Path -LiteralPath $ZipPath)) {
  throw "Extension zip not found: $ZipPath"
}

if ([string]::IsNullOrWhiteSpace($ShaPath)) {
  $ShaPath = "$ZipPath.sha256"
}

$hash = Get-UmtFileSha256 -Path $ZipPath
$fileName = Split-Path -Leaf $ZipPath
"$hash  $fileName" | Set-Content -LiteralPath $ShaPath -Encoding ascii

Write-Host "Extension checksum created:"
Write-Host $ShaPath
