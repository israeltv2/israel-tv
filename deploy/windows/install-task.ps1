# Run Israel TV in the background on Windows, at logon (Task Scheduler; no extra software). From the repo folder,
# in PowerShell:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install-task.ps1            # a full instance
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install-task.ps1 -Resolver  # the resolver on its own
# Remove it:   powershell -ExecutionPolicy Bypass -File deploy\windows\install-task.ps1 -Remove [-Resolver]
# Restart it (after an update or a config change):  schtasks /End /TN <name>  then  schtasks /Run /TN <name>
# The config and .env live in the config folder (`pnpm israel-tv paths` shows it). The task runs while you are
# logged in; Windows asks once whether node may accept connections on private networks: allow it.
param([switch]$Resolver, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$name = if ($Resolver) { 'Israel TV resolver' } else { 'Israel TV' }
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false
  Write-Host "Removed the task '$name'."
  exit 0
}
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$cli = if ($Resolver) { 'apps\resolver\src\cli.ts' } else { 'apps\ingest\src\cli.ts' }
$action = New-ScheduledTaskAction -Execute $node -Argument "$cli start" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Restarted after a crash; never stopped for running long; runs on battery too.
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Host "Installed and started '$name'. It starts again each time you log in."
Write-Host "Your links: run  pnpm israel-tv urls  (or  pnpm resolver urls )."
