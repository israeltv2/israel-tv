# Run Israel TV in the background on Windows, at logon (Task Scheduler; no extra software). From the repo folder,
# in PowerShell:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install-task.ps1            # a full instance
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install-task.ps1 -Resolver  # the resolver on its own
# Remove it:   powershell -ExecutionPolicy Bypass -File deploy\windows\install-task.ps1 -Remove [-Resolver]
# Restart it (after an update or a settings change):  ... install-task.ps1 -Restart [-Resolver]   (-Stop to stop it)
# Logs: the config folder's data\logs (the newest israel-tv.*.log); start-up problems: task-output.txt there too.
# The config and .env live in the config folder (`pnpm israel-tv paths` shows it). The task runs while you are
# logged in; Windows asks once whether node may accept connections on private networks: allow it.
param([switch]$Resolver, [switch]$Remove, [switch]$Stop, [switch]$Restart)
$ErrorActionPreference = 'Stop'
$name = if ($Resolver) { 'Israel TV resolver' } else { 'Israel TV' }
$marker = if ($Resolver) { 'israel-tv-task-resolver' } else { 'israel-tv-task-full' }
$cliName = if ($Resolver) { 'apps\resolver\src\cli.ts' } else { 'apps\ingest\src\cli.ts' }

# Windows does not stop a task's child processes with it: stop the task, then the loop and node it started (found by
# their command lines).
function Stop-IsraelTv {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -and ($_.CommandLine.Contains($marker) -or ($_.Name -eq 'node.exe' -and $_.CommandLine.Contains($cliName))) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Stop -or $Restart) {
  # Windows cannot ask node to stop gently, so first wait (up to 5 minutes) until no run is in progress: nothing is
  # cut short. (`idle` exits 3 when the wait runs out; the service is stopped anyway.)
  if (-not $Resolver) {
    Push-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    try { & node 'apps\ingest\src\cli.ts' idle --wait 300 | Out-Host } finally { Pop-Location }
  }
  Stop-IsraelTv
  if ($Restart) { Start-Sleep -Seconds 2; Start-ScheduledTask -TaskName $name; Write-Host "Restarted '$name'." }
  else { Write-Host "Stopped '$name'." }
  exit 0
}
if ($Remove) {
  Stop-IsraelTv
  Unregister-ScheduledTask -TaskName $name -Confirm:$false
  Write-Host "Removed the task '$name'."
  exit 0
}
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$cli = if ($Resolver) { 'apps\resolver\src\cli.ts' } else { 'apps\ingest\src\cli.ts' }
# No window (conhost --headless), and a loop that starts it again 30 seconds after it stops for any reason
# (Task Scheduler's own restart only covers a task that fails to launch). Logs go to the config folder's data\logs.
# What the app prints before its log starts (a settings error, a taken port) goes to task-output.txt in the config folder.
$out = Join-Path $env:LOCALAPPDATA "israel-tv\task-output$(if ($Resolver) { '-resolver' }).txt"
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$loop = "`$task = '$marker'; while (`$true) { & '$($node.Replace("'","''"))' '$cli' start *>> '$($out.Replace("'","''"))'; Start-Sleep -Seconds 30 }"
$action = New-ScheduledTaskAction -Execute 'conhost.exe' `
  -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -Command `"$loop`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Never stopped for running long; runs on battery too.
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Stop-IsraelTv  # a copy installed before
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Host "Installed and started '$name' (no window). It starts again each time you sign in, and after a stop."
Write-Host "Stop any copy you started by hand first (Ctrl-C in its window), or the port is taken."
Write-Host "Your links: run  pnpm israel-tv urls  (or  pnpm resolver urls )."
