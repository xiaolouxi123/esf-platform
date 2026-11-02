# ESF 隧道守护：公网地址失效时自动重连，并把新地址写到桌面
$ErrorActionPreference = 'Continue'
$Root = 'C:\Users\Administrator\Desktop\esf-launcher'
$Run = Join-Path $Root '.run'
$Log = Join-Path $Run 'tunnel-watch.log'
$UrlFile = Join-Path $Run 'public-url.txt'
$DesktopFile = "$env:USERPROFILE\Desktop\ESF-服务器地址.txt"
$ServerUrlFile = Join-Path $Root 'server\updates\public-url.txt'
New-Item -ItemType Directory -Force -Path $Run | Out-Null

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $Log -Value $line -Encoding UTF8
}

function Test-Public($url) {
  if (-not $url) { return $false }
  try {
    $h = Invoke-RestMethod "$url/api/health" -TimeoutSec 12
    return ($h.ok -eq $true)
  } catch { return $false }
}

function Get-TunnelUrl {
  $text = (Get-Content (Join-Path $Run 'ssh-tunnel.out.log') -Raw -ErrorAction SilentlyContinue) +
          "
" + (Get-Content (Join-Path $Run 'ssh-tunnel.err.log') -Raw -ErrorAction SilentlyContinue)
  $text = $text -replace "`e\[[0-9;]*m", ''
  $m = [regex]::Match($text, 'https://[a-z0-9]+\.lhr\.life')
  if ($m.Success) { return $m.Value }
  return ''
}

function Restart-Tunnel {
  Write-Log '隧道失效，重启中…'
  $pidFile = Join-Path $Run 'ssh-tunnel.pid'
  if (Test-Path $pidFile) {
    $old = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($old) { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item (Join-Path $Run 'ssh-tunnel.out.log'), (Join-Path $Run 'ssh-tunnel.err.log') -Force -ErrorAction SilentlyContinue

  $ssh = (Get-Command ssh.exe).Source
  $args = @(
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=20',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-R', '80:127.0.0.1:3000',
    'nokey@localhost.run'
  )
  $p = Start-Process -FilePath $ssh -ArgumentList $args `
    -RedirectStandardOutput (Join-Path $Run 'ssh-tunnel.out.log') `
    -RedirectStandardError (Join-Path $Run 'ssh-tunnel.err.log') `
    -PassThru -WindowStyle Hidden
  $p.Id | Set-Content $pidFile

  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $url = Get-TunnelUrl
    if ($url -and (Test-Public $url)) {
      $url | Set-Content $UrlFile -Encoding ASCII
      $url | Set-Content $DesktopFile -Encoding UTF8
      New-Item -ItemType Directory -Force -Path (Split-Path $ServerUrlFile) | Out-Null
      $url | Set-Content $ServerUrlFile -Encoding ASCII
      Write-Log "新地址: $url"
      return $url
    }
  }

  Write-Log '重连失败，等待下一轮'
  return ''
}

Write-Log '守护启动'
$url = ''
if (Test-Path $UrlFile) { $url = (Get-Content $UrlFile -Raw).Trim() }
if (-not (Test-Public $url)) { $url = Restart-Tunnel }

while ($true) {
  Start-Sleep -Seconds 45
  if (-not (Test-Public $url)) {
    $url = Restart-Tunnel
  }
}
