@echo off
echo ═══════════════════════════════════════════════════
echo   MediaVault mrViewer2 Plugin - Setup
echo ═══════════════════════════════════════════════════
echo.
echo This creates a junction link so mrViewer2 can find the MediaVault plugin.
echo Requires Administrator privileges (will prompt UAC).
echo.

set MRV2_PLUGINS=C:\Program Files\vmrv2-v1.5.4\python\plug-ins\mediavault
set PLUGIN_SRC=C:\MediaVault\mrv2-plugin

if exist "%MRV2_PLUGINS%\mediavault_compare.py" (
    echo [OK] Junction already exists - plugin is installed.
    pause
    exit /b 0
)

echo Creating junction link...
echo   From: %MRV2_PLUGINS%
echo   To:   %PLUGIN_SRC%
echo.

mklink /J "%MRV2_PLUGINS%" "%PLUGIN_SRC%"

if exist "%MRV2_PLUGINS%\mediavault_compare.py" (
    echo.
    echo [OK] Plugin installed successfully!
    echo     Restart mrViewer2 to see the MediaVault menu.
) else (
    echo.
    echo [FAIL] Junction creation failed.
    echo        Right-click this script and "Run as Administrator"
)

echo.
pause
