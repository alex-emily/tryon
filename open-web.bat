@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "tryon-server" cmd /k start.bat
timeout /t 2 /nobreak >nul
start "" http://localhost:5188
