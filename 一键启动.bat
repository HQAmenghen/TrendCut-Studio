@echo off
chcp 65001 > nul
title AI_Video_Pipeline

echo ==========================================
echo         AI Video Pipeline
echo ==========================================
echo.
echo 1. Entering project directory...
cd /d "%~dp0comfy_panel_demo"

echo 2. Building Vue frontend...
call npm run build:front
if errorlevel 1 (
echo Frontend build failed.
pause
exit /b 1
)

echo 3. Opening default browser after server starts...
start "" cmd /c "timeout /t 3 > nul && start http://localhost:3001"

echo 4. Starting backend server...
node server.js

pause
