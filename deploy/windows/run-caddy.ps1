param(
  [string]$CaddyExe = "C:\Program Files\Caddy\caddy.exe",
  [string]$ConfigFile = (Join-Path $PSScriptRoot "Caddyfile")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $CaddyExe)) {
  throw "Caddy executable not found: $CaddyExe"
}

if (-not (Test-Path $ConfigFile)) {
  throw "Caddy config not found: $ConfigFile"
}

& $CaddyExe run --config $ConfigFile

