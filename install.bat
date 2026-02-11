@echo off
title Digital Media Vault — Installer
color 0B
setlocal EnableDelayedExpansion

echo.
echo  =============================================
echo    Digital Media Vault (DMV) — Installer
echo  =============================================
echo.

cd /d "%~dp0"

:: ─── [1/4] Check Node.js ───
echo  [1/4] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ERROR: Node.js is not installed!
    echo  Please install Node.js from: https://nodejs.org/
    echo  Then re-run this installer.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo         Found Node.js %%v

:: ─── [2/4] Install npm packages ───
echo  [2/4] Installing npm packages...
call npm install --no-audit --no-fund
echo         Done.

:: ─── [3/4] Download FFmpeg ───
echo  [3/4] Checking FFmpeg...

:: Check if FFmpeg is already on PATH
where ffmpeg >nul 2>&1
if not errorlevel 1 (
    echo         FFmpeg already on PATH — skipping download.
    goto :mrv2
)

:: Check if we already downloaded it locally
if exist "tools\ffmpeg\bin\ffmpeg.exe" (
    echo         FFmpeg already in tools\ — skipping download.
    goto :mrv2
)

echo         FFmpeg not found. Downloading portable build...
if not exist "tools" mkdir tools

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference = 'SilentlyContinue'; " ^
    "Write-Host '         Downloading FFmpeg (this may take a minute)...'; " ^
    "try { " ^
    "  Invoke-WebRequest -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' -OutFile 'tools\ffmpeg.zip'; " ^
    "  Write-Host '         Extracting...'; " ^
    "  Expand-Archive -Path 'tools\ffmpeg.zip' -DestinationPath 'tools\ffmpeg-temp' -Force; " ^
    "  if (Test-Path 'tools\ffmpeg') { Remove-Item 'tools\ffmpeg' -Recurse -Force }; " ^
    "  $src = Get-ChildItem 'tools\ffmpeg-temp' -Directory | Select-Object -First 1; " ^
    "  Move-Item -Path $src.FullName -Destination 'tools\ffmpeg' -Force; " ^
    "  Remove-Item 'tools\ffmpeg-temp' -Recurse -Force -ErrorAction SilentlyContinue; " ^
    "  Remove-Item 'tools\ffmpeg.zip' -Force; " ^
    "  Write-Host '         FFmpeg installed to tools\ffmpeg\'; " ^
    "} catch { " ^
    "  Write-Host ('         ERROR: ' + $_.Exception.Message); " ^
    "}"

if exist "tools\ffmpeg\bin\ffmpeg.exe" (
    echo         FFmpeg installed successfully!
) else (
    echo         WARNING: FFmpeg download may have failed.
    echo         You can install it manually from https://ffmpeg.org/download.html
    echo         or place ffmpeg.exe in tools\ffmpeg\bin\
)

:mrv2
:: ─── [4/4] Check mrViewer2 ───
echo  [4/4] Checking mrViewer2...
set "MRV2_FOUND=0"
for /d %%d in ("C:\Program Files\vmrv2-*") do set "MRV2_FOUND=1"
if !MRV2_FOUND!==1 (
    echo         mrViewer2 already installed — skipping.
    goto :done
)

echo         mrViewer2 not found.
echo.
set /p INSTALL_MRV2="         Install mrViewer2 for pro video playback? (Y/N): "
if /i not "!INSTALL_MRV2!"=="Y" (
    echo         Skipping mrViewer2 — you can install it later from https://mrv2.sourceforge.io/
    goto :done
)

echo         Downloading mrViewer2 installer...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference = 'SilentlyContinue'; " ^
    "try { " ^
    "  Invoke-WebRequest -Uri 'https://sourceforge.net/projects/mrv2/files/latest/download' -OutFile 'tools\mrv2-installer.exe' -UserAgent 'Mozilla/5.0'; " ^
    "  Write-Host '         Download complete.'; " ^
    "} catch { " ^
    "  Write-Host ('         ERROR: ' + $_.Exception.Message); " ^
    "}"

if exist "tools\mrv2-installer.exe" (
    echo         Launching mrViewer2 installer...
    echo         Please complete the installation wizard.
    start "" /wait "tools\mrv2-installer.exe"
    echo         mrViewer2 installation finished.
) else (
    echo         WARNING: Download may have failed.
    echo         Install manually from https://mrv2.sourceforge.io/
)

:done
:: ─── Create app directories ───
if not exist "data" mkdir data
if not exist "thumbnails" mkdir thumbnails

echo.
echo  =============================================
echo    Installation Complete!
echo  =============================================
echo.
echo  To start DMV, run:  start.bat
echo  Then open:  http://localhost:7700
echo.
pause
