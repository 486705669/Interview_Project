param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$env:PORT = "$Port"

Push-Location (Join-Path $repoRoot "backend")
try {
  node .\dist\index.js
} finally {
  Pop-Location
}

