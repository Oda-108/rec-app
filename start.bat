@echo off
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo   Node.js が見つかりません
    echo   https://nodejs.org からインストールしてください
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo 初回セットアップ中...
    call npm install
)

echo.
echo   Rec を起動中...
echo   ブラウザで http://localhost:3456 を開いてください
echo.

start http://localhost:3456
call npm start
