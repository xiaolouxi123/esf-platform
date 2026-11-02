#Requires -RunAsAdministrator
<#
  ESF 平台 · Windows 服务器一键部署
  适用：Windows Server 2012 R2 / 2016 / 2019 / 2022（x64）

  做的事：
    1. 安装 Node.js 18（已装则跳过）
    2. 安装独立 MySQL 8.0（端口 3307，仅 127.0.0.1 可连）
    3. 生成 .env、部署后端、建库建表、创建应用账号
    4. 注册 Windows 服务 ESFAPI + 防火墙放行 3000

  用法：
    1. 把 esf-server-bundle.zip 和本脚本复制到服务器 C:\esf-setup\
    2. 管理员 PowerShell 执行：
       powershell -ExecutionPolicy Bypass -File C:\esf-setup\deploy-esf-server.ps1
#>

$ErrorActionPreference = 'Continue'   # 外部程序写 stderr 时不要中止脚本（npm/mysql 警告很常见）
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# ==================== 可改参数 ====================
$Root      = 'C:\esf'
$SetupDir  = 'C:\esf-setup'
$ApiPort   = 3000
$DbPort    = 3307
$LatestVer = '0.2.1'
$ServerIp  = '114.132.84.150'
# =================================================

$NodeUrl  = 'https://npmmirror.com/mirrors/node/v18.20.8/node-v18.20.8-x64.msi'
$MysqlUrl = 'https://mirrors.163.com/mysql/Downloads/MySQL-8.0/mysql-8.0.28-winx64.zip'
$NssmUrl  = 'https://nssm.cc/release/nssm-2.24.zip'

function Step($msg) {
  Write-Host ''
  Write-Host "===== $msg =====" -ForegroundColor Cyan
}

function Download($url, $out) {
  if (Test-Path $out) { return }
  Write-Host "下载 $url"
  Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 900 -ErrorAction Stop
  if (-not (Test-Path $out)) { throw "下载失败: $url" }
}

function Random-Hex([int]$bytes) {
  $buf = New-Object byte[] $bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($buf)
  ($buf | ForEach-Object { $_.ToString('x2') }) -join ''
}

function Write-MysqlCnf([string]$password) {
  $cnf = Join-Path $Root 'mysql-root.cnf'
  @"
[client]
host=127.0.0.1
port=$DbPort
user=root
password=$password
"@ | Set-Content -Path $cnf -Encoding ASCII
  return $cnf
}

function Test-Tcp([string]$targetHost, [int]$port, [int]$timeoutMs = 1500) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($targetHost, $port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne($timeoutMs) -and $client.Connected
    $client.Close()
    return $ok
  } catch {
    return $false
  }
}

function Wait-Tcp([string]$targetHost, [int]$port, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Tcp $targetHost $port) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

# ---------- 0. 环境检查 ----------
Step '0/7 环境检查'
Write-Host ([Environment]::OSVersion.VersionString)
$os = [Environment]::OSVersion.Version
if ($os.Build -lt 14393) {
  Write-Host '提示：系统低于 Server 2016，MySQL 8 不是官方支持平台，脚本仍会尝试。' -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path $Root, "$Root\logs", "$Root\uploads", "$Root\updates" | Out-Null
New-Item -ItemType Directory -Force -Path $SetupDir | Out-Null

$bundle = Join-Path $SetupDir 'esf-server-bundle.zip'
if (-not (Test-Path $bundle)) {
  throw "缺少 $bundle。请把 esf-server-bundle.zip 和本脚本放在同一个目录（$SetupDir）"
}

# ---------- 0.5 VC++ 运行库（Node / MySQL 依赖） ----------
if (-not (Test-Path "$env:SystemRoot\System32\vcruntime140_1.dll")) {
  $vcUrl = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
  $vcExe = Join-Path $SetupDir 'vc_redist.x64.exe'
  Download $vcUrl $vcExe
  Write-Host '安装 VC++ 运行库…'
  Start-Process $vcExe -ArgumentList '/install /quiet /norestart' -Wait
}
# ---------- 1. Node.js ----------
Step '1/7 检查 Node.js'
$needNode = $true
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCmd) {
  $ver = (& node.exe -v).Trim()
  $major = [int]($ver.TrimStart('v').Split('.')[0])
  Write-Host "已安装 Node $ver"
  if ($major -ge 18) { $needNode = $false }
}

if ($needNode) {
  $msi = Join-Path $SetupDir 'node-v18.20.8-x64.msi'
  Download $NodeUrl $msi
  Write-Host '安装 Node.js 18…'
  $p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "Node.js 安装失败，msiexec 退出码 $($p.ExitCode)" }
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
}

$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$npmCmd  = (Get-Command npm.cmd -ErrorAction Stop).Source
Write-Host "Node: $nodeExe"
& node.exe -v

# ---------- 2. MySQL ----------
Step '2/7 检查并启动 MySQL'
$mysqlService = Get-Service -Name 'ESFMySQL' -ErrorAction SilentlyContinue
$mysqlExe     = Join-Path $Root 'mysql\bin\mysqld.exe'
$mysqlClient  = Join-Path $Root 'mysql\bin\mysql.exe'
$myIni        = Join-Path $Root 'my.ini'
$dataDir      = Join-Path $Root 'mysql-data'
$freshMysql   = $false

if (-not $mysqlService) {
  if (Test-Tcp '127.0.0.1' $DbPort) {
    throw "端口 $DbPort 已被其它程序占用。请先释放，或把本脚本的 DbPort 改成别的端口。"
  }

  if (-not (Test-Path $mysqlExe)) {
    $zip = Join-Path $SetupDir 'mysql-8.0.28-winx64.zip'
    Download $MysqlUrl $zip

    Write-Host '解压 MySQL…'
    $tmp = Join-Path $Root 'mysql-tmp'
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if (-not $inner) { throw 'MySQL 压缩包结构异常' }
    if (Test-Path (Join-Path $Root 'mysql')) { Remove-Item (Join-Path $Root 'mysql') -Recurse -Force }
    Move-Item $inner.FullName (Join-Path $Root 'mysql')
    Remove-Item $tmp -Recurse -Force
  }

  @"
[mysqld]
basedir=C:/esf/mysql
datadir=C:/esf/mysql-data
port=$DbPort
bind-address=127.0.0.1
character-set-server=utf8mb4
collation-server=utf8mb4_0900_ai_ci
default-authentication-plugin=mysql_native_password
max_connections=100
skip-name-resolve=0

[client]
port=$DbPort
default-character-set=utf8mb4
"@ | Set-Content -Path $myIni -Encoding ASCII

  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  if (-not (Get-ChildItem $dataDir -Force)) {
    Write-Host '初始化 MySQL 数据目录…'
    & $mysqlExe --defaults-file="$myIni" --initialize-insecure --console
    if ($LASTEXITCODE -ne 0) { throw 'MySQL 初始化失败，请看上方输出' }
  }

  Write-Host '注册 MySQL 服务…'
  & $mysqlExe --install ESFMySQL --defaults-file="$myIni"
  if ($LASTEXITCODE -ne 0) { throw 'MySQL 服务注册失败' }
  $freshMysql = $true
}

Set-Service -Name 'ESFMySQL' -StartupType Automatic
if ((Get-Service 'ESFMySQL').Status -ne 'Running') { Start-Service 'ESFMySQL' }

if (-not (Wait-Tcp '127.0.0.1' $DbPort 90)) {
  throw "MySQL 没有在 127.0.0.1:$DbPort 起来，请查看 C:\esf\mysql-data 与事件查看器"
}
Write-Host "MySQL 已就绪：127.0.0.1:$DbPort"

# ---------- 3. 账号与 .env ----------
Step '3/7 生成配置与数据库 root 密码'
$envFile = Join-Path $Root 'server\.env'
$existingEnv = Test-Path $envFile

$rootPass = ''
if ($existingEnv) {
  $line = Get-Content $envFile | Where-Object { $_ -like 'DB_ROOT_PASSWORD=*' } | Select-Object -First 1
  if ($line) { $rootPass = $line.Substring('DB_ROOT_PASSWORD='.Length).Trim() }
}
if ($rootPass -eq '') { $rootPass = Random-Hex 16 }

# 1) 先用“已知密码”试；2) 再试空密码；3) 都不行就用 init-file 建 root@127.0.0.1
$rootReady = $false
$rootCnf = Write-MysqlCnf $rootPass
& $mysqlClient --defaults-extra-file=$rootCnf -e "SELECT 1;" 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { $rootReady = $true }

if (-not $rootReady) {
  & $mysqlClient --host=127.0.0.1 --port=$DbPort --user=root --skip-password -e "SELECT 1;" 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host '为 MySQL root 设置密码（localhost + 127.0.0.1）…'
    & $mysqlClient --host=127.0.0.1 --port=$DbPort --user=root --skip-password -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '$rootPass'; CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED WITH mysql_native_password BY '$rootPass'; GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION; FLUSH PRIVILEGES;"
    if ($LASTEXITCODE -ne 0) { throw 'root 账号初始化失败' }
    $rootReady = $true
  }
}

if (-not $rootReady) {
  Write-Host '通过 init-file 创建 root@127.0.0.1（仅首次需要）…'
  $initSql = Join-Path $Root 'mysql-init.sql'
  @"
CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED WITH mysql_native_password BY '$rootPass';
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '$rootPass';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;
FLUSH PRIVILEGES;
"@ | Set-Content -Path $initSql -Encoding ASCII

  Stop-Service 'ESFMySQL' -Force
  Start-Sleep -Seconds 2
  $proc = Start-Process -FilePath $mysqlExe `
    -ArgumentList @("--defaults-file=$myIni", "--init-file=$initSql") `
    -PassThru -WindowStyle Hidden
  if (-not (Wait-Tcp '127.0.0.1' $DbPort 90)) { throw 'MySQL 用 init-file 启动失败，请查看事件查看器' }
  Start-Sleep -Seconds 3

  & $mysqlClient --defaults-extra-file=$rootCnf -e "SHUTDOWN;" 2>$null | Out-Null
  Start-Sleep -Seconds 3
  if (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) { Stop-Process -Id $proc.Id -Force }
  Remove-Item $initSql -Force -ErrorAction SilentlyContinue

  Start-Service 'ESFMySQL'
  if (-not (Wait-Tcp '127.0.0.1' $DbPort 90)) { throw 'MySQL 重启失败' }
}

# 最终验证一次（必须能走 TCP + 密码）
& $mysqlClient --defaults-extra-file=$rootCnf -e "SELECT 1;" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw "root@127.0.0.1 登录失败，请手动检查 MySQL 账号" }
Write-Host 'root 账号已就绪（TCP + 密码）'

if (-not $existingEnv) {
  $jwt      = Random-Hex 32
  $dbPass   = Random-Hex 16
  $amxxPass = Random-Hex 16
  New-Item -ItemType Directory -Force -Path (Join-Path $Root 'server') | Out-Null

  @"
NODE_ENV=production
HOST=0.0.0.0
API_PORT=$ApiPort
VERSION_LABEL=prod

JWT_SECRET=$jwt
JWT_TTL_SECONDS=604800
BCRYPT_ROUNDS=10

DB_HOST=127.0.0.1
DB_PORT=$DbPort
DB_NAME=esf_platform
DB_USER=esf_app
DB_PASSWORD=$dbPass
DB_ALLOWED_HOST=127.0.0.1
DB_ROOT_USER=root
DB_ROOT_PASSWORD=$rootPass

AMXX_DB_USER=esf_amxx
AMXX_DB_PASSWORD=$amxxPass
AMXX_ALLOWED_HOST=127.0.0.1

UPLOAD_DIR=C:\esf\uploads
UPDATE_DIR=C:\esf\updates

LATEST_VERSION=$LatestVer
RELEASE_NOTES=首个公网测试版本
MIN_LAUNCHER_VERSION=$LatestVer
UPDATE_FEED_URL=http://${ServerIp}:$ApiPort/updates/
DOWNLOAD_URL=http://${ServerIp}:$ApiPort/updates/
"@ | Set-Content -Path $envFile -Encoding ASCII
  Write-Host "已生成 $envFile"
} else {
  Write-Host "$envFile 已存在，保留原配置"
}

# ---------- 4. 部署代码 ----------
Step '4/7 部署后端代码'
$serverDir = Join-Path $Root 'server'
New-Item -ItemType Directory -Force -Path $serverDir | Out-Null
Expand-Archive -Path $bundle -DestinationPath $serverDir -Force
if (-not (Test-Path (Join-Path $serverDir 'package.json'))) { throw "解压失败，请检查 $bundle" }
Write-Host "代码已解压到 $serverDir"

Write-Host '安装后端依赖（npmmirror）…'
Push-Location $serverDir
try {
  & $npmCmd install --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com
  if ($LASTEXITCODE -ne 0) { throw 'npm install 失败' }
} finally {
  Pop-Location
}

# ---------- 5. 建库 ----------
Step '5/7 建库、建表、创建应用账号'
Push-Location $serverDir
try {
  & node.exe scripts\migrate.js
  if ($LASTEXITCODE -ne 0) { throw '数据库迁移失败，请看上方输出' }
} finally {
  Pop-Location
}

Remove-Item $rootCnf -Force -ErrorAction SilentlyContinue

# ---------- 6. 服务 ----------
Step '6/7 注册 Windows 服务 ESFAPI'
$nssm = Join-Path $Root 'nssm.exe'
if (-not (Test-Path $nssm)) {
  $nssmZip = Join-Path $SetupDir 'nssm-2.24.zip'
  Download $NssmUrl $nssmZip
  $nssmTmp = Join-Path $Root 'nssm-tmp'
  if (Test-Path $nssmTmp) { Remove-Item $nssmTmp -Recurse -Force }
  Expand-Archive -Path $nssmZip -DestinationPath $nssmTmp -Force
  $nssmSrc = Get-ChildItem $nssmTmp -Recurse -Filter 'nssm.exe' |
    Where-Object { $_.FullName -match 'win64' } | Select-Object -First 1
  if (-not $nssmSrc) { $nssmSrc = Get-ChildItem $nssmTmp -Recurse -Filter 'nssm.exe' | Select-Object -First 1 }
  Copy-Item $nssmSrc.FullName $nssm -Force
  Remove-Item $nssmTmp -Recurse -Force
}

cmd /c "`"$nssm`" stop ESFAPI >nul 2>&1"
cmd /c "`"$nssm`" remove ESFAPI confirm >nul 2>&1"
Start-Sleep -Seconds 1

& $nssm install ESFAPI $nodeExe 'src\server.js'
& $nssm set ESFAPI AppDirectory $serverDir
& $nssm set ESFAPI AppStdout (Join-Path $Root 'logs\api.out.log')
& $nssm set ESFAPI AppStderr (Join-Path $Root 'logs\api.err.log')
& $nssm set ESFAPI AppRotateFiles 1
& $nssm set ESFAPI AppRotateBytes 10485760
& $nssm set ESFAPI Start SERVICE_AUTO_START
& $nssm set ESFAPI AppRestartDelay 5000
Start-Service ESFAPI
Start-Sleep -Seconds 2
if ((Get-Service ESFAPI).Status -ne 'Running') { throw 'ESFAPI 服务没有启动，请看 C:\esf\logs\api.err.log' }
Write-Host '服务已启动'

# ---------- 7. 健康检查 ----------
Step '7/7 健康检查与防火墙'
$ruleName = 'ESF API 3000'
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $ApiPort -Action Allow -Profile Any | Out-Null

$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/api/health" -TimeoutSec 3
    if ($health.ok -eq $true) { $ok = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}

Write-Host ''
if ($ok) {
  Write-Host '✅ 后端已在本机健康运行' -ForegroundColor Green
  Write-Host ("   本机: http://127.0.0.1:{0}/api/health" -f $ApiPort)
  Write-Host ("   公网: http://{0}:{1}/api/health（需在腾讯云安全组放行 TCP {1}）" -f $ServerIp, $ApiPort)
} else {
  Write-Host '⚠ 健康检查未通过，请查看 C:\esf\logs\api.err.log' -ForegroundColor Yellow
}

$cred = Join-Path $Root 'CREDENTIALS.txt'
@"
ESF 平台服务器凭证（保存后请删除本文件）

MySQL root: root / $rootPass
应用账号 : 见 C:\esf\server\.env 的 DB_PASSWORD
AMXX账号 : 见 C:\esf\server\.env 的 AMXX_DB_PASSWORD
后端目录 : C:\esf\server
更新目录 : C:\esf\updates
服务名   : ESFAPI
日志     : C:\esf\logs
"@ | Set-Content -Path $cred -Encoding UTF8
Write-Host "凭证已写入 $cred" -ForegroundColor Yellow

Write-Host ''
Write-Host '下一步（必须手动）：' -ForegroundColor Cyan
Write-Host "1. 腾讯云控制台 → 安全组/防火墙 → 入站 TCP $ApiPort → 0.0.0.0/0"
Write-Host "2. 浏览器打开 http://${ServerIp}:$ApiPort/api/health，应返回 ok: true"
Write-Host "3. 把安装包和 latest.yml 放进 C:\esf\updates\（自动更新用）"
Write-Host "4. 回到对话告诉我：脚本执行完了 + 安全组已放行 $ApiPort"
