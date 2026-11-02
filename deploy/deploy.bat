@echo off
chcp 65001 >nul
setlocal
set SRC=%~dp0
if not exist "C:\esf-setup" mkdir "C:\esf-setup"
copy /Y "%SRC%esf-server-bundle.zip" "C:\esf-setup\" >nul
copy /Y "%SRC%deploy-esf-server.ps1" "C:\esf-setup\" >nul
echo.
echo === ESF server deploy ===
echo Files copied to C:\esf-setup
echo Starting PowerShell deploy script...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\esf-setup\deploy-esf-server.ps1"
echo.
echo === Done. Press any key to close ===
pause >nul