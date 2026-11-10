#requires -Version 5.1
<#
.SYNOPSIS
  ESF AMXX r14 确定性构建与打包脚本。

.DESCRIPTION
  固定使用 AMXX 1.10.0.5392 的 amxxpc.exe：
    G:\FCX1\FCX7.02融合版\esf\addons\amxmodx\scripting\amxxpc.exe

  流程：
  1. 校验编译器/版本/include；缺一即失败。
  2. UTF-8 源码 -> .build\gbk\ 的 GBK(936) 临时副本（源码本身不改）。
  3. 编译到 .build\r14\out\，完整输出写入 .build\r14\build.log。
  4. 组装 dist\amxx-r14\：4 个 .amxx + install-amxx.ps1 + README.txt + SHA256SUMS.txt。
  5. 生成固定时间戳/固定顺序的 dist\esf-challenge-plugins-0.4.6-r14.zip
     与 .zip.sha256。
  6. 校验 zip 内文件集合，拒绝 .sma/.build/.env/凭据文件。

.PARAMETER AmxxpcPath
  仅用于换机器调试；默认即生产固定的 1.10.0.5392 路径。

.PARAMETER IncludeDir
  默认取 amxxpc.exe 同目录 include。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File amxx\tools\build-r14.ps1
#>
[CmdletBinding()]
param(
    [string]$AmxxpcPath = 'G:\FCX1\FCX7.02融合版\esf\addons\amxmodx\scripting\amxxpc.exe',
    [string]$IncludeDir = ''
)

$ErrorActionPreference = 'Stop'

$script:Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script:AmxxDir = Join-Path $script:Root 'amxx'
$script:BuildDir = Join-Path $script:Root '.build\r14'
$script:GbkDir = Join-Path $script:Root '.build\gbk'
$script:OutDir = Join-Path $script:BuildDir 'out'
$script:LogPath = Join-Path $script:BuildDir 'build.log'
$script:StageDir = Join-Path $script:Root 'dist\amxx-r14'
$script:ZipPath = Join-Path $script:Root 'dist\esf-challenge-plugins-0.4.6-r14.zip'
$script:ZipShaPath = "$script:ZipPath.sha256"
$script:RequiredCompilerVersion = '1.10.0.5392'
$script:PackageName = 'esf-challenge-plugins-0.4.6-r14.zip'

$script:Sources = @(
    @{ Src = 'esf_platform_auth.sma'; Out = 'esf_platform_auth.amxx' },
    @{ Src = 'esf_ranked_lock.sma';   Out = 'esf_ranked_lock.amxx'   },
    @{ Src = 'esf_gamemode.sma';      Out = 'esf_gamemode.amxx'      },
    @{ Src = 'test_ranked.sma';       Out = 'test_ranked.amxx'       }
)

$script:Log = New-Object System.Text.StringBuilder
function Add-Log {
    param([string]$Text)
    Write-Host $Text
    [void]$script:Log.AppendLine($Text)
}
function Write-Section {
    param([string]$Title)
    Add-Log ''
    Add-Log ("=" * 72)
    Add-Log $Title
    Add-Log ("=" * 72)
}
function Get-LowerHash {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Flush-Log {
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $script:LogPath))) { return }
    $enc = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllText($script:LogPath, $script:Log.ToString(), $enc)
}

try {
    Write-Section "ESF AMXX r14 build"
    Add-Log ("root      = " + $script:Root)
    Add-Log ("amxxpc    = " + $AmxxpcPath)
    Add-Log ("build dir = " + $script:BuildDir)

    if (-not (Test-Path -LiteralPath $AmxxpcPath -PathType Leaf)) {
        throw "编译器不存在: $AmxxpcPath"
    }
    $fileVersion = (Get-Item -LiteralPath $AmxxpcPath).VersionInfo.FileVersion
    if ($fileVersion -ne $script:RequiredCompilerVersion) {
        throw "编译器版本不符: 期望 $($script:RequiredCompilerVersion)，实际 $fileVersion"
    }
    if ([string]::IsNullOrWhiteSpace($IncludeDir)) {
        $IncludeDir = Join-Path (Split-Path -Parent $AmxxpcPath) 'include'
    }
    if (-not (Test-Path -LiteralPath $IncludeDir -PathType Container)) {
        throw "include 目录不存在: $IncludeDir"
    }
    Add-Log ("compiler  = AMXXPC $fileVersion")
    Add-Log ("include   = " + $IncludeDir)
    Add-Log "debug     = -d1 (固定；-d2 在 amxxpc 1.10 上会产生非确定调试字符串)"

    # 清理旧产物，绝不复用
    if (Test-Path -LiteralPath $script:BuildDir) { Remove-Item -LiteralPath $script:BuildDir -Recurse -Force }
    if (Test-Path -LiteralPath $script:StageDir) { Remove-Item -LiteralPath $script:StageDir -Recurse -Force }
    if (Test-Path -LiteralPath $script:ZipPath) { Remove-Item -LiteralPath $script:ZipPath -Force }
    if (Test-Path -LiteralPath $script:ZipShaPath) { Remove-Item -LiteralPath $script:ZipShaPath -Force }
    New-Item -ItemType Directory -Path $script:BuildDir -Force | Out-Null
    New-Item -ItemType Directory -Path $script:GbkDir -Force | Out-Null
    New-Item -ItemType Directory -Path $script:OutDir -Force | Out-Null

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $gbk = [System.Text.Encoding]::GetEncoding(936)
    $errorTotal = 0
    $warningLines = New-Object System.Collections.ArrayList
    $built = @()

    foreach ($item in $script:Sources) {
        $src = Join-Path $script:AmxxDir $item.Src
        if (-not (Test-Path -LiteralPath $src -PathType Leaf)) {
            throw "源码不存在: $src"
        }
        $gbkPath = Join-Path $script:GbkDir $item.Src
        $outPath = Join-Path $script:OutDir $item.Out

        Write-Section ("compile " + $item.Src)
        $text = [System.IO.File]::ReadAllText($src, $utf8NoBom)
        [System.IO.File]::WriteAllText($gbkPath, $text, $gbk)
        Add-Log ("UTF-8 -> GBK: " + $gbkPath)

        $output = & $AmxxpcPath $gbkPath -d1 -i"$IncludeDir" -o"$outPath" 2>&1
        $exit = $LASTEXITCODE
        $outText = (($output | ForEach-Object { $_.ToString() }) -join "`r`n")
        Add-Log $outText
        Add-Log ("exit=" + $exit)

        $errs = [regex]::Matches($outText, '(?im)^.*\berror\s+\d+.*$')
        $warns = [regex]::Matches($outText, '(?im)^.*\bwarning\s+\d+.*$')
        $errorTotal += $errs.Count
        foreach ($w in $warns) {
            if (-not $warningLines.Contains($w.Value.Trim())) { [void]$warningLines.Add($w.Value.Trim()) }
        }

        $done = ($outText -match '(?im)\bDone\.')
        if ($exit -ne 0 -or $errs.Count -gt 0 -or -not $done) {
            throw "编译失败: $($item.Src) (exit=$exit, errors=$($errs.Count), done=$done)"
        }
        if (-not (Test-Path -LiteralPath $outPath -PathType Leaf)) {
            throw "编译器未生成: $outPath"
        }
        $size = (Get-Item -LiteralPath $outPath).Length
        $hash = Get-LowerHash $outPath
        Add-Log ("OK " + $item.Out + " size=" + $size + " sha256=" + $hash)
        $built += [pscustomobject]@{ Name = $item.Out; Size = $size; Sha256 = $hash }
    }

    Write-Section "compile summary"
    Add-Log ("errors   = " + $errorTotal)
    Add-Log ("warnings = " + $warningLines.Count)
    foreach ($w in $warningLines) { Add-Log ("WARN " + $w) }

    # 组装包目录
    Write-Section "assemble package"
    New-Item -ItemType Directory -Path $script:StageDir -Force | Out-Null
    foreach ($b in $built) {
        Copy-Item -LiteralPath (Join-Path $script:OutDir $b.Name) -Destination (Join-Path $script:StageDir $b.Name) -Force
    }

    $installerSrc = Join-Path $script:AmxxDir 'tools\install-amxx.ps1'
    $readmeSrc = Join-Path $script:AmxxDir 'tools\README-package.txt'
    if (-not (Test-Path -LiteralPath $installerSrc -PathType Leaf)) { throw "缺少安装器: $installerSrc" }
    if (-not (Test-Path -LiteralPath $readmeSrc -PathType Leaf)) { throw "缺少包说明: $readmeSrc" }
    Copy-Item -LiteralPath $installerSrc -Destination (Join-Path $script:StageDir 'install-amxx.ps1') -Force
    Copy-Item -LiteralPath $readmeSrc -Destination (Join-Path $script:StageDir 'README.txt') -Force

    $sumNames = @(
        'esf_gamemode.amxx',
        'esf_platform_auth.amxx',
        'esf_ranked_lock.amxx',
        'test_ranked.amxx',
        'install-amxx.ps1',
        'README.txt'
    )
    $sumLines = @()
    foreach ($name in $sumNames) {
        $p = Join-Path $script:StageDir $name
        if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "包内缺少 $name" }
        $sumLines += ((Get-LowerHash $p) + '  ' + $name)
    }
    $sumPath = Join-Path $script:StageDir 'SHA256SUMS.txt'
    [System.IO.File]::WriteAllLines($sumPath, $sumLines, (New-Object System.Text.UTF8Encoding($false)))
    Add-Log "SHA256SUMS.txt:"
    foreach ($l in $sumLines) { Add-Log ("  " + $l) }

    # 固定顺序 + 固定时间戳，产出可复现 zip
    Write-Section "create zip"
    Add-Type -AssemblyName System.IO.Compression | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
    $zipEntries = @('esf_gamemode.amxx', 'esf_platform_auth.amxx', 'esf_ranked_lock.amxx', 'test_ranked.amxx', 'install-amxx.ps1', 'README.txt', 'SHA256SUMS.txt')
    $fixedTime = [DateTimeOffset]::Parse('2026-11-07T00:00:00+08:00')
    $zip = [System.IO.Compression.ZipFile]::Open($script:ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $zipEntries) {
            $entry = $zip.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = $fixedTime
            $bytes = [System.IO.File]::ReadAllBytes((Join-Path $script:StageDir $name))
            $stream = $entry.Open()
            try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
        }
    } finally {
        $zip.Dispose()
    }

    # 校验 zip：文件集合、禁止项、逐文件哈希
    $zipRead = [System.IO.Compression.ZipFile]::OpenRead($script:ZipPath)
    try {
        $actualNames = @($zipRead.Entries | ForEach-Object { $_.FullName })
        foreach ($name in $zipEntries) {
            if ($actualNames -notcontains $name) { throw "zip 缺少 $name" }
        }
        foreach ($name in $actualNames) {
            if ($name -match '(?i)\.sma$|\.build|(^|/)\.env|credential|password') {
                throw "zip 含禁止文件: $name"
            }
            if ($zipEntries -notcontains $name) { throw "zip 含意外文件: $name" }
        }
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            foreach ($entry in $zipRead.Entries) {
                $s = $entry.Open()
                try { $actualHash = ([BitConverter]::ToString($sha.ComputeHash($s)) -replace '-', '').ToLowerInvariant() }
                finally { $s.Dispose() }
                $stageHash = Get-LowerHash (Join-Path $script:StageDir $entry.FullName)
                if ($actualHash -ne $stageHash) { throw "zip 内哈希不符: $($entry.FullName)" }
            }
        } finally { $sha.Dispose() }
    } finally {
        $zipRead.Dispose()
    }

    $zipSize = (Get-Item -LiteralPath $script:ZipPath).Length
    $zipHash = Get-LowerHash $script:ZipPath
    [System.IO.File]::WriteAllText($script:ZipShaPath, ($zipHash + '  ' + $script:PackageName + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    Add-Log ("zip       = " + $script:ZipPath)
    Add-Log ("zip size  = " + $zipSize)
    Add-Log ("zip sha256= " + $zipHash)
    Add-Log ("sha file  = " + $script:ZipShaPath)

    Write-Section "DONE"
    Add-Log ("0 error, " + $warningLines.Count + " warning(s)")
    Flush-Log
    exit 0
} catch {
    Add-Log ("FATAL: " + $_.Exception.Message)
    Flush-Log
    exit 1
}
