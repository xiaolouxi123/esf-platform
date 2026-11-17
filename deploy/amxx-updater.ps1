$ErrorActionPreference = 'Stop'
# ESF AMXX plugin auto-updater (game server 114, scheduled task ESFAmxxUpdate, every 10 min).
# Decides by manifest zip sha256 + per-file sha256, not only by version string:
# rebuilt packages with the same version number must still be delivered (0.53 incident).
# NOTE: keep this file ASCII-only. It is copied to the game server and run by
# Windows PowerShell 5.1, which reads a UTF-8 file without BOM as ANSI and mangles non-ASCII text.
$primary  = 'https://119.29.82.217/updates/amxx'
$fallback = 'http://119.29.82.217:3000/updates/amxx'
$feedUrls = @($primary, $fallback)
$stateDir = 'C:\esf-agent'
$versionFile = Join-Path $stateDir 'amxx-version.txt'
$logFile = Join-Path $stateDir 'amxx-update.log'
$managed = @('esf_gamemode.amxx', 'esf_platform_auth.amxx', 'esf_ranked_lock.amxx', 'test_ranked.amxx')
$searchRoots = @('C:\Users\Administrator\Desktop', 'C:\')

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stateDir 'backups') | Out-Null

function Write-Log([string]$msg) {
    $line = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $msg
    Add-Content -Path $logFile -Value $line
}

if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 2MB) {
    Move-Item $logFile ($logFile + '.1') -Force
}

function Get-Manifest([string[]]$Urls) {
    foreach ($u in $Urls) {
        if (-not $u) { continue }
        try {
            $url = "$u/manifest.json?ts=" + [DateTime]::UtcNow.Ticks
            $m = Invoke-RestMethod -Uri $url -UseBasicParsing -TimeoutSec 20
            if ($m -is [string]) { $m = ($m -replace '^\uFEFF', '') | ConvertFrom-Json }
            if ($m -and $m.version -and $m.file) { return $m }
        } catch {
            Write-Log ("manifest fetch failed ($u): " + $_.Exception.Message)
        }
    }
    return $null
}

function Get-Sha256([string]$path) {
    return (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
}

function Get-ServerDirs {
    $found = @()
    foreach ($root in $searchRoots) {
        if (-not (Test-Path $root)) { continue }
        $dirs = Get-ChildItem $root -Directory -Filter 'FcxServer*' -ErrorAction SilentlyContinue
        foreach ($d in $dirs) { if ($found -notcontains $d.FullName) { $found += $d.FullName } }
    }
    return $found
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$m = Get-Manifest -Urls $feedUrls
if (-not $m -or -not $m.version) { Write-Log 'manifest unavailable, skip this round'; exit 1 }

$zipSha = ([string]$m.sha256).ToLower()
$stateRaw = ''
if (Test-Path $versionFile) { $stateRaw = (Get-Content $versionFile -Raw).Trim() }
$stateVersion = $stateRaw
$stateSha = ''
if ($stateRaw -like '*|*') {
    $parts = $stateRaw.Split('|')
    $stateVersion = $parts[0].Trim()
    $stateSha = $parts[1].Trim().ToLower()
}

$expected = @{}
if ($m.plugins) { foreach ($p in $m.plugins) { $expected[[string]$p.name] = ([string]$p.sha256).ToLower() } }

$servers = Get-ServerDirs
if (-not $servers) { Write-Log 'no FcxServer directories found'; exit 1 }

$outdated = $stateVersion -ne [string]$m.version -or $stateSha -ne $zipSha
if (-not $outdated) {
    # Version and zip both match; still spot-check files that were deleted or edited.
    $drift = @()
    foreach ($srv in $servers) {
        $pluginDir = Join-Path $srv 'esf\addons\amxmodx\plugins'
        foreach ($name in $managed) {
            if (-not $expected.ContainsKey($name)) { continue }
            $dest = Join-Path $pluginDir $name
            if (-not (Test-Path $dest)) { $drift += "$srv :: missing $name"; continue }
            if ((Get-Sha256 $dest) -ne $expected[$name]) { $drift += "$srv :: changed $name" }
        }
    }
    if ($drift.Count -eq 0) { exit 0 }
    Write-Log ('file drift detected: ' + ($drift -join '; '))
}

Write-Log ("update available: " + $stateVersion + " -> " + $m.version + " (" + $zipSha.Substring(0, 12) + ")")
$tmp = Join-Path $env:TEMP ('amxx-' + $m.version + '-' + $zipSha.Substring(0, 8))
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$zipPath = Join-Path $tmp $m.file
$downloaded = $false
foreach ($u in $feedUrls) {
    if (-not $u) { continue }
    try {
        Invoke-WebRequest -Uri "$u/$($m.file)" -OutFile $zipPath -UseBasicParsing -TimeoutSec 120
        $downloaded = $true
        break
    } catch {
        Write-Log ("download failed ($u): " + $_.Exception.Message)
    }
}
if (-not $downloaded) { exit 1 }
$hash = Get-Sha256 $zipPath
if ($hash -ne $zipSha) { Write-Log ("sha256 mismatch: got " + $hash + " want " + $zipSha); exit 1 }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$extract = Join-Path $tmp 'x'
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extract)

$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$backupRoot = Join-Path $stateDir ('backups\' + $stamp)
$applied = 0
$already = 0
foreach ($srv in $servers) {
    $pluginDir = Join-Path $srv 'esf\addons\amxmodx\plugins'
    if (-not (Test-Path $pluginDir)) { Write-Log ('plugin dir missing: ' + $pluginDir); continue }
    $bdir = Join-Path $backupRoot (Split-Path $srv -Leaf)
    foreach ($name in $managed) {
        $newFile = Join-Path $extract $name
        if (-not (Test-Path $newFile)) { continue }
        if ((Get-Item $newFile).Length -lt 100) { Write-Log ('skip small file: ' + $name); continue }
        $dest = Join-Path $pluginDir $name
        $want = $expected[$name]
        if (-not $want) { $want = Get-Sha256 $newFile }
        if ((Test-Path $dest) -and ((Get-Sha256 $dest) -eq $want)) { $already++; continue }
        New-Item -ItemType Directory -Force -Path $bdir | Out-Null
        if (Test-Path $dest) { Copy-Item $dest (Join-Path $bdir $name) -Force }
        Copy-Item $newFile $dest -Force
        if ((Get-Sha256 $dest) -ne $want) { Write-Log ('verify failed after copy: ' + $dest); continue }
        $applied++
    }
    Write-Log ('server ' + (Split-Path $srv -Leaf) + ' done')
}

Set-Content -Path $versionFile -Value ([string]$m.version + '|' + $zipSha) -Encoding ASCII
Write-Log ('recorded ' + $m.version + '|' + $zipSha.Substring(0, 12) + ' applied=' + $applied + ' unchanged=' + $already)

if ($applied -gt 0) {
    # Only stop game processes when a supervisor is present to bring them back.
    $svc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'hlsm|hlds|rehlds' -and $_.Status -eq 'Running' }
    $sup = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'hlsm|hldsmonitor' }
    if ($svc -or $sup) {
        Get-Process rehlds, hlds -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Log ('stopping ' + $_.ProcessName + ' pid ' + $_.Id + ' for reload')
            Stop-Process -Id $_.Id -Force
        }
    } else {
        Write-Log 'no supervisor detected; restart skipped (plugins load on next map change)'
    }
}
Write-Log 'done'
