$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$BackendUrl = $env:UMT_BACKEND_URL
if ([string]::IsNullOrWhiteSpace($BackendUrl)) {
  $BackendUrl = "http://127.0.0.1:47831"
}
$HealthUrl = "$BackendUrl/health"

try {
  $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
  if ($Health.ok) {
    Write-Host "Universal Manga Translator backend is already running at $BackendUrl"
    Write-Host "Provider: $($Health.provider), target language: $($Health.targetLanguage)"
    exit 0
  }
} catch {
  # Backend is not healthy/reachable; start it below.
}

Write-Host "Starting Universal Manga Translator backend at $BackendUrl ..."
pnpm --filter @umt/server dev