#Requires -RunAsAdministrator
<#
  ESF 平台 · 公网隧道（不需要开安全组端口）
  原理：用 Cloudflare 免费快速隧道，把本机 3000 端口映射到一个 https 公网地址。
  注意：快速隧道的地址每次重启都会变，适合临时联调；正式使用建议让云服务器主人放行 3000。
#>

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Root = 'C:\esf'
$exe = Join-Path $Root 'cloudflared.exe'
$localApi = 'http://127.0.0.1:3000'

if (-not (Test-Path $Root)) { New-Item -ItemType Directory -Force -Path $Root | Out-Null }

# 1. 下载 cloudflared
if (-not (Test-Path $exe) -or (Get-Item $exe).Length -lt 10MB) {
  $urls = @(
    'https://ghproxy.net/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
    'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  )

  $downloaded = $false
  foreach ($url in $urls) {
    try {
      Write-Host "下载 cloudflared: $url"
      Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing -TimeoutSec 900 -ErrorAction Stop
      if ((Test-Path $exe) -and (Get-Item $exe).Length -gt 10MB) {
        $downloaded = $true
        break
      }
    } catch {
      Write-Host "失败：$($_.Exception.Message)" -ForegroundColor Yellow
    }
  }

  if (-not $downloaded) {
    Write-Host ''
    Write-Host 'cloudflared 下载失败。' -ForegroundColor Red
    Write-Host '请把 cloudflared.exe 手动放到 C:\esf\cloudflared.exe 后重跑本脚本。'
    Write-Host '下载地址（任选）：'
    Write-Host '  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    Read-Host '按回车退出'
    exit 1
  }
}

# 2. 先确认本机后端在跑
try {
  $health = Invoke-RestMethod -Uri "$localApi/api/health" -TimeoutSec 5
  if ($health.ok -ne $true) { throw 'health not ok' }
  Write-Host '本机后端正常，开始建立隧道…' -ForegroundColor Green
} catch {
  Write-Host "本机 $localApi 不可用，请先确认 ESFAPI 任务已启动。" -ForegroundColor Red
  Read-Host '按回车退出'
  exit 1
}

# 3. 启动隧道并抓取公网地址
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.Arguments = "tunnel --url $localApi --no-autoupdate --loglevel info"
$psi.UseShellExecute = $false
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $false

Write-Host '等待 Cloudflare 分配地址（约 5~15 秒）…'
$proc = [System.Diagnostics.Process]::Start($psi)
$publicUrl = ''

while (-not $proc.HasExited) {
  $line = $proc.StandardError.ReadLine()
  if ($null -eq $line) { Start-Sleep -Milliseconds 200; continue }

  Write-Host $line
  if ($line -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com') {
    $publicUrl = $Matches[0]
    break
  }
}

if ($publicUrl -eq '') {
  Write-Host ''
  Write-Host '没有拿到公网地址。请把上面的输出截图发给管理员。' -ForegroundColor Red
  Read-Host '按回车退出'
  exit 1
}

$publicUrl | Set-Content -Path (Join-Path $Root 'public-url.txt') -Encoding ASCII

Write-Host ''
Write-Host '============================================' -ForegroundColor Cyan
Write-Host ' 公网地址（发给朋友填到启动器里）：' -ForegroundColor Cyan
Write-Host " $publicUrl" -ForegroundColor Green
Write-Host ''
Write-Host " 健康检查: $publicUrl/api/health" -ForegroundColor Gray
Write-Host '============================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '这个窗口不要关，关掉隧道就断了。'
Write-Host '按 Ctrl+C 可以停止。'

# 保持窗口并继续转发日志
while (-not $proc.HasExited) {
  $line = $proc.StandardError.ReadLine()
  if ($null -ne $line) { Write-Host $line }
  Start-Sleep -Milliseconds 100
}
