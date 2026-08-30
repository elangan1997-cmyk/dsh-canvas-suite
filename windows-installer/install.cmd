@echo off
chcp 65001 >nul
set "SUITE_ROOT=%~dp0.."
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -SourceRoot "%SUITE_ROOT%"
if errorlevel 1 (
  echo Installation failed. See the message above and the DSH canvas log.
  pause
  exit /b 1
)
echo Installation completed. Restart DSH Desktop.
pause
