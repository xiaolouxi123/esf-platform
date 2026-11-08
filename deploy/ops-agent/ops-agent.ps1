# ESF game-server ops agent (pull mode).
#
# Why pull: inbound WinRM (5985) on the game server is blocked by the cloud
# security group, so the platform cannot push commands. Instead this agent
# polls the platform every minute, claims one queued job, runs it, and posts
# the exit code and output back.
#
# Installed by install-ops-agent.ps1 as scheduled task ESFOpsAgent (SYSTEM,
# every 1 minute). Keep this file ASCII-only: Windows PowerShell 5.1 reads
# UTF-8 scripts as ANSI and would corrupt any non-ASCII string literal.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AgentDir = 'C:\esf-agent'
$KeyFile = Join-Path $AgentDir 'ops-key.txt'
$LogFile = Join-Path $AgentDir 'ops-agent.log'
$Base = 'https://119.29.82.217'
$AgentId = 'game-114'
$AgentVersion = '1.0.0'

function Write-Log([string]$Message) {
  try {
    if (-not (Test-Path $AgentDir)) { New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null }
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 1048576)) {
      Move-Item -Path $LogFile -Destination "$LogFile.1" -Force
    }
    $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
  } catch {
    # logging must never break the agent
  }
}

# One instance at a time: a slow job must not overlap the next minute's run.
$mutex = New-Object System.Threading.Mutex($false, 'Global\ESFOpsAgent')
if (-not $mutex.WaitOne(0)) { exit 0 }

try {
  if (-not (Test-Path $KeyFile)) {
    Write-Log 'key file missing, exit'
    exit 1
  }
  $key = (Get-Content $KeyFile -Raw).Trim()
  if (-not $key) {
    Write-Log 'key file empty, exit'
    exit 1
  }

  $headers = @{ 'x-ops-key' = $key }

  function Invoke-Api([string]$Method, [string]$Path, $Body) {
    $params = @{
      Method     = $Method
      Uri        = "$Base$Path"
      Headers    = $headers
      TimeoutSec = 30
      ErrorAction = 'Stop'
    }
    if ($null -ne $Body) {
      $json = $Body | ConvertTo-Json -Compress -Depth 5
      $params.ContentType = 'application/json; charset=utf-8'
      $params.Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    }
    return Invoke-RestMethod @params
  }

  $claim = Invoke-Api 'POST' '/api/ops/claim' @{
    agent    = $AgentId
    hostname = $env:COMPUTERNAME
    version  = $AgentVersion
  }

  $job = $null
  if ($claim -and $claim.data) { $job = $claim.data.job }
  if (-not $job) { exit 0 }

  Write-Log ("claim job {0}: {1}" -f $job.id, $job.cmd)

  $outFile = Join-Path $env:TEMP ("ops-{0}.out" -f $job.id)
  $errFile = Join-Path $env:TEMP ("ops-{0}.err" -f $job.id)
  Remove-Item $outFile, $errFile -Force -ErrorAction SilentlyContinue

  $workDir = 'C:\'
  if ($job.cwd) { $workDir = [string]$job.cwd }

  $timeoutSec = 120
  if ($job.timeoutSec) { $timeoutSec = [int]$job.timeoutSec }
  if ($timeoutSec -le 0) { $timeoutSec = 120 }

  # chcp 65001 so cmd tools emit UTF-8; the platform stores the text as-is.
  $cmdLine = 'chcp 65001>nul & ' + [string]$job.cmd

  $started = Get-Date
  $proc = Start-Process -FilePath $env:ComSpec `
    -ArgumentList '/d', '/c', $cmdLine `
    -WorkingDirectory $workDir `
    -NoNewWindow -PassThru `
    -RedirectStandardOutput $outFile `
    -RedirectStandardError $errFile

  $timedOut = $false
  # Do not use WaitForExit(ms) here: with redirected stdout/stderr the call can
  # block until the child's pipes close, which never happens if a grandchild
  # inherits the handles. Poll instead and kill the whole tree on timeout.
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while (-not $proc.HasExited) {
    if ((Get-Date) -gt $deadline) {
      $timedOut = $true
      try { & taskkill /pid $proc.Id /t /f 2>$null | Out-Null } catch { }
      break
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $timedOut) {
    try { $proc.WaitForExit(5000) | Out-Null } catch { }
  }

  $code = 124
  if (-not $timedOut) {
    try { $code = [int]$proc.ExitCode } catch { $code = 1 }
  }

  $stdout = ''
  $stderr = ''
  if (Test-Path $outFile) { $stdout = [System.IO.File]::ReadAllText($outFile, [System.Text.Encoding]::UTF8) }
  if (Test-Path $errFile) { $stderr = [System.IO.File]::ReadAllText($errFile, [System.Text.Encoding]::UTF8) }
  if ($timedOut) { $stderr = ($stderr + "`n[agent] timed out after $timeoutSec s") }

  $elapsed = [int]((Get-Date) - $started).TotalMilliseconds
  Write-Log ("job {0} finished exit={1} ms={2}" -f $job.id, $code, $elapsed)

  Invoke-Api 'POST' ("/api/ops/{0}/result" -f $job.id) @{
    exitCode = $code
    stdout   = $stdout
    stderr   = $stderr
  } | Out-Null

  Remove-Item $outFile, $errFile -Force -ErrorAction SilentlyContinue
  exit 0
} catch {
  Write-Log ("error: " + $_.Exception.Message)
  exit 1
} finally {
  try { $mutex.ReleaseMutex() } catch { }
  $mutex.Dispose()
}
