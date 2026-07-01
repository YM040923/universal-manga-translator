$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
Write-Host "Starting Universal Manga Translator backend at http://127.0.0.1:47831 ..."
pnpm --filter @umt/server dev