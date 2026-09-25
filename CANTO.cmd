@echo off
chcp 65001 >nul
REM CΛNTO — lanceur Lab (double-clic)
setlocal
cd /d "%~dp0"

echo.
echo  === CΛNTO · lanceur ===
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js est requis — installez la LTS depuis https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Premiere installation des dependances…
  call npm install --legacy-peer-deps
  if errorlevel 1 (
    echo Echec npm install.
    pause
    exit /b 1
  )
  REM npm reecrit package-lock.json : on le restaure pour que les mises a jour restent possibles.
  git checkout -- package-lock.json >nul 2>&1
)

echo Telechargement Electron au besoin (sans module natif Windows)...
call npm run launch
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo.
  echo Le lanceur s'est arrete ^(code %ERR%^).
  pause
)
endlocal
exit /b %ERR%
