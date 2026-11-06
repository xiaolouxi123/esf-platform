#requires -Version 5.1
<#
.SYNOPSIS
  ESF AMXX r14 remote one-click installer (HLSM friendly).

.DESCRIPTION
  1. Downloads the r14 package from a public URL (or uses -PackagePath).
  2. Verifies the package SHA256.
  3. Detects every running hlds.exe instance (including servers started by
     HL Server Monitor / HLSM), resolves its AMXX directory, and runs the
     packaged install-amxx.ps1 (idempotent, backs up before writing).
  4. Stops the matching hlds.exe processes so HLSM restarts them with the
     new plugins (skip with -NoRestart).
  5. Optional -RegisterTask creates a daily scheduled task that only acts
     when the installed plugins differ from the published package.

  ASCII-only on purpose: safe to run from any PowerShell console.

.PARAMETER AmxModxDir
  Install into one explicit AMXX directory instead of auto-detecting.

.PARAMETER PackagePath
  Use a local zip instead of downloading.

.PARAMETER DryRun
  Download/verify/detect and print the plan; do not write or restart.

.PARAMETER NoRestart
  Install but do not stop hlds.exe.

.PARAMETER Force
  Restart even when no HLSM window is detected.

.PARAMETER RegisterTask
  Register a daily scheduled task (default 05:30) that runs this script.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\remote-install.ps1 -DryRun

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\remote-install.ps1
#>
[CmdletBinding()]
param(
    [string]$AmxModxDir = '',
    [string[]]$ServerRoot = @(),
    [string]$PackageUrl = 'https://cdn.jsdelivr.net/gh/xiaolouxi123/esf-platform@dist-amxx-r14/deploy/amxx-r14/esf-challenge-plugins-0.4.6-r14.zip',
    [string]$PackageSha256 = 'd4ef8670e702e663b86d1da14f046d23af2bedc076cf168d2942c19f55156be4',
    [string]$PackagePath = '',
    [switch]$DryRun,
    [switch]$NoRestart,
    [switch]$Force,
    [switch]$RegisterTask,
    [switch]$UnregisterTask,
    [string]$TaskTime = '05:30',
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:LogPath = Join-Path ([System.IO.Path]::GetTempPath()) 'esf-amxx-r14.log'
$script:PkgFiles = @('esf_platform_auth.amxx', 'esf_ranked_lock.amxx', 'test_ranked.amxx', 'esf_gamemode.amxx')
$script:TaskName = 'ESF AMXX r14 AutoUpdate'
$script:DefaultKeyByPort = @{ 27015 = 'fcx-1v1-1'; 27016 = 'fcx-1v1-1'; 27017 = 'fcx-1v1-2' }

function Write-Log {
    param([string]$Text, [string]$Level = 'INFO')
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Text
    try { Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8 } catch { }
    if (-not $Quiet) {
        switch ($Level) {
            'OK'   { Write-Host $line -ForegroundColor Green }
            'WARN' { Write-Host $line -ForegroundColor Yellow }
            'ERR'  { Write-Host $line -ForegroundColor Red }
            default { Write-Host $line }
        }
    }
}

function Get-LowerHash {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-AmxxRoot {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
    return ((Test-Path -LiteralPath (Join-Path $Path 'configs\plugins.ini') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $Path 'plugins') -PathType Container))
}

function Resolve-AmxxFromRoot {
    param([string]$Root, [string]$Mod)
    if ([string]::IsNullOrWhiteSpace($Root)) { return '' }
    $cands = @()
    if ($Mod) { $cands += (Join-Path $Root (Join-Path $Mod 'addons\amxmodx')) }
    $cands += (Join-Path $Root 'esf\addons\amxmodx')
    $cands += (Join-Path $Root 'addons\amxmodx')
    foreach ($c in $cands) { if (Test-AmxxRoot $c) { return (Resolve-Path -LiteralPath $c).Path } }

    return ''
}

function Get-EsfInstances {
    $found = New-Object System.Collections.ArrayList
    $procs = @()
    try { $procs = Get-CimInstance Win32_Process -Filter "Name='hlds.exe'" -ErrorAction SilentlyContinue } catch { }
    foreach ($p in $procs) {
        $cmd = [string]$p.CommandLine
        $exe = [string]$p.ExecutablePath
        $port = 27015
        if ($cmd -match '[-+]port\s+(\d+)') { $port = [int]$matches[1] }
        $mod = 'esf'
        if ($cmd -match '-game\s+"?([^\s"]+)') { $mod = $matches[1] }
        $root = ''
        if ($exe) { $root = Split-Path -Parent $exe }
        $amxx = Resolve-AmxxFromRoot -Root $root -Mod $mod
        if (-not $amxx) {
            Write-Log "hlds.exe pid=$($p.ProcessId) port=$port root='$root' : AMXX dir not resolved" 'WARN'
            continue
        }
        $key = ''
        if ($script:DefaultKeyByPort.ContainsKey($port)) { $key = $script:DefaultKeyByPort[$port] }
        [void]$found.Add([pscustomobject]@{
            Pid = [int]$p.ProcessId; Port = $port; Mod = $mod; Root = $root;
            AmxxDir = $amxx; ServerKey = $key
        })
    }
    # Fallback: scan common HLDS roots when nothing is running yet.
    if ($found.Count -eq 0) {
        $roots = @()
        foreach ($sr in $ServerRoot) { $roots += $sr }
    $roots += (Join-Path $env:USERPROFILE 'Desktop')
        $roots += 'C:\HLDS'
        $roots += 'D:\HLDS'
        $roots += 'C:\esf'
        foreach ($r in $roots) {
            if (-not (Test-Path -LiteralPath $r -PathType Container)) { continue }
            $dirs = @(Get-Item -LiteralPath $r -ErrorAction SilentlyContinue)
            $dirs += @(Get-ChildItem -LiteralPath $r -Directory -ErrorAction SilentlyContinue |
                       Where-Object { $_.Name -match '^(Fcx|HLDS|hlds|esf|server)' })
            foreach ($d in $dirs) {
                $amxx = Resolve-AmxxFromRoot -Root $d.FullName -Mod 'esf'
                if ($amxx) {
                    [void]$found.Add([pscustomobject]@{
                        Pid = 0; Port = 0; Mod = 'esf'; Root = $d.FullName; AmxxDir = $amxx; ServerKey = ''
                    })
                }
            }
        }
    }
    return @($found | Sort-Object AmxxDir -Unique)
}

function Test-HlsmRunning {
    $p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match 'HL Server Monitor' }
    return [bool]$p
}

function Test-PortOpen {
    param([int]$Port, [int]$TimeoutMs = 1500)
    if ($Port -le 0) { return $false }
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if ($iar.AsyncWaitHandle.WaitOne($TimeoutMs)) { $client.EndConnect($iar); return $true }
        return $false
    } catch { return $false } finally { $client.Close() }
}

Write-Log 'ESF AMXX r14 remote installer start'
Write-Log "log file: $script:LogPath"
if ($RegisterTask) {
    $cmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Quiet' -f $PSCommandPath
    $null = schtasks /Create /TN "$script:TaskName" /SC DAILY /ST $TaskTime /RL HIGHEST /F /TR $cmd 2>&1
    if ($LASTEXITCODE -eq 0) { Write-Log "scheduled task registered: $script:TaskName at $TaskTime" 'OK' }
    else { Write-Log "failed to register scheduled task (run as admin)" 'ERR' }
    return
}
if ($UnregisterTask) {
    $null = schtasks /Delete /TN "$script:TaskName" /F 2>&1
    Write-Log "scheduled task removed (if it existed)" 'OK'
    return
}

# --- package -------------------------------------------------------------
$work = Join-Path ([System.IO.Path]::GetTempPath()) 'esf-amxx-r14-pkg'
if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
New-Item -ItemType Directory -Path $work -Force | Out-Null
$zip = Join-Path $work 'esf-challenge-plugins-0.4.6-r14.zip'
if ($PackagePath) {
    if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf)) { throw "package not found: $PackagePath" }
    Copy-Item -LiteralPath $PackagePath -Destination $zip -Force
    Write-Log "package: local $PackagePath"
} else {
    Write-Log "package: downloading $PackageUrl"
    Invoke-WebRequest -Uri $PackageUrl -OutFile $zip -UseBasicParsing -TimeoutSec 120
}
$actual = Get-LowerHash $zip
if ($PackageSha256 -and ($actual -ne $PackageSha256.ToLowerInvariant())) {
    throw "package SHA256 mismatch: expected $PackageSha256 actual $actual"
}
Write-Log "package SHA256 OK: $actual" 'OK'
$extract = Join-Path $work 'pkg'
Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
$installer = Join-Path $extract 'install-amxx.ps1'
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "install-amxx.ps1 missing in package" }
$sums = @{}
foreach ($line in [System.IO.File]::ReadAllLines((Join-Path $extract 'SHA256SUMS.txt'))) {
    if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$') { $sums[$matches[2]] = $matches[1].ToLowerInvariant() }
}
if ($sums.Count -eq 0) { throw 'SHA256SUMS.txt missing or empty' }

# --- targets -------------------------------------------------------------
if ($AmxModxDir) {
    if (-not (Test-AmxxRoot $AmxModxDir)) { throw "not an AMXX dir: $AmxModxDir" }
    $instances = @([pscustomobject]@{ Pid = 0; Port = 0; Mod = 'esf'; Root = ''; AmxxDir = (Resolve-Path -LiteralPath $AmxModxDir).Path; ServerKey = '' })
} else {
    $instances = @(Get-EsfInstances)
}
if ($instances.Count -eq 0) {
    throw 'no ESF AMXX instance found. Start the servers (HLSM) or pass -AmxModxDir "X:\...\esf\addons\amxmodx".'
}
Write-Log ("targets: " + (($instances | ForEach-Object { "$($_.AmxxDir) port=$($_.Port) pid=$($_.Pid)" }) -join ' | ')) 'OK'

$hlsm = Test-HlsmRunning
if (-not $hlsm) { Write-Log 'HLSM window not detected; restart step will be skipped unless -Force' 'WARN' }

# --- install -------------------------------------------------------------
$changed = @()
foreach ($inst in $instances) {
    $current = $true
    foreach ($f in $script:PkgFiles) {
        $target = Join-Path $inst.AmxxDir (Join-Path 'plugins' $f)
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { $current = $false; break }
        if ((Get-LowerHash $target) -ne $sums[$f]) { $current = $false; break }
    }
    $ini = Join-Path $inst.AmxxDir 'configs\plugins.ini'
    if ($current -and (Test-Path -LiteralPath $ini -PathType Leaf)) {
        $iniText = [System.IO.File]::ReadAllText($ini)
        foreach ($f in $script:PkgFiles) { if ($iniText -notmatch [regex]::Escape($f)) { $current = $false; break } }
    }
    if ($current) {
        Write-Log "already current: $($inst.AmxxDir)" 'OK'
        continue
    }
    $cliArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $installer, '-AmxModxDir', $inst.AmxxDir)
    if ($DryRun) { $args += '-DryRun' }
    Write-Log "install: $($inst.AmxxDir)"
    $out = & powershell.exe @cliArgs 2>&1
    foreach ($line in $out) { Add-Content -LiteralPath $script:LogPath -Value "  $line" -Encoding UTF8 }
    if ($LASTEXITCODE -ne 0) { throw "install-amxx.ps1 failed for $($inst.AmxxDir) (exit $LASTEXITCODE)" }
    $changed += $inst
}

# --- restart -------------------------------------------------------------
if ($DryRun) {
    Write-Log 'dry-run: no files written, no restart'
    return
}
if ($changed.Count -eq 0) {
    Write-Log 'nothing changed; restart not needed' 'OK'
    return
}
if ($NoRestart) {
    Write-Log 'restart skipped (-NoRestart). Restart the servers from HLSM manually.' 'WARN'
    return
}
if (-not $hlsm -and -not $Force) {
    Write-Log 'restart skipped: HLSM not detected and -Force not set. Restart from HLSM manually.' 'WARN'
    return
}
foreach ($inst in $changed) {
    $targets = @()
    if ($inst.Pid -gt 0) {
        $targets += Get-Process -Id $inst.Pid -ErrorAction SilentlyContinue
    } else {
        $targets += Get-CimInstance Win32_Process -Filter "Name='hlds.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
            if ($_.ExecutablePath -and $inst.Root -and $_.ExecutablePath.StartsWith($inst.Root, 'OrdinalIgnoreCase')) {
                Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
            }
        }
    }
    foreach ($proc in $targets) {
        if (-not $proc) { continue }
        Write-Log "stopping hlds.exe pid=$($proc.Id) (HLSM should restart it)"
        Stop-Process -Id $proc.Id -Force
    }
}
Start-Sleep -Seconds 3
foreach ($inst in $changed) {
    $deadline = (Get-Date).AddSeconds(120)
    $up = $false
    while ((Get-Date) -lt $deadline) {
        if ($inst.Port -gt 0) {
            if (Test-PortOpen -Port $inst.Port) { $up = $true; break }
        } else {
            $p = Get-CimInstance Win32_Process -Filter "Name='hlds.exe'" -ErrorAction SilentlyContinue |
                 Where-Object { $_.ExecutablePath -and $inst.Root -and $_.ExecutablePath.StartsWith($inst.Root, 'OrdinalIgnoreCase') }
            if ($p) { $up = $true; break }
        }
        Start-Sleep -Seconds 4
    }
    if ($up) { Write-Log "server back: $($inst.AmxxDir) port=$($inst.Port)" 'OK' }
    else { Write-Log "server not back within 120s: $($inst.AmxxDir). Restart it from HLSM." 'ERR' }
}
Write-Log 'done'



