param(
  [string]$NodeExe = "C:\Program Files\nodejs\node.exe",
  [string]$PowerShellExe = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
  [string]$CloudflaredExe = "C:\Program Files\cloudflared\cloudflared.exe",
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$scriptRoot = $PSScriptRoot
$backendScript = Join-Path $scriptRoot "run-backend.ps1"
$cloudflaredScript = Join-Path $scriptRoot "run-cloudflared.ps1"

if (-not (Test-Path $NodeExe)) {
  throw "Node executable not found: $NodeExe"
}

if (-not (Test-Path $CloudflaredExe)) {
  throw "cloudflared executable not found: $CloudflaredExe"
}

$backendAction = New-ScheduledTaskAction `
  -Execute $PowerShellExe `
  -Argument "-ExecutionPolicy Bypass -File `"$backendScript`" -Port $Port"

$cloudflaredAction = New-ScheduledTaskAction `
  -Execute $PowerShellExe `
  -Argument "-ExecutionPolicy Bypass -File `"$cloudflaredScript`" -CloudflaredExe `"$CloudflaredExe`""

$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest

Register-ScheduledTask `
  -TaskName "ElderlyCompanionBackend" `
  -Action $backendAction `
  -Trigger $trigger `
  -Principal $principal `
  -Force | Out-Null

Register-ScheduledTask `
  -TaskName "ElderlyCompanionCloudflared" `
  -Action $cloudflaredAction `
  -Trigger $trigger `
  -Principal $principal `
  -Force | Out-Null

Write-Host "Scheduled tasks registered:"
Write-Host "- ElderlyCompanionBackend"
Write-Host "- ElderlyCompanionCloudflared"

