@echo off
rem Detiene la API (3000) y la web (8082) locales.
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 3000,8082 -State Listen -ErrorAction SilentlyContinue; if(-not $p){ 'No habia servidores corriendo.' } else { $p | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; 'Servidores detenidos.' }"
timeout /t 3 >nul
