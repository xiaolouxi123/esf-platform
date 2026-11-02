@echo off
chcp 65001 >nul
setlocal
set SRC=%~dp0
if not exist "C:\esf-local" mkdir "C:\esf-local"
copy /Y "%SRC%start-local-server.ps1" "C:\esf-local\" >nul
echo.
echo === ESF local test server ===
echo MySQL + API + public tunnel
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\esf-local\start-local-server.ps1"
pause >nul