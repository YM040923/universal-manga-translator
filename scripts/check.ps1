$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
pnpm doctor
node scripts/scan-secrets.mjs
pnpm test
pnpm build
Write-Host "UMT check complete."