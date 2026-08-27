@echo off
rem ===========================================================================
rem  Zombie Farm Reforged - double-click this file to play.
rem
rem  It starts a tiny web server for the game folder next door and opens your
rem  browser. Nothing is installed, nothing leaves your PC, and no admin rights
rem  are needed. The real work happens in launcher\launcher.ps1.
rem ===========================================================================

setlocal
set "ZFROOT=%~dp0"

if not exist "%ZFROOT%launcher\launcher.ps1" (
    echo.
    echo   Could not find launcher\launcher.ps1
    echo.
    echo   This usually means the zip was only partly extracted, or this file was
    echo   copied out of the folder on its own. Extract the whole zip again and
    echo   run "Play Zombie Farm.cmd" from inside the extracted folder.
    echo.
    pause
    exit /b 1
)

where powershell >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Windows PowerShell was not found on this PC, so the launcher cannot run.
    echo.
    pause
    exit /b 1
)

rem -STA is required for the launcher's small status window.
rem -ExecutionPolicy Bypass keeps a downloaded script from being blocked.
rem Hidden + minimised so the player sees the game window, not a console.
start "" /min powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%ZFROOT%launcher\launcher.ps1"

exit /b 0
