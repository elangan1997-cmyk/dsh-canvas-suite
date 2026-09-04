@echo off
chcp 65001 >nul
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%build-release.ps1" %*
if errorlevel 1 (
  echo Release build failed. Use -KeepStage and inspect the error above.
  pause
  exit /b 1
)
echo Release build completed.
pause
