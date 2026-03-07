$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Write-Host "Repository root: $repoRoot"

Push-Location (Join-Path $repoRoot "frontend")
try {
  npm ci
  npm run build
} finally {
  Pop-Location
}

Push-Location (Join-Path $repoRoot "backend")
try {
  npm ci
  npm run build
} finally {
  Pop-Location
}

Write-Host "Frontend and backend build completed."

