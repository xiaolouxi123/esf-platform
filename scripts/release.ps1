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
    5. deploy to both API boxes over WinRM (assets + server bundle + migrate + .env + restart)
    6. verify public endpoints (latest.yml / HEAD / Range / both /api/config)

  Use -SkipServerDeploy to keep the live server code untouched.

  Secrets are read from:
    %TEMP%\esf-newbox.pwd           new box administrator password
    %TEMP%\esf-jump\esfops.pwd      old box esfops password

  ASCII only on purpose: PowerShell 5.1 reads UTF-8 scripts as ANSI.
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Notes,


  [switch]$SkipDeploy,
  [switch]$SkipServerDeploy,
  [switch]$SkipWait,
  [switch]$Approved
)

$ErrorActionPreference = "Stop"
# encoding guard (ASCII only: PS 5.1 reads UTF-8 without BOM as ANSI)
if ($Notes.IndexOf([char]0xFFFD) -ge 0 -or $Notes.IndexOf([char]0x95BA) -ge 0 -or $Notes.IndexOf([char]0x95B9) -ge 0) {
  throw "Notes looks corrupted (encoding). Save the release wrapper as UTF-8 with BOM."
}

# 发布闸门：必须先产出桌面审核版，用户实际点过并明确同意，才允许打 tag 发布。
if (-not $Approved) {
  throw "Release blocked: run 'npm run review:build' in esf-launcher, let the user review the desktop build, then rerun with -Approved."
}

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
$launcher = Join-Path $root 'esf-launcher'
$perf = [System.Diagnostics.Stopwatch]::StartNew()
$lastPerf = 0.0
function Mark($label) {
  $now = $perf.Elapsed.TotalSeconds
  $delta = $now - $script:lastPerf
  $script:lastPerf = $now
  Write-Host ("[perf] {0,6:N1}s (+{1,5:N1}s) {2}" -f $now, $delta, $label)
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must be like 0.4.15" }

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }

# ---------------------------------------------------------------- 1. bump
Step "bump version to $Version"
Push-Location $launcher
node -e "const fs=require('fs');const v=process.argv[1];if(!v)throw new Error('no version');for(const f of ['package.json','package-lock.json']){const p=JSON.parse(fs.readFileSync(f,'utf8'));p.version=v;if(p.packages&&p.packages['']){p.packages[''].version=v}fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n')}" "$Version"
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "bump failed" }

# 同步客户端「版本记录」（历史版本），保证每个版本都有说明
node "..\scripts\update-releases.js" "$Version" "$Notes"
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "update releases.json failed" }

# 以 package.json 为唯一来源，同步官网版本/下载链接/更新记录/sitemap
node "..\scripts\sync-versions.cjs"
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "sync versions failed" }

# 部署包必须由当前源码重建，否则 check-versions 会报「bundle 由旧版本构建」
# Node builder is the primary path since clean Windows boxes often have no Python.
node "..\scripts\build-server-bundle.cjs"
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "build-server-bundle.cjs failed" }

node "..\scripts\check-versions.cjs"
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "version consistency check failed" }
Mark "version sync + server bundle + checks"

# ---------------------------------------------------------------- 2. checks
Step "lint + tests + build"
npx.cmd eslint src main.cjs api.cjs preload.js store.cjs launcher-core.cjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "eslint failed" }

node --test tests/
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "tests failed" }

npm.cmd run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "build failed" }
Mark "lint + tests + vite build"
Pop-Location

# server bundle built in step 1; verify it before touching the live API.
$serverBundle = Join-Path $root 'deploy\esf-server-bundle.zip'
$serverBundleManifest = Join-Path $root 'deploy\esf-server-bundle.manifest.json'
$bundleSha = ''
$bundleSize = 0
$remoteBundle = ''
if (-not $SkipServerDeploy) {
  if (-not (Test-Path $serverBundle)) { throw "Missing $serverBundle (build-server-bundle.cjs did not run)" }
  if (-not (Test-Path $serverBundleManifest)) { throw "Missing $serverBundleManifest" }
  $mf = Get-Content -Raw -Path $serverBundleManifest | ConvertFrom-Json
  $bundleItem = Get-Item $serverBundle
  $bundleSha = (Get-FileHash $serverBundle -Algorithm SHA256).Hash.ToLower()
  $bundleSize = [int64]$bundleItem.Length
  if ([string]$mf.launcherVersion -ne $Version) { throw "server bundle is for $($mf.launcherVersion), not $Version" }
  if ($bundleSha -ne ([string]$mf.sha256).ToLower()) { throw "server bundle sha256 mismatch: $bundleSha vs $($mf.sha256)" }
  if ($bundleSize -ne [int64]$mf.size) { throw "server bundle size mismatch: $bundleSize vs $($mf.size)" }
  $remoteBundle = "C:\esf\server-bundles\esf-server-bundle-$Version.zip"
  Write-Host "server bundle $([math]::Round($bundleSize/1KB,1)) KB sha256=$($bundleSha.Substring(0,12)) files=$($mf.fileCount)"
} else {
  Write-Host 'server bundle deploy skipped' -ForegroundColor Yellow
}

# ---------------------------------------------------------------- 3. commit
Step "commit + tag + push"
$files = @(
  'CHANGELOG.md',
  'esf-launcher/package.json',
  'esf-launcher/package-lock.json',
  'esf-launcher/api.cjs',
  'esf-launcher/main.cjs',
  'esf-launcher/preload.js',
  'esf-launcher/store.cjs',
  'esf-launcher/launcher-core.cjs',
  'esf-launcher/archive.cjs',
  'esf-launcher/build',
  'esf-launcher/scripts',
  'esf-launcher/tests',
  'esf-launcher/src',
  'amxx',
  'server',
  'deploy/ops-agent',
  'scripts/release.ps1',
  'scripts/update-releases.js',
  'scripts/sync-versions.cjs',
  'scripts/check-versions.cjs',
  'scripts/build-server-bundle.py',
  'scripts/build-server-bundle.cjs',
  'docs/kb',
  'docs/design',
  'website',
  'deploy',
  '.github'
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
git push --atomic origin main "v$Version"
if ($LASTEXITCODE -ne 0) { throw "push failed" }
Mark "commit + tag + push"

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
    Start-Sleep -Seconds 8
  }
}
Mark "wait for GitHub release assets"

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
Mark "download + verify installer"

if ($SkipDeploy) {
  Write-Host "`nrelease assets ready at $out (deploy skipped)" -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------- 5. deploy
$notesPath = Join-Path $env:TEMP "esf-notes-$Version.txt"
[System.IO.File]::WriteAllText($notesPath, $Notes, (New-Object System.Text.UTF8Encoding($false)))
$notesB64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($notesPath))

# release settings writer: writes version/notes/download URL into the shared DB,
# so both API boxes serve the new release without touching the old box.
$releaseJs = @'
const dotenv = require('C:\\esf\\server\\node_modules\\dotenv');
dotenv.config({ path: 'C:\\esf\\server\\.env' });
const mysql = require('C:\\esf\\server\\node_modules\\mysql2\\promise');
(async () => {
  const [version, notesB64, downloadUrl] = process.argv.slice(2);
  const notes = Buffer.from(notesB64, 'base64').toString('utf8').trim();
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });
  const rows = [
    ['release_latest_version', version],
    ['release_notes', notes],
    ['release_download_url', downloadUrl],
    ['notice', notes],
  ];
  for (const [key, value] of rows) {
    await conn.execute(
      "INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
      [key, value]
    );
  }
  await conn.end();
  console.log('release settings updated');
})().catch((err) => { console.error(err.message); process.exit(1); });
'@
$releasePath = Join-Path $env:TEMP "esf-release-settings-$Version.js"
[System.IO.File]::WriteAllText($releasePath, $releaseJs, (New-Object System.Text.UTF8Encoding($false)))

function Deploy-NewBox {
  param($Computer, $Credential, $Label)
  $s = New-PSSession -ComputerName $Computer -Credential $Credential -Authentication Negotiate
  try {
    foreach ($name in @("ESF-Platform-Setup-$Version.exe", "ESF-Platform-Setup-$Version.exe.blockmap", 'latest.yml')) {
      Copy-Item -ToSession $s -Path (Join-Path $out $name) -Destination "C:\esf\updates\$name" -Force
    }
    Copy-Item -ToSession $s -Path $releasePath -Destination 'C:\esf\server\scripts\release-settings.js' -Force

    if (-not $SkipServerDeploy) {
      Invoke-Command -Session $s -ScriptBlock {
        param($dir)
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
      } -ArgumentList 'C:\esf\server-bundles'
      Copy-Item -ToSession $s -Path $serverBundle -Destination $remoteBundle -Force
    }

    $text = Invoke-Command -Session $s -ArgumentList $notesB64, $Version, $remoteBundle, $bundleSha, $bundleSize, [bool]$SkipServerDeploy -ScriptBlock {
      param($b64, $ver, $bundlePath, $bundleSha, $bundleSize, $skipServer)
      $nodeDir = 'C:\esf\node'
      $nodeExe = Join-Path $nodeDir 'node.exe'
      $npmCmd = Join-Path $nodeDir 'npm.cmd'
      if (-not (Test-Path $nodeExe)) { $nodeExe = (Get-Command node.exe).Source }
      if (-not (Test-Path $npmCmd)) { $npmCmd = (Get-Command npm.cmd).Source }
      $env:Path = "$nodeDir;$env:Path"

      $serverDeployed = $false
      $backupPath = ''
      if (-not $skipServer) {
        if (-not (Test-Path $bundlePath)) { throw "server bundle missing on host: $bundlePath" }
        $actualSha = (Get-FileHash $bundlePath -Algorithm SHA256).Hash.ToLower()
        if ($actualSha -ne $bundleSha) { throw 'uploaded server bundle sha256 mismatch' }
        if ((Get-Item $bundlePath).Length -ne [int64]$bundleSize) { throw 'uploaded server bundle size mismatch' }

        $serverDir = 'C:\esf\server'
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backupPath = "C:\esf\backups\server-src-pre-$ver-$stamp.zip"
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backupPath) | Out-Null
        $stageBackup = 'C:\esf\server-backup-stage'
        Remove-Item $stageBackup -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path $stageBackup | Out-Null
        foreach ($name in @('package.json', 'package-lock.json', 'src', 'sql', 'scripts', 'test')) {
          $src = Join-Path $serverDir $name
          if (Test-Path $src) { Copy-Item $src -Destination $stageBackup -Recurse -Force }
        }
        Compress-Archive -Path (Join-Path $stageBackup '*') -DestinationPath $backupPath -Force
        Remove-Item $stageBackup -Recurse -Force -ErrorAction SilentlyContinue

        Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
          ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 1

        $stage = 'C:\esf\server-staging'
        Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
        Expand-Archive -Path $bundlePath -DestinationPath $stage -Force
        Copy-Item (Join-Path $stage '*') $serverDir -Recurse -Force
        Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

        $deployError = ''
        Push-Location $serverDir
        try {
          New-Item -ItemType Directory -Force -Path 'C:\esf\logs' | Out-Null
          $npmLog = 'C:\esf\logs\server-bundle-npm.log'
          & $npmCmd install --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com *> $npmLog
          $npmCode = $LASTEXITCODE
          Get-Content $npmLog -Tail 30 -ErrorAction SilentlyContinue | ForEach-Object { "npm: $_" }
          if ($npmCode -ne 0) { throw "npm install failed with exit $npmCode" }

          $migrateLog = 'C:\esf\logs\server-bundle-migrate.log'
          & $nodeExe 'scripts\migrate.js' *> $migrateLog
          $migrateCode = $LASTEXITCODE
          Get-Content $migrateLog -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object { "migrate: $_" }
          if ($migrateCode -ne 0) { throw "migrate failed with exit $migrateCode" }
        } catch {
          $deployError = $_.Exception.Message
        } finally {
          Pop-Location
        }

        if ($deployError) {
          foreach ($name in @('src', 'sql', 'scripts', 'test', 'package.json', 'package-lock.json')) {
            $target = Join-Path $serverDir $name
            if (Test-Path $target) { Remove-Item $target -Recurse -Force }
          }
          Expand-Archive -Path $backupPath -DestinationPath $serverDir -Force
          schtasks /run /tn ESFAPI | Out-Null
          throw "server bundle deploy failed, rolled back to ${backupPath}: ${deployError}"
        }
        $serverDeployed = $true
        "server bundle applied, backup $backupPath"
      }

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

      if (-not $serverDeployed) {
        Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
          ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 1
      }
      schtasks /run /tn ESFAPI | Out-Null
      $h = $null
      for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 2
        try {
          $probe = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 5
          if ($probe.ok) { $h = $probe; break }
        } catch { }
      }
      if (-not $h) { throw 'API did not become healthy within 40s' }

      $dl = "https://119.29.82.217/updates/ESF-Platform-Setup-$ver.exe"
      $settingsOut = & $nodeExe 'C:\esf\server\scripts\release-settings.js' $ver $b64 $dl 2>&1
      $c = Invoke-RestMethod 'http://127.0.0.1:3000/api/config' -TimeoutSec 10
      "health ok=$($h.ok) db=$($h.data.db) up=$($h.data.uptimeSec)"
      "config latest=$($c.data.latestVersion) notes=$($c.data.releaseNotes.Length)chars"
      "settings: $($settingsOut | Select-Object -Last 1)"
    }
    $text | Where-Object { $_ } | ForEach-Object { "$Label $_" }
  } finally {
    if ($s) { $s | Remove-PSSession }
  }
}

Step "deploy assets + release settings to new box (old box reads shared DB)"
$newPwd = (Get-Content "$env:TEMP\esf-newbox.pwd" -Raw).Trim()
$newCred = New-Object System.Management.Automation.PSCredential('administrator', (ConvertTo-SecureString $newPwd -AsPlainText -Force))
Deploy-NewBox -Computer '119.29.82.217' -Credential $newCred -Label 'new:'

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

Mark "deploy + verify"
Write-Host "`nDONE v$Version" -ForegroundColor Green
