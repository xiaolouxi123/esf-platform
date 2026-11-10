#requires -Version 5.1
<#
  ESF AMXX current-build compiler (UTF-8 no BOM, amxxpc 1.10.0.5392, -d1).

  This is the script for the CURRENT plugin line (BUILD 0.52 and later).
  Do NOT use tools/build-r14.ps1: that historical script converts sources to
  GBK before compiling, which produces mojibake in HLDS console / client text.

  ASCII-only on purpose: Windows PowerShell 5.1 reads UTF-8 scripts as ANSI.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File amxx\tools\build-current.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File amxx\tools\build-current.ps1 `
      -AmxxpcPath 'G:\FCX1\FCX7.02\esf\addons\amxmodx\scripting\amxxpc.exe'

  Output:
    dist\amxx-<BUILD>\  -> 4 .amxx files + SHA256SUMS.txt + build.log
    Then publish with:
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-amxx.ps1 `
        -SourceDir <OutDir> -Version <BUILD> -Notes "<notes>"
#>

param(
    [string]$AmxxpcPath = 'C:\Program Files (x86)\Steam\steamapps\common\Half-Life\esf\addons\amxmodx\scripting\amxxpc.exe',
    [string]$IncludeDir = '',
    [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'

$amxxDir = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $amxxDir

if (-not (Test-Path $AmxxpcPath)) {
    throw "amxxpc.exe not found: $AmxxpcPath"
}
if (-not $IncludeDir) {
    $IncludeDir = Join-Path (Split-Path -Parent $AmxxpcPath) 'include'
}
if (-not (Test-Path $IncludeDir)) {
    throw "include dir not found: $IncludeDir"
}

# BUILD is the single source of truth for the current plugin package version.
$authSource = Get-Content (Join-Path $amxxDir 'esf_platform_auth.sma') -Raw
$buildMatch = [regex]::Match($authSource, '#define BUILD "([^"]+)"')
if (-not $buildMatch.Success) {
    throw 'BUILD constant not found in esf_platform_auth.sma'
}
$build = $buildMatch.Groups[1].Value

if (-not $OutDir) {
    $OutDir = Join-Path $root ("dist\amxx-" + $build)
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$srcDir = Join-Path $OutDir '.src'
New-Item -ItemType Directory -Force -Path $srcDir | Out-Null
$logPath = Join-Path $OutDir 'build.log'
Set-Content -Path $logPath -Value ("ESF AMXX build " + $build + " / " + (Get-Date -Format s)) -Encoding ascii

$names = @('esf_gamemode', 'esf_platform_auth', 'esf_ranked_lock', 'test_ranked')
$built = @()

foreach ($name in $names) {
    $src = Join-Path $amxxDir ($name + '.sma')
    if (-not (Test-Path $src)) {
        throw "source missing: $src"
    }

    # Strip a UTF-8 BOM into a temporary copy; never modify the source itself.
    $bytes = [IO.File]::ReadAllBytes($src)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        $compileSrc = Join-Path $srcDir ($name + '.sma')
        $text = [Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
        [IO.File]::WriteAllText($compileSrc, $text, (New-Object Text.UTF8Encoding($false)))
        Write-Output ("[bom] stripped: " + $name)
    } else {
        $compileSrc = $src
    }

    $outFile = Join-Path $OutDir ($name + '.amxx')
    if (Test-Path $outFile) { Remove-Item $outFile -Force }

    $compileArgs = @($compileSrc, '-d1', ('-i' + $IncludeDir), ('-o' + $outFile))
    Add-Content -Path $logPath -Value ("`r`n=== " + $name + " ===") -Encoding ascii
    $output = & $AmxxpcPath @compileArgs 2>&1
    $code = $LASTEXITCODE
    if ($output) { $output | Out-File -FilePath $logPath -Append -Encoding ascii }

    if ($code -ne 0) {
        throw ("compile failed: " + $name + " exit=" + $code + " (see " + $logPath + ")")
    }
    if (-not (Test-Path $outFile) -or (Get-Item $outFile).Length -eq 0) {
        throw ("no .amxx produced for " + $name)
    }
    $built += $name
    Write-Output ("[ok] " + $name + ".amxx " + (Get-Item $outFile).Length + " bytes")
}

# SHA256 manifest for the publish step and for on-server verification.
$sums = foreach ($name in $built) {
    $f = Join-Path $OutDir ($name + '.amxx')
    $hash = (Get-FileHash -Path $f -Algorithm SHA256).Hash.ToLower()
    ($hash + '  ' + $name + '.amxx')
}
$sums | Out-File -FilePath (Join-Path $OutDir 'SHA256SUMS.txt') -Encoding ascii

Write-Output ""
Write-Output ("BUILD   : " + $build)
Write-Output ("OutDir  : " + $OutDir)
Write-Output ("Compiler: " + $AmxxpcPath)
Write-Output ("Include : " + $IncludeDir)
Write-Output ("Log     : " + $logPath)
Write-Output "Next    : scripts\publish-amxx.ps1 -SourceDir <OutDir> -Version <BUILD> -Notes <notes>"
