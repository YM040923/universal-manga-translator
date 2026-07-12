param(
  [string]$ZipPath = "",
  [string]$ShaPath = "",
  [string]$OutPath = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ZipPath)) {
  $ZipPath = Join-Path $root "release\extension-release.zip"
}
if ([string]::IsNullOrWhiteSpace($ShaPath)) {
  $ShaPath = Join-Path $root "release\extension-release.zip.sha256"
}
if ([string]::IsNullOrWhiteSpace($OutPath)) {
  $OutPath = Join-Path $root "release\build-info.json"
}

if (-not (Test-Path -LiteralPath $ZipPath)) {
  throw "Extension zip not found: $ZipPath"
}
if (-not (Test-Path -LiteralPath $ShaPath)) {
  throw "Extension checksum not found: $ShaPath"
}

$package = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$manifest = Get-Content -LiteralPath (Join-Path $root "apps\extension\public\manifest.json") -Raw | ConvertFrom-Json
$sha256 = ((Get-Content -LiteralPath $ShaPath -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
$commit = "unknown"
$dirty = $false

if (Get-Command git -ErrorAction SilentlyContinue) {
  $nativePreferenceWasSet = Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue
  $previousNativePreference = if ($nativePreferenceWasSet) { $PSNativeCommandUseErrorActionPreference } else { $null }
  if ($nativePreferenceWasSet) {
    $PSNativeCommandUseErrorActionPreference = $false
  }
  try {
    $commitCandidate = (& git -C $root rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($commitCandidate)) {
      $commit = [string]$commitCandidate
    }
    $statusOutput = @(& git -C $root status --porcelain -- . ":(exclude)release" 2>$null)
    $dirty = $statusOutput.Count -gt 0
  }
  finally {
    if ($nativePreferenceWasSet) {
      $PSNativeCommandUseErrorActionPreference = $previousNativePreference
    }
  }
}

$info = [ordered]@{
  product = "Universal Manga Translator"
  packageVersion = [string]$package.version
  extensionVersion = [string]$manifest.version
  commit = $commit
  dirty = [bool]$dirty
  zipFile = Split-Path -Leaf $ZipPath
  sha256 = $sha256
  builtAtUtc = (Get-Date).ToUniversalTime().ToString("o")
}

$json = $info | ConvertTo-Json -Depth 4
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutPath, "$json`n", $utf8NoBom)

Write-Host "Release build info created:"
Write-Host $OutPath
