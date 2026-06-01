@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo 正在启动云试衣间本地服务...
echo.
echo 提示：请把真实密钥放在本机 .env.local 或线上平台环境变量中，不要写进这个 bat 文件。
echo 可参考 .env.example。
echo.

node server.js
pause
