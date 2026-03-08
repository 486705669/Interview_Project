param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envFile = Join-Path $PSScriptRoot "backend.env"
$env:PORT = "$Port"

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    $pair = $line -split "=", 2
    if ($pair.Length -ne 2) {
      return
    }

    $name = $pair[0].Trim()
    $value = $pair[1].Trim()
    if ($value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    Set-Item -Path "Env:$name" -Value $value
  }
}

Push-Location (Join-Path $repoRoot "backend")
try {
  node .\dist\index.js
} finally {
  Pop-Location
}
