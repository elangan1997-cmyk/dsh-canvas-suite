@echo off
chcp 65001 >nul
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
if errorlevel 1 (
  echo.
  echo 安装失败，请查看上面的提示以及 %%USERPROFILE%%\.dsh\logs\dsh-canvas-workbench-install.log
  pause
  exit /b 1
)
echo.
echo DSH画布工作台安装完成，请重新打开 DSH Desktop。
pause
