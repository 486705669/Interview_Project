param(
  [string]$TokenFile = (Join-Path $PSScriptRoot "cloudflared-token.txt"),
  [string]$CloudflaredExe = "cloudflared.exe"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $TokenFile)) {
  throw "Token file not found: $TokenFile"
}

$token = (Get-Content $TokenFile -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($token)) {
  throw "Token file is empty."
}

& $CloudflaredExe tunnel --no-autoupdate run --token $token

