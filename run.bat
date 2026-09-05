@echo off
REM racing3d playtest. English-only, CRLF.
cd /d "%~dp0"
echo Starting Racing 3D ...
if not exist "node_modules" call npm install
call npm run dev -- --open
pause
