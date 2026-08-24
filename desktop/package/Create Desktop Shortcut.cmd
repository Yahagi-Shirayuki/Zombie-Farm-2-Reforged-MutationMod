@echo off
rem Puts a "Zombie Farm Reforged" icon on the Desktop pointing at ZombieFarm.exe.
rem Optional - the game runs fine without it. Safe to run more than once.

setlocal
set "ZFROOT=%~dp0"

if not exist "%ZFROOT%ZombieFarm.exe" (
    echo.
    echo   ZombieFarm.exe is not next to this file.
    echo.
    echo   Extract the whole zip first, then run this from inside the
    echo   extracted folder.
    echo.
    pause
    exit /b 1
)

rem GetFolderPath('Desktop') follows a OneDrive-redirected Desktop, which a
rem plain %USERPROFILE%\Desktop would miss. Kept to one line: cmd's ^ line
rem continuation inside quoted PowerShell is a reliable source of breakage.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = $env:ZFROOT; $link = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Zombie Farm Reforged.lnk'; $s = (New-Object -ComObject WScript.Shell).CreateShortcut($link); $s.TargetPath = (Join-Path $root 'ZombieFarm.exe'); $s.WorkingDirectory = $root.TrimEnd('\'); $s.Description = 'Play Zombie Farm Reforged'; $s.Save(); Write-Host ''; Write-Host ('  Shortcut created: ' + $link)"

echo.
pause
exit /b 0
