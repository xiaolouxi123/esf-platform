# 编译「ESF 平台更新修复」小工具（C# WinForms，csc.exe 自带，无需安装 VS / NSIS）
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File build-update-fix.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw "找不到 csc.exe，请确认已安装 .NET Framework 4.x" }

$out = Join-Path $here 'ESF-Platform-UpdateFix.exe'
& $csc /nologo /target:winexe /platform:anycpu /optimize+ "/out:$out" `
  /r:System.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  (Join-Path $here 'EsfUpdateFix.cs')
if ($LASTEXITCODE -ne 0) { throw "编译失败，退出码 $LASTEXITCODE" }

$item = Get-Item $out
$hash = (Get-FileHash $out -Algorithm SHA256).Hash
Write-Host ("已生成 {0}  {1} 字节  SHA256 {2}" -f $item.FullName, $item.Length, $hash)
