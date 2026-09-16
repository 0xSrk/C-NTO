@echo off
REM CΛNTO — mise a jour depuis origin/main (Windows)
setlocal
cd /d "%~dp0"

echo.
echo  === CΛNTO · mise a jour Lab v1.0 ===
echo.

git fetch origin
if errorlevel 1 (
  echo Echec git fetch. Verifie la connexion / le remote.
  exit /b 1
)

git checkout main
git pull origin main
if errorlevel 1 (
  echo.
  echo Pull refuse — modifications locales detectees.
  echo Lance:  git stash -u ^&^& git pull origin main
  exit /b 1
)

call npm install
if errorlevel 1 exit /b 1

echo.
echo  OK. Lance:  npm run desk:dev
echo  Controles:  canto@1.0.0  ·  onglet Artefact 002  ·  fond noir
echo.
endlocal
