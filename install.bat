@echo off
title Digital Media Vault — Installer
color 0B
setlocal EnableDelayedExpansion

echo.
echo  =============================================
echo    Digital Media Vault (DMV) — One-Click Installer
echo  =============================================
echo.
echo  This installer handles everything for you.
echo  Just sit back — it will install all dependencies
echo  automatically if they are not already present.
echo.

cd /d "%~dp0"
if not exist "tools" mkdir tools

:: ─── [1/5] Check / Install Node.js ───
echo  [1/5] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo         Node.js not found. Installing automatically...
    echo.

    :: Detect architecture
    set "NODE_URL=https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
    if "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
        set "NODE_URL=https://nodejs.org/dist/v22.14.0/node-v22.14.0-arm64.msi"
    )

    echo         Downloading Node.js v22 LTS...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$ProgressPreference = 'SilentlyContinue'; " ^
        "try { " ^
        "  Invoke-WebRequest -Uri '!NODE_URL!' -OutFile 'tools\node-installer.msi'; " ^
        "  Write-Host '         Download complete.'; " ^
        "} catch { " ^
        "  Write-Host ('         ERROR: ' + $_.Exception.Message); " ^
        "}"

    if not exist "tools\node-installer.msi" (
        echo.
        echo  ERROR: Failed to download Node.js installer.
        echo  Please install manually from: https://nodejs.org/
        echo  Then re-run this installer.
        echo.
        pause
        exit /b 1
    )

    echo         Installing Node.js (this may take a minute^)...
    msiexec /i "tools\node-installer.msi" /passive /norestart
    del "tools\node-installer.msi" 2>nul

    :: Refresh PATH so node is available in this session
    for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYSPATH=%%B"
    for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USRPATH=%%B"
    set "PATH=!SYSPATH!;!USRPATH!"

    where node >nul 2>&1
    if errorlevel 1 (
        echo.
        echo  ERROR: Node.js installation may have failed.
        echo  Please install manually from: https://nodejs.org/
        echo  Then re-run this installer.
        echo.
        pause
        exit /b 1
    )
    for /f "tokens=*" %%v in ('node --version') do echo         Node.js %%v installed successfully!
) else (
    for /f "tokens=*" %%v in ('node --version') do echo         Found Node.js %%v
)

:: ─── [2/5] Check / Install Git ───
echo  [2/5] Checking Git...
where git >nul 2>&1
if errorlevel 1 (
    echo         Git not found. Installing automatically...
    echo.

    set "GIT_URL=https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe"
    echo         Downloading Git for Windows...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$ProgressPreference = 'SilentlyContinue'; " ^
        "try { " ^
        "  Invoke-WebRequest -Uri '!GIT_URL!' -OutFile 'tools\git-installer.exe'; " ^
        "  Write-Host '         Download complete.'; " ^
        "} catch { " ^
        "  Write-Host ('         ERROR: ' + $_.Exception.Message); " ^
        "}"

    if exist "tools\git-installer.exe" (
        echo         Installing Git (silent install^)...
        start "" /wait "tools\git-installer.exe" /VERYSILENT /NORESTART /NOCANCEL /SP-
        del "tools\git-installer.exe" 2>nul

        :: Refresh PATH
        for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYSPATH=%%B"
        for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USRPATH=%%B"
        set "PATH=!SYSPATH!;!USRPATH!"

        where git >nul 2>&1
        if errorlevel 1 (
            echo         NOTE: Git installed but not on PATH yet.
            echo         Close and re-open this terminal for Git to work.
        ) else (
            for /f "tokens=*" %%v in ('git --version') do echo         %%v installed successfully!
        )
    ) else (
        echo         WARNING: Git download failed. You can install it later from:
        echo         https://git-scm.com/
        echo         (Git is only needed for pulling future updates.^)
    )
) else (
    for /f "tokens=*" %%v in ('git --version') do echo         Found %%v
)

:: ─── [3/5] Install npm packages ───
echo  [3/5] Installing npm packages...
call npm install --no-audit --no-fund
echo         Done.

:: ─── [4/5] Download FFmpeg ───
echo  [4/5] Checking FFmpeg...

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
:: ─── [5/5] Check mrViewer2 ───
echo  [5/5] Checking mrViewer2...
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
