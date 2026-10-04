@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo KeyBox installer - requesting admin rights...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-KeyBox.ps1"
if errorlevel 1 (
  echo.
  echo [!] Installer exited with an error. See messages above.
  pause
)