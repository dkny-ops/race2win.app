$ErrorActionPreference = 'Stop'
$taskRepo = 'C:\Users\crist\Documents\Codex\race2win-readiness-20261010'
Set-Location -LiteralPath $taskRepo
git rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0) { throw 'Git unavailable.' }
git branch --show-current
git rev-parse HEAD
git status --short
$taskListeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq 3000)
if ($taskListeners.Count -eq 0) { Write-Output 'Port 3000 free; no server running.'; return }
foreach ($taskListener in $taskListeners) {
  $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($taskListener.OwningProcess)" -ErrorAction Stop
  $taskOwned = $taskProcess.CommandLine -and $taskProcess.CommandLine.IndexOf($taskRepo+'\',[StringComparison]::OrdinalIgnoreCase) -ge 0
  [pscustomobject]@{Port=3000;PID=$taskProcess.ProcessId;ParentPID=$taskProcess.ParentProcessId;Name=$taskProcess.Name;OfficialFolder=[bool]$taskOwned}
  if (-not $taskOwned) { Write-Output 'Origin not confirmed. Inspect parent process before stopping; no process was closed.' }
}
