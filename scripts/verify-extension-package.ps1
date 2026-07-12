param(
  [string]$ZipPath = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ZipPath)) {
  $ZipPath = Join-Path $root "release\extension-release.zip"
}
elseif (-not [System.IO.Path]::IsPathRooted($ZipPath)) {
  $ZipPath = Join-Path $root $ZipPath
}

if (-not (Test-Path -LiteralPath $ZipPath)) {
  throw "Extension package not found: $ZipPath"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

$requiredRootEntries = @(
  "manifest.json",
  "popup.html",
  "popup.js",
  "content.js",
  "background.js"
)

$forbiddenPatterns = @(
  "(^|/)\.env($|[./])",
  "(^|/)node_modules/",
  "^(apps|packages|scripts|docs|release|server-runtime)/",
  "(^|/)src/",
  "(^|/)data/",
  "(^|/)logs?/",
  "\.log$",
  "\.ts$",
  "\.tsx$",
  "\.map$",
  "package-lock\.json$",
  "pnpm-lock\.yaml$"
)

$textEntryPatterns = @(
  "\.html$",
  "\.js$",
  "\.json$",
  "\.css$"
)

$forbiddenContentPatterns = @(
  "sk-[A-Za-z0-9_-]{24,}",
  "uapis\.cn",
  "baidu",
  "cf\.ai-pixel\.online",
  "OPENAI_API_KEY\s*=",
  "OCR_API_KEY\s*="
)

$zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  $entries = @($zip.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })

  foreach ($required in $requiredRootEntries) {
    if (-not ($entries -contains $required)) {
      throw "Extension package is invalid: missing root entry $required"
    }
  }

  $nestedManifest = $entries | Where-Object { $_ -match "/manifest\.json$" } | Select-Object -First 1
  if ($nestedManifest) {
    throw "Extension package is invalid: manifest.json is nested under $nestedManifest"
  }

  $manifestEntry = $zip.Entries | Where-Object { $_.FullName -eq "manifest.json" } | Select-Object -First 1
  $manifestReader = New-Object System.IO.StreamReader($manifestEntry.Open())
  try {
    $manifest = $manifestReader.ReadToEnd() | ConvertFrom-Json
  }
  finally {
    $manifestReader.Dispose()
  }

  if ($manifest.options_page -or $manifest.options_ui) {
    throw "Extension package is invalid: options pages are disabled; use the popup API settings page"
  }

  if ($manifest.content_scripts) {
    throw "Extension package is invalid: content_scripts must not be statically declared; use site activation and dynamic injection"
  }

  $manifestAssets = New-Object System.Collections.Generic.List[string]
  if ($manifest.action.default_popup) {
    $manifestAssets.Add([string]$manifest.action.default_popup)
  }
  if ($manifest.background.service_worker) {
    $manifestAssets.Add([string]$manifest.background.service_worker)
  }

  foreach ($iconSet in @($manifest.icons, $manifest.action.default_icon)) {
    if (-not $iconSet) {
      continue
    }
    foreach ($property in $iconSet.PSObject.Properties) {
      if ($property.Value) {
        $manifestAssets.Add([string]$property.Value)
      }
    }
  }

  foreach ($asset in ($manifestAssets | Select-Object -Unique)) {
    $normalizedAsset = $asset.Replace("\", "/")
    if (-not ($entries -contains $normalizedAsset)) {
      throw "Extension package is invalid: missing manifest referenced asset $normalizedAsset"
    }
  }

  $forbidden = New-Object System.Collections.Generic.List[string]
  foreach ($entry in $entries) {
    foreach ($pattern in $forbiddenPatterns) {
      if ($entry -match $pattern) {
        $forbidden.Add($entry)
        break
      }
    }
  }

  if ($forbidden.Count -gt 0) {
    $sample = ($forbidden | Select-Object -First 10) -join ", "
    throw "Extension package contains forbidden release entries: $sample"
  }

  $contentHits = New-Object System.Collections.Generic.List[string]
  foreach ($entry in $zip.Entries) {
    $entryName = $entry.FullName.Replace("\", "/")
    $isTextEntry = $false
    foreach ($pattern in $textEntryPatterns) {
      if ($entryName -match $pattern) {
        $isTextEntry = $true
        break
      }
    }
    if (-not $isTextEntry) {
      continue
    }

    $reader = New-Object System.IO.StreamReader($entry.Open())
    try {
      $content = $reader.ReadToEnd()
    }
    finally {
      $reader.Dispose()
    }

    foreach ($pattern in $forbiddenContentPatterns) {
      if ($content -match $pattern) {
        $contentHits.Add($entryName)
        break
      }
    }
  }

  if ($contentHits.Count -gt 0) {
    $sample = ($contentHits | Select-Object -First 10) -join ", "
    throw "Extension package contains forbidden packaged content: $sample"
  }
}
finally {
  $zip.Dispose()
}

Write-Host "Extension package verified:"
Write-Host $ZipPath
