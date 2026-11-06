#requires -Version 5.1
<#
.SYNOPSIS
  ESF AMXX r14 安装器（离线、可回滚）。

.DESCRIPTION
  将同目录下的 4 个 .amxx 安装到 AMXX 的 plugins 目录：
    esf_platform_auth.amxx / esf_ranked_lock.amxx / test_ranked.amxx / esf_gamemode.amxx

  行为：
  1. 读取同目录 SHA256SUMS.txt，逐个校验 .amxx；任一不匹配立即中止。
  2. 自动探测 AMXX 目录（WMI 中的 hlds.exe 进程，或常见 addons 路径），
     也可用 -AmxModxDir 显式指定。
  3. 需要变更时，把现有 4 个 .amxx、plugins.ini、amxx.cfg 备份到
     <amxx>\backup-<yyyyMMdd-HHmmss>\。
  4. 复制/追加均幂等；若目标已是 r14，则不做任何写入。
  5. 任一步失败，自动用备份回滚已复制的文件。
  6. 不联网、不写 amxx.cfg 密码、不猜测服务器 key。

.PARAMETER AmxModxDir
  AMXX 根目录（含 configs\plugins.ini 与 plugins\ 的那一层）。
  也可以传 ...\addons\amxmodx 的父级 ...\addons，脚本会自动补 amxmodx。

.PARAMETER DryRun
  只打印计划并做 SHA256 校验，不创建目录、不写任何文件。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\install-amxx.ps1 -DryRun
  powershell -NoProfile -ExecutionPolicy Bypass -File .\install-amxx.ps1 -AmxModxDir "D:\HLDS\esf\addons\amxmodx"
#>
[CmdletBinding()]
param(
    [string]$AmxModxDir = '',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$script:ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$script:PkgFiles = @(
    'esf_platform_auth.amxx',
    'esf_ranked_lock.amxx',
    'test_ranked.amxx',
    'esf_gamemode.amxx'
)
$script:SumsPath = Join-Path $script:ScriptDir 'SHA256SUMS.txt'
$script:PluginMarker = '; === ESF r14 plugins ==='
$script:ConfigMarker = '; === ESF r14 config template ==='

function Write-Say  { param([string]$Text) Write-Host $Text }
function Write-Ok   { param([string]$Text) Write-Host "[OK]   $Text" -ForegroundColor Green }
function Write-Warn { param([string]$Text) Write-Host "[WARN] $Text" -ForegroundColor Yellow }
function Write-Err  { param([string]$Text) Write-Host "[ERR]  $Text" -ForegroundColor Red }

function Get-LowerHash {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-SumsFile {
    if (-not (Test-Path -LiteralPath $script:SumsPath -PathType Leaf)) {
        throw "缺少 $($script:SumsPath)。请从完整 r14 包解压后再运行。"
    }
    $map = @{}
    foreach ($line in [System.IO.File]::ReadAllLines($script:SumsPath)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line -match '^\s*#') { continue }
        if ($line -notmatch '^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$') {
            throw "SHA256SUMS.txt 行格式非法: $line"
        }
        $name = $matches[2]
        if ($map.ContainsKey($name)) { throw "SHA256SUMS.txt 中 $name 重复。" }
        $map[$name] = $matches[1].ToLowerInvariant()
    }
    return $map
}

function Assert-Package {
    param([hashtable]$Sums)
    foreach ($f in $script:PkgFiles) {
        if (-not $Sums.ContainsKey($f)) { throw "SHA256SUMS.txt 缺少 $f。" }
        $p = Join-Path $script:ScriptDir $f
        if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "包内缺少 $f。" }
        $actual = Get-LowerHash $p
        if ($actual -ne $Sums[$f]) {
            throw "SHA256 不匹配: $f`n  期望 $($Sums[$f])`n  实际 $actual"
        }
        Write-Ok "SHA256 $f"
    }
}

function Test-AmxxRoot {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
    $ini = Join-Path $Path 'configs\plugins.ini'
    $plugins = Join-Path $Path 'plugins'
    return ((Test-Path -LiteralPath $ini -PathType Leaf) -and (Test-Path -LiteralPath $plugins -PathType Container))
}

function Normalize-AmxxRoot {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
    try { $full = [System.IO.Path]::GetFullPath($Path) } catch { return $Path }
    if (Test-AmxxRoot $full) { return $full }
    $child = Join-Path $full 'amxmodx'
    if (Test-AmxxRoot $child) { return $child }
    return $full
}

function Add-Candidate {
    param([System.Collections.ArrayList]$List, [hashtable]$Seen, [string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    try { $full = [System.IO.Path]::GetFullPath($Path) } catch { return }
    $full = $full.TrimEnd('\', '/')
    if (-not (Test-AmxxRoot $full)) { return }
    $key = $full.ToLowerInvariant()
    if ($Seen.ContainsKey($key)) { return }
    $Seen[$key] = $true
    [void]$List.Add($full)
}

function Find-AmxxRoots {
    $list = New-Object System.Collections.ArrayList
    $seen = @{}

    if (-not [string]::IsNullOrWhiteSpace($AmxModxDir)) {
        $full = Normalize-AmxxRoot $AmxModxDir
        if (-not (Test-AmxxRoot $full)) {
            throw "-AmxModxDir 不是有效的 AMXX 目录（需要 configs\plugins.ini 与 plugins\）: $AmxModxDir"
        }
        [void]$list.Add($full)
        return @($list)
    }

    # 1) 正在运行的 HLDS：从 -game 与 +port 推断 addons 目录
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name='hlds.exe'" -ErrorAction Stop
    } catch {
        Write-Warn "WMI 查询 hlds.exe 失败（跳过自动探测）: $($_.Exception.Message)"
        $procs = @()
    }
    foreach ($proc in $procs) {
        $cmd = [string]$proc.CommandLine
        if ([string]::IsNullOrWhiteSpace($cmd)) { continue }
        $game = ''
        if ($cmd -match '(?i)(?:^|\s)-game\s+(?:"([^"]+)"|(\S+))') {
            $game = if ($matches[1]) { $matches[1] } else { $matches[2] }
        }
        if ($game) {
            if ([System.IO.Path]::IsPathRooted($game)) {
                Add-Candidate $list $seen (Join-Path $game 'addons\amxmodx')
                $parent = Split-Path -Parent $game
                if ($parent) {
                    Add-Candidate $list $seen (Join-Path $parent 'addons\amxmodx')
                }
            } else {
                Add-Candidate $list $seen (Join-Path (Get-Location).Path (Join-Path $game 'addons\amxmodx'))
                Add-Candidate $list $seen (Join-Path (Get-Location).Path 'addons\amxmodx')
            }
        } else {
            Add-Candidate $list $seen (Join-Path (Get-Location).Path 'addons\amxmodx')
        }
    }

    # 2) 常见相对路径
    Add-Candidate $list $seen (Join-Path (Get-Location).Path 'addons\amxmodx')
    Add-Candidate $list $seen (Join-Path $script:ScriptDir 'addons\amxmodx')
    Add-Candidate $list $seen (Join-Path (Split-Path -Parent $script:ScriptDir) 'addons\amxmodx')

    return @($list)
}

function Backup-One {
    param([string]$Path, [string]$BackupDir)
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Copy-Item -LiteralPath $Path -Destination (Join-Path $BackupDir (Split-Path -Leaf $Path)) -Force
    }
}

function Append-AsciiLines {
    param([string]$Path, [string[]]$Lines, [string]$Marker)
    $existing = ''
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $existing = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::Default)
    }
    $block = @()
    if ($existing -notmatch [regex]::Escape($Marker)) { $block += $Marker }
    $block += $Lines
    if ($block.Count -eq 0) { return }

    $payload = ($block -join "`r`n") + "`r`n"
    if ($existing.Length -gt 0 -and -not $existing.EndsWith("`n")) { $payload = "`r`n" + $payload }
    $enc = New-Object System.Text.ASCIIEncoding
    [System.IO.File]::AppendAllText($Path, $payload, $enc)
}

function Invoke-Rollback {
    param(
        [string]$Root,
        [string]$BackupDir,
        [string[]]$Copied,
        [bool]$IniTouched,
        [bool]$CfgTouched
    )
    Write-Warn "开始回滚..."
    $pluginDir = Join-Path $Root 'plugins'
    foreach ($f in $script:PkgFiles) {
        $bk = Join-Path $BackupDir $f
        $dst = Join-Path $pluginDir $f
        if (Test-Path -LiteralPath $bk -PathType Leaf) {
            Copy-Item -LiteralPath $bk -Destination $dst -Force
            Write-Say "  恢复 $f"
        } elseif ($Copied -contains $f -and (Test-Path -LiteralPath $dst)) {
            Remove-Item -LiteralPath $dst -Force
            Write-Say "  删除新复制 $f"
        }
    }
    if ($IniTouched) {
        $bk = Join-Path $BackupDir 'plugins.ini'
        if (Test-Path -LiteralPath $bk -PathType Leaf) {
            Copy-Item -LiteralPath $bk -Destination (Join-Path $Root 'configs\plugins.ini') -Force
            Write-Say "  恢复 configs\plugins.ini"
        }
    }
    if ($CfgTouched) {
        $bk = Join-Path $BackupDir 'amxx.cfg'
        if (Test-Path -LiteralPath $bk -PathType Leaf) {
            Copy-Item -LiteralPath $bk -Destination (Join-Path $Root 'amxx.cfg') -Force
            Write-Say "  恢复 amxx.cfg"
        }
    }
    Write-Ok "回滚完成（备份保留在 $BackupDir）"
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
try {
    Write-Say "ESF AMXX r14 安装器"
    Write-Say "包目录: $script:ScriptDir"

    $sums = Read-SumsFile
    Assert-Package $sums

    $roots = @(Find-AmxxRoots)
    if ($roots.Count -eq 0) {
        throw "未找到 AMXX 目录。请关闭游戏服务器后用 -AmxModxDir 指定，例如:`n  -AmxModxDir `"D:\HLDS\esf\addons\amxmodx`""
    }
    if ($roots.Count -gt 1) {
        Write-Warn "检测到多个 AMXX 目录，请用 -AmxModxDir 指定其中一个："
        foreach ($r in $roots) { Write-Say "  - $r" }
        throw "目标不唯一，已中止（未写入任何文件）。"
    }

    $root = $roots[0]
    $pluginDir = Join-Path $root 'plugins'
    $iniPath = Join-Path $root 'configs\plugins.ini'
    $cfgPath = Join-Path $root 'amxx.cfg'
    Write-Ok "目标 AMXX: $root"

    # 计算需要变更的内容
    $toCopy = @()
    foreach ($f in $script:PkgFiles) {
        $dst = Join-Path $pluginDir $f
        if (-not (Test-Path -LiteralPath $dst -PathType Leaf) -or (Get-LowerHash $dst) -ne $sums[$f]) {
            $toCopy += $f
        }
    }

    $iniText = if (Test-Path -LiteralPath $iniPath -PathType Leaf) {
        [System.IO.File]::ReadAllText($iniPath, [System.Text.Encoding]::Default)
    } else { '' }

    $iniMissing = @()
    foreach ($f in $script:PkgFiles) {
        $pattern = '(?im)^\s*' + [regex]::Escape($f) + '\s*(?:;.*)?$'
        if ($iniText -notmatch $pattern) { $iniMissing += $f }
    }

    $cfgText = if (Test-Path -LiteralPath $cfgPath -PathType Leaf) {
        [System.IO.File]::ReadAllText($cfgPath, [System.Text.Encoding]::Default)
    } else { '' }
    $needCfgTemplate = (($cfgText -notmatch [regex]::Escape($script:ConfigMarker)) -and
                        ($cfgText -notmatch '(?im)^\s*platform_sql_host\s'))

    $needChange = ($toCopy.Count -gt 0) -or ($iniMissing.Count -gt 0) -or $needCfgTemplate

    if (-not $needChange) {
        Write-Ok "目标已是 r14：4 个插件哈希一致，plugins.ini 已含 4 行，amxx.cfg 已有平台配置。"
        Write-Say "未写入任何文件。"
        exit 0
    }

    if ($DryRun) {
        Write-Say ""
        Write-Say "[DRY-RUN] 以下操作不会真正执行："
        Write-Say "  备份目录: (真实运行时创建) $root\backup-<yyyyMMdd-HHmmss>"
        if ($toCopy.Count -gt 0) {
            Write-Say "  复制插件: $($toCopy -join ', ')"
        } else {
            Write-Say "  复制插件: 无（已一致）"
        }
        if ($iniMissing.Count -gt 0) {
            Write-Say "  plugins.ini 追加: $($iniMissing -join ', ')"
        } else {
            Write-Say "  plugins.ini: 无变更"
        }
        Write-Say ("  amxx.cfg 注释模板: " + $(if ($needCfgTemplate) { '追加（不含密码）' } else { '无变更' }))
        Write-Say "[DRY-RUN] 未创建目录、未写入任何文件。"
        exit 0
    }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupDir = Join-Path $root ("backup-$stamp")
    $n = 1
    while (Test-Path -LiteralPath $backupDir) {
        $backupDir = Join-Path $root ("backup-$stamp-$n")
        $n++
    }
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    Write-Ok "备份目录: $backupDir"

    foreach ($f in $script:PkgFiles) { Backup-One (Join-Path $pluginDir $f) $backupDir }
    Backup-One $iniPath $backupDir
    Backup-One $cfgPath $backupDir

    $copied = @()
    $iniTouched = $false
    $cfgTouched = $false

    try {
        foreach ($f in $toCopy) {
            Copy-Item -LiteralPath (Join-Path $script:ScriptDir $f) -Destination (Join-Path $pluginDir $f) -Force
            $copied += $f
            $actual = Get-LowerHash (Join-Path $pluginDir $f)
            if ($actual -ne $sums[$f]) { throw "复制后 SHA256 不匹配: $f ($actual)" }
            Write-Ok "已安装 $f"
        }

        if ($iniMissing.Count -gt 0) {
            $iniTouched = $true
            Append-AsciiLines $iniPath $iniMissing $script:PluginMarker
            Write-Ok "plugins.ini 已追加: $($iniMissing -join ', ')"
        }

        if ($needCfgTemplate) {
            $cfgTouched = $true
            $template = @(
                '; Fill these cvars on this server. Never commit or share the password.',
                '; platform_sql_host "127.0.0.1:3306"',
                '; platform_sql_user "esf_amxx"',
                '; platform_sql_db "esf_platform"',
                '; platform_server_key "<servers.server_key>"',
                '; platform_sql_pass "<set locally>"',
                '; platform_enforce 1',
                '; platform_allow_guest 0',
                '; platform_sync_name 1',
                '; platform_fail_open 1',
                '; ranked_sql_host "127.0.0.1:3306"',
                '; ranked_sql_user "esf_amxx"',
                '; ranked_sql_db "esf_platform"',
                '; ranked_server_key "<servers.server_key>"',
                '; ranked_sql_pass "<set locally>"',
                '; ranked_lock 1',
                '; ranked_fail_open 1'
            )
            Append-AsciiLines $cfgPath $template $script:ConfigMarker
            Write-Ok "amxx.cfg 已追加注释模板（不含任何密码）"
        }

        Write-Say ""
        Write-Ok "安装完成。下一步："
        Write-Say "  1) 在 amxx.cfg 填好 platform_/ranked_ 的 host/user/db/server_key/pass（密码只写本机）。"
        Write-Say "  2) 重启服务器或 changelevel，使插件重新加载。"
        Write-Say "  3) 控制台执行 amxx plugins，确认 4 个插件为 running。"
        Write-Say "  回滚：把 $backupDir 内文件复制回原位。"
        exit 0
    } catch {
        Write-Err $_.Exception.Message
        Invoke-Rollback -Root $root -BackupDir $backupDir -Copied $copied -IniTouched $iniTouched -CfgTouched $cfgTouched
        throw
    }
} catch {
    Write-Err $_.Exception.Message
    exit 1
}
