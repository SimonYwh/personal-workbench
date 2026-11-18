@echo off
setlocal
"D:\Program Files\Powershell7\7\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync.ps1"
echo.
"D:\Program Files\Powershell7\7\pwsh.exe" -NoProfile -Command "Get-Content -LiteralPath '%~dp0sync.log' -Tail 3 -Encoding utf8"
echo.
pause
