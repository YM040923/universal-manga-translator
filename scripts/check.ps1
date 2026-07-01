$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
pnpm doctor
pnpm test
pnpm build
Write-Host "UMT check complete."