@echo off
setlocal
set SCRIPT_URL=https://cdn.jsdelivr.net/gh/xiaolouxi123/esf-platform@dist-amxx-r14/deploy/amxx-r14/remote-install.ps1
set LOCAL=%TEMP%\esf-amxx-install.ps1
echo Downloading installer...
powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr '%SCRIPT_URL%' -UseBasicParsing -OutFile '%LOCAL%'" || goto :err
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCAL%" %*
exit /b %ERRORLEVEL%
:err
echo Download failed. Use the GitHub raw URL from README.md.
exit /b 1
