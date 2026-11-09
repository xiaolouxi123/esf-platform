#requires -Version 5.1
<#
  One-command release for ESF Platform.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.4.15 -Notes "0.4.15 ..."

  What it does:
    1. bump esf-launcher/package.json + package-lock.json
    2. eslint + node test + vite build
    3. git commit + tag + push (main)
    4. wait for GitHub release assets, download, verify sha512 against latest.yml
    5. deploy to both API boxes over WinRM (assets + .env + notice + restart)
    6. verify public endpoints (latest.yml / HEAD / Range / both /api/config)

  Secrets are read from:
    %TEMP%\esf-newbox.pwd           new box administrator password
    %TEMP%\esf-jump\esfops.pwd      old box esfops password

  ASCII only on purpose: PowerShell 5.1 reads UTF-8 scripts as ANSI.
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Notes,
  [switch]$SkipDeploy,
  [switch]$SkipWait
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
$launcher = Join-Path $root 'esf-launcher'

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must be like 0.4.15" }

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }

# ---------------------------------------------------------------- 1. bump
Step "bump version to $Version"
Push-Location $launcher
node -e "const fs=require('fs');const v=process.argv[1];if(!v)throw new Error('no version');for(const f of ['package.json','package-lock.json']){const p=JSON.parse(fs.readFileSync(f,'utf8'));p.version=v;if(p.packages&&p.packages['']){p.packages[''].version=v}fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n')}" "$Version"
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "bump failed" }

# ---------------------------------------------------------------- 2. checks
Step "lint + tests + build"
npx.cmd eslint src main.cjs api.cjs preload.js store.cjs launcher-core.cjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "eslint failed" }

node --test tests/
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "tests failed" }

npm.cmd run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "build failed" }
Pop-Location

# ---------------------------------------------------------------- 3. commit
Step "commit + tag + push"
$files = @(
  'CHANGELOG.md',
  'esf-launcher/package.json',
  'esf-launcher/package-lock.json',
  'esf-launcher/dist',
  'esf-launcher/api.cjs',
  'esf-launcher/main.cjs',
  'esf-launcher/preload.js',
  'esf-launcher/src',
  'server',
  'deploy/ops-agent',
  'scripts/release.ps1',
  'docs/kb',
  'docs/design'
)
git add -A -- $files
$msg = "release: v$Version`n`n$Notes"
git commit -m $msg
if ($LASTEXITCODE -ne 0) {
  $staged = @(git diff --cached --name-only)
  if ($staged.Count -eq 0) {
    Write-Host "nothing new to commit (version already prepared), continue"
  } else {
    throw "commit failed"
  }
}
$tagExists = @(git tag --list "v$Version")
if ($tagExists.Count -eq 0) {
  git tag "v$Version"
} else {
  Write-Host "tag v$Version already exists, skip"
}
git push origin main
git push origin "v$Version"
if ($LASTEXITCODE -ne 0) { throw "push failed" }

# ---------------------------------------------------------------- 4. assets
$out = "C:\esf-release\$Version"
New-Item -ItemType Directory -Force -Path $out | Out-Null
if (-not $SkipWait) {
  Step "wait for GitHub release v$Version"
  $api = "https://api.github.com/repos/xiaolouxi123/esf-platform/releases/tags/v$Version"
  $deadline = (Get-Date).AddMinutes(12)
  while ((Get-Date) -lt $deadline) {
    try {
      $rel = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'esf-release' } -TimeoutSec 20
      $names = @($rel.assets | ForEach-Object { $_.name })
      if ($names -contains "ESF-Platform-Setup-$Version.exe" -and $names -contains 'latest.yml') {
        Write-Host "release ready: $($names -join ', ')"
        break
      }
    } catch {
      Write-Host "waiting: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 15
  }
}

Step "download + verify assets"
$base = "https://github.com/xiaolouxi123/esf-platform/releases/download/v$Version"
$mirrorBase = "https://ghfast.top/$base"
$exeName = "ESF-Platform-Setup-$Version.exe"

# small files first (fast), then the exe in parallel chunks through a mirror
foreach ($name in @("ESF-Platform-Setup-$Version.exe.blockmap", 'latest.yml')) {
  $dest = Join-Path $out $name
  $ok = $false
  for ($try = 1; $try -le 6; $try++) {
    & curl.exe -sL --retry 2 --max-time 60 -o $dest "$mirrorBase/$name" | Out-Null
    if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) { $ok = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ok) {
    & curl.exe -sL --retry 3 --max-time 120 -o $dest "$base/$name"
    if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) { $ok = $true }
  }
  if (-not $ok) { throw "download failed: $name" }
  Write-Host "asset $name $((Get-Item $dest).Length)"
}

$yml = Get-Content (Join-Path $out 'latest.yml') -Raw
$expected = ([regex]::Match($yml, 'sha512:\s*(\S+)')).Groups[1].Value
$size = [int64]([regex]::Match($yml, 'size:\s*(\d+)')).Groups[1].Value

$exe = Join-Path $out $exeName
$needDownload = $true
if (Test-Path $exe) {
  $have = (Get-Item $exe).Length
  if ($have -eq $size) {
    $h = [Convert]::ToBase64String([System.Security.Cryptography.SHA512]::Create().ComputeHash([System.IO.File]::ReadAllBytes($exe)))
    if ($h -eq $expected) { $needDownload = $false; Write-Host "asset $exeName already present and verified" }
  }
}

if ($needDownload) {
  $tmp = Join-Path $env:TEMP "esf-rel-chunks-$Version"
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null

  $n = 12
  $chunk = [int64][math]::Ceiling($size / $n)
  $mirrors = @("$mirrorBase/$exeName", "https://gh-proxy.com/$base/$exeName", "$base/$exeName")

  $block = {
    param($u1, $u2, $u3, $start, $end, $dest)
    $urls = @($u1, $u2, $u3)
    $want = $end - $start + 1
    foreach ($pass in 1..3) {
      foreach ($u in $urls) {
        & curl.exe -sL --retry 2 --retry-delay 2 --max-time 300 -r "$start-$end" -o $dest $u | Out-Null
        if ((Test-Path $dest) -and ((Get-Item $dest).Length -eq $want)) { return $want }
        Start-Sleep -Seconds 2
      }
    }
    if (Test-Path $dest) { return (Get-Item $dest).Length } else { return 0 }
  }

  $pair = 0
  while (($pair * 2) -lt $n) {
    $jobs = @()
    for ($k = 0; $k -lt 2; $k++) {
      $idx = $pair * 2 + $k
      if ($idx -ge $n) { break }
      $start = $idx * $chunk
      $end = [math]::Min($start + $chunk - 1, $size - 1)
      $want = $end - $start + 1
      $dest = Join-Path $tmp "part$idx"
      if ((Test-Path $dest) -and ((Get-Item $dest).Length -eq $want)) { continue }
      $jobs += Start-Job -ScriptBlock $block -ArgumentList "$mirrorBase/$exeName", "https://gh-proxy.com/$base/$exeName", "$base/$exeName", $start, $end, $dest
    }
    if ($jobs.Count -gt 0) {
      $jobs | Wait-Job -Timeout 600 | Out-Null
      $jobs | Remove-Job -Force
    }
    $pair++
  }

  $fs = [IO.File]::Create($exe)
  for ($idx = 0; $idx -lt $n; $idx++) {
    $start = $idx * $chunk
    $end = [math]::Min($start + $chunk - 1, $size - 1)
    $want = $end - $start + 1
    $dest = Join-Path $tmp "part$idx"
    $have = 0
    if (Test-Path $dest) { $have = (Get-Item $dest).Length }
    if ($have -ne $want) { $fs.Close(); throw "chunk $idx incomplete ($have/$want)" }
    $b = [IO.File]::ReadAllBytes($dest)
    $fs.Write($b, 0, $b.Length)
  }
  $fs.Close()
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "asset $exeName $((Get-Item $exe).Length)"
}

$exe = Join-Path $out "ESF-Platform-Setup-$Version.exe"
$yml = Get-Content (Join-Path $out 'latest.yml') -Raw
$expected = ([regex]::Match($yml, 'sha512:\s*(\S+)')).Groups[1].Value
$actual = [Convert]::ToBase64String([System.Security.Cryptography.SHA512]::Create().ComputeHash([System.IO.File]::ReadAllBytes($exe)))
if ($expected -ne $actual) { throw "sha512 mismatch" }
Write-Host "sha512 match, size $((Get-Item $exe).Length)"

if ($SkipDeploy) {
  Write-Host "`nrelease assets ready at $out (deploy skipped)" -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------- 5. deploy
$notesPath = Join-Path $env:TEMP "esf-notes-$Version.txt"
[System.IO.File]::WriteAllText($notesPath, $Notes, (New-Object System.Text.UTF8Encoding($false)))
$notesB64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($notesPath))

# generic notice updater, copied to each box
$noticeJs = @'
const dotenv = require('C:\\esf\\server\\node_modules\\dotenv');
dotenv.config({ path: 'C:\\esf\\server\\.env' });
const mysql = require('C:\\esf\\server\\node_modules\\mysql2\\promise');
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });
  await conn.execute("UPDATE platform_settings SET setting_value = ? WHERE setting_key = 'notice'", [process.env.RELEASE_NOTES]);
  await conn.end();
  console.log('notice updated');
})().catch((err) => { console.error(err.message); process.exit(1); });
'@
$noticePath = Join-Path $env:TEMP "esf-release-notice-$Version.js"
[System.IO.File]::WriteAllText($noticePath, $noticeJs, (New-Object System.Text.UTF8Encoding($false)))

function Deploy-Box {
  param($Computer, $Credential, $Label)
  $s = New-PSSession -ComputerName $Computer -Credential $Credential -Authentication Negotiate
  try {
    foreach ($name in @("ESF-Platform-Setup-$Version.exe", "ESF-Platform-Setup-$Version.exe.blockmap", 'latest.yml')) {
      Copy-Item -ToSession $s -Path (Join-Path $out $name) -Destination "C:\esf\updates\$name" -Force
    }
    Copy-Item -ToSession $s -Path $noticePath -Destination 'C:\esf\server\scripts\release-notice.js' -Force

    $text = Invoke-Command -Session $s -ArgumentList $notesB64, $Version -ScriptBlock {
      param($b64, $ver)
      $notesText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64)).Trim()
      $envPath = 'C:\esf\server\.env'
      $enc = New-Object System.Text.UTF8Encoding($false)
      $lines = [System.IO.File]::ReadAllText($envPath, $enc) -split "`r?`n"
      for ($i = 0; $i -lt $lines.Length; $i++) {
        $line = $lines[$i]
        if ($line -like 'LATEST_VERSION=*') { $lines[$i] = "LATEST_VERSION=$ver" }
        elseif ($line -like 'DOWNLOAD_URL=*') { $lines[$i] = "DOWNLOAD_URL=https://119.29.82.217/updates/ESF-Platform-Setup-$ver.exe" }
        elseif ($line -like 'RELEASE_NOTES=*') { $lines[$i] = 'RELEASE_NOTES=' + $notesText }
      }
      [System.IO.File]::WriteAllText($envPath, ($lines -join "`r`n"), $enc)

      Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
      Start-Sleep -Seconds 1
      schtasks /run /tn ESFAPI | Out-Null
      Start-Sleep -Seconds 6
      $h = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 10
      $c = Invoke-RestMethod 'http://127.0.0.1:3000/api/config' -TimeoutSec 10
      $nodeExe = if (Test-Path 'C:\esf\node\node.exe') { 'C:\esf\node\node.exe' } else { (Get-Command node.exe).Source }
      $noticeOut = & $nodeExe 'C:\esf\server\scripts\release-notice.js' 2>&1
      "health ok=$($h.ok) db=$($h.data.db) up=$($h.data.uptimeSec)"
      "config latest=$($c.data.latestVersion)"
      "notice: $($noticeOut | Select-Object -Last 1)"
    }
    $text | Where-Object { $_ } | ForEach-Object { "$Label $_" }
  } finally {
    if ($s) { $s | Remove-PSSession }
  }
}

Step "deploy to both boxes"
$newPwd = (Get-Content "$env:TEMP\esf-newbox.pwd" -Raw).Trim()
$newCred = New-Object System.Management.Automation.PSCredential('administrator', (ConvertTo-SecureString $newPwd -AsPlainText -Force))
Deploy-Box -Computer '119.29.82.217' -Credential $newCred -Label 'new:'

$oldPwd = (Get-Content "$env:TEMP\esf-jump\esfops.pwd" -Raw).Trim()
$oldCred = New-Object System.Management.Automation.PSCredential('esfops', (ConvertTo-SecureString $oldPwd -AsPlainText -Force))
Deploy-Box -Computer '119.91.99.176' -Credential $oldCred -Label 'old:'

# ---------------------------------------------------------------- 6. verify
Step "verify public endpoints"
$r = Invoke-WebRequest 'https://119.29.82.217/updates/latest.yml' -UseBasicParsing -TimeoutSec 20
Write-Host "latest.yml $($r.StatusCode) len=$($r.RawContentLength) version=$((([regex]::Match($r.Content, 'version:\s*(\S+)')).Groups[1].Value))"

$h = Invoke-WebRequest "https://119.29.82.217/updates/ESF-Platform-Setup-$Version.exe" -Method Head -UseBasicParsing -TimeoutSec 30
Write-Host "exe HEAD $($h.StatusCode) len=$($h.Headers['Content-Length'])"

$range = & curl.exe -s -o NUL -w "%{http_code} %{size_download}" -r 0-99 "https://119.29.82.217/updates/ESF-Platform-Setup-$Version.exe"
Write-Host "range: $range"

foreach ($hostUrl in @('http://119.29.82.217:3000', 'http://119.91.99.176:3000')) {
  $cfg = Invoke-RestMethod "$hostUrl/api/config" -TimeoutSec 15
  Write-Host "$hostUrl latest=$($cfg.data.latestVersion)"
}

Write-Host "`nDONE v$Version" -ForegroundColor Green
