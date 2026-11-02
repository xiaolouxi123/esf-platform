# ESF 本地测试服 · 一键启动
# 作用：启动 MySQL(3307) + 后端(3000) + 公网 SSH 隧道，并打印公网地址
# 用法：右键 启动本地测试服.bat → 以管理员身份运行

$ErrorActionPreference = 'Continue'
$Root = 'C:\Users\Administrator\Desktop\esf-launcher'
$Run = Join-Path $Root '.run'
$Server = Join-Path $Root 'server'
New-Item -ItemType Directory -Force -Path $Run | Out-Null

function Test-Tcp([string]$targetHost, [int]$port) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($targetHost, $port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(1200) -and $client.Connected
    $client.Close()
    return $ok
  } catch { return $false }
}

# 挂机测试：禁止睡眠/休眠（屏幕可以关）
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
powercfg /change disk-timeout-ac 0 | Out-Null

Write-Host '===== 1/3 MySQL =====' -ForegroundColor Cyan
if (-not (Test-Tcp '127.0.0.1' 3307)) {
  Push-Location $Server
  try { & node.exe scripts\dev-db.cjs start } finally { Pop-Location }
  Start-Sleep -Seconds 4
}
if (Test-Tcp '127.0.0.1' 3307) { Write-Host 'MySQL OK (3307)' -ForegroundColor Green }
else { Write-Host 'MySQL 没起来，请查看 .run\mysqld.err' -ForegroundColor Red; Read-Host '回车退出'; exit 1 }

Write-Host '===== 2/3 后端 API =====' -ForegroundColor Cyan
$apiOk = $false
try {
  $h = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 3
  if ($h.ok -eq $true) { $apiOk = $true }
} catch { }

if (-not $apiOk) {
  $p = Start-Process -FilePath 'node' -ArgumentList 'src/server.js' -WorkingDirectory $Server `
    -RedirectStandardOutput (Join-Path $Run 'api.out.log') `
    -RedirectStandardError (Join-Path $Run 'api.err.log') `
    -PassThru -WindowStyle Hidden
  $p.Id | Set-Content (Join-Path $Run 'api.pid')
  Start-Sleep -Seconds 5
  try {
    $h = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 3
    if ($h.ok -eq $true) { $apiOk = $true }
  } catch { }
}
if ($apiOk) { Write-Host 'API OK (3000)' -ForegroundColor Green }
else { Write-Host 'API 启动失败，查看 .run\api.err.log' -ForegroundColor Red; Read-Host '回车退出'; exit 1 }

Write-Host '===== 3/3 公网隧道 =====' -ForegroundColor Cyan
# 停掉旧隧道
$oldPidFile = Join-Path $Run 'ssh-tunnel.pid'
if (Test-Path $oldPidFile) {
  $oldPid = Get-Content $oldPidFile -ErrorAction SilentlyContinue
  if ($oldPid) { Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue }
}

$ssh = (Get-Command ssh.exe -ErrorAction SilentlyContinue)
if (-not $ssh) {
  Write-Host '系统没有 ssh.exe，无法建立隧道。' -ForegroundColor Red
  Read-Host '回车退出'; exit 1
}

$outLog = Join-Path $Run 'ssh-tunnel.out.log'
$errLog = Join-Path $Run 'ssh-tunnel.err.log'
Remove-Item $outLog, $errLog -Force -ErrorAction SilentlyContinue

$args = @(
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=3',
  '-o', 'ExitOnForwardFailure=yes',
  '-R', '80:127.0.0.1:3000',
  'nokey@localhost.run'
)
$proc = Start-Process -FilePath $ssh.Source -ArgumentList $args `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog `
  -PassThru -WindowStyle Hidden
$proc.Id | Set-Content $oldPidFile

Write-Host '等待分配公网地址（约 10~20 秒）…'
$url = ''
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 2
  $text = (Get-Content $outLog -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content $errLog -Raw -ErrorAction SilentlyContinue)
  $text = $text -replace "`e\[[0-9;]*m", ''
  $m = [regex]::Match($text, 'https://[a-z0-9]+\.lhr\.life')
  if ($m.Success) { $url = $m.Value; break }
}

if ($url -eq '') {
  Write-Host '没有拿到公网地址，日志：' -ForegroundColor Red
  Get-Content $errLog -Tail 12 -ErrorAction SilentlyContinue
  Read-Host '回车退出'; exit 1
}

$url | Set-Content (Join-Path $Run 'public-url.txt') -Encoding ASCII
$url | Set-Content "$env:USERPROFILE\Desktop\ESF-服务器地址.txt" -Encoding UTF8

Write-Host ''
Write-Host '============================================' -ForegroundColor Cyan
Write-Host ' 公网地址（填到启动器 → 服务器设置）：' -ForegroundColor Cyan
Write-Host " $url" -ForegroundColor Green
Write-Host " 健康检查: $url/api/health" -ForegroundColor Gray
Write-Host '============================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '这台电脑保持开机、不睡眠；隧道进程关掉地址就失效。'
Read-Host '按回车关闭这个窗口（不会停隧道）'
