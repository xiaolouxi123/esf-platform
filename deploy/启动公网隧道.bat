@echo off
chcp 65001 >nul
setlocal
set SRC=%~dp0
if not exist "C:\esf" mkdir "C:\esf"
copy /Y "%SRC%start-tunnel.ps1" "C:\esf\" >nul
echo.
echo === ESF public tunnel ===
echo Starting Cloudflare quick tunnel for http://127.0.0.1:3000
echo Keep this window open. Press Ctrl+C to stop.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\esf\start-tunnel.ps1"
pause >nul