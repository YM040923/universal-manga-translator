$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
pnpm --filter @umt/extension build
$ExtensionPath = Join-Path $Root "apps\extension\dist"
Write-Host "Unpacked extension path: $ExtensionPath"