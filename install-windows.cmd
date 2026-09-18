@echo off
rem DSH Canvas Suite - Windows installer launcher (double-click or run from terminal)
rem Real logic lives in install-windows.ps1. Usage:
rem   install-windows.cmd              install / update + health check
rem   install-windows.cmd -CheckOnly   health check only, no file changes
chcp 65001 >nul
setlocal
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" %*
set "code=%ERRORLEVEL%"
echo.
if "%code%"=="0" (
  echo [OK] Done. Press any key to close...
) else (
  echo [FAILED] Exit code %code%. Press any key to close...
)
pause >nul
exit /b %code%
