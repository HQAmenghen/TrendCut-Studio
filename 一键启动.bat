@echo off
chcp 65001 > nul
title TrendCut Studio

echo ==========================================
echo         TrendCut Studio
echo ==========================================
echo.
echo 1. Entering project directory...
cd /d "%~dp0"

echo 2. Building Vue frontend...
call npm run build:front
if errorlevel 1 (
echo Frontend build failed.
pause
exit /b 1
)

echo 3. Opening default browser after server starts...
start "" cmd /c "timeout /t 5 > nul && start http://localhost:3002"

echo 4. Starting FastAPI backend...
start "TrendCut FastAPI" cmd /k "npm run start:api"

echo 5. Starting NestJS BFF...
npm start

pause
