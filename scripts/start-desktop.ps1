$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
Write-Host "Starting Universal Manga Translator desktop app ..."
pnpm desktop
