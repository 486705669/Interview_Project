param(
  [string]$PowerShellExe = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
  [string]$CaddyExe = "C:\Program Files\Caddy\caddy.exe"
)

$ErrorActionPreference = "Stop"
$scriptRoot = $PSScriptRoot
$caddyScript = Join-Path $scriptRoot "run-caddy.ps1"

if (-not (Test-Path $CaddyExe)) {
  throw "Caddy executable not found: $CaddyExe"
}

$caddyAction = New-ScheduledTaskAction `
  -Execute $PowerShellExe `
  -Argument "-ExecutionPolicy Bypass -File `"$caddyScript`" -CaddyExe `"$CaddyExe`""

$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest

Register-ScheduledTask `
  -TaskName "ElderlyCompanionCaddy" `
  -Action $caddyAction `
  -Trigger $trigger `
  -Principal $principal `
  -Force | Out-Null

Write-Host "Scheduled task registered: ElderlyCompanionCaddy"

