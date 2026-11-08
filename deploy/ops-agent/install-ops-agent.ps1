# Install the pull-mode ops agent on the game server (run once, elevated).
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-ops-agent.ps1 -Key <OPS_AGENT_KEY>
#
# Creates C:\esf-agent, writes the key, copies ops-agent.ps1 next to it and
# registers scheduled task ESFOpsAgent (SYSTEM, every minute, highest).
# Safe to re-run: it overwrites the script/key and re-registers the task.

param(
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$SourceDir = $PSScriptRoot,
  [string]$AgentDir = 'C:\esf-agent'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $AgentDir)) { New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null }

$agentSrc = Join-Path $SourceDir 'ops-agent.ps1'
if (-not (Test-Path $agentSrc)) { throw "ops-agent.ps1 not found next to this script: $agentSrc" }

Copy-Item $agentSrc (Join-Path $AgentDir 'ops-agent.ps1') -Force
[System.IO.File]::WriteAllText((Join-Path $AgentDir 'ops-key.txt'), $Key.Trim(), (New-Object System.Text.UTF8Encoding($false)))

# Key file is root-equivalent: only SYSTEM and local admins may read it.
icacls (Join-Path $AgentDir 'ops-key.txt') /inheritance:r /grant:r 'SYSTEM:(R)' 'Administrators:(R)' | Out-Null

$taskCmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\esf-agent\ops-agent.ps1"'
schtasks /create /tn "ESFOpsAgent" /tr $taskCmd /sc minute /mo 1 /ru SYSTEM /rl HIGHEST /f | Out-Null

schtasks /query /tn "ESFOpsAgent" /fo list | Select-String -Pattern 'TaskName|Status|Next Run'

Write-Host 'agent installed. running once now...'
& (Join-Path $AgentDir 'ops-agent.ps1')
Write-Host 'done. log: C:\esf-agent\ops-agent.log'
