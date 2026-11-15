@echo off
rem SAJE Field - calcule les previsions et les ecrit dans l'application (app\js\donnees\previsions_province.js)
rem A relancer apres chaque mise a jour des donnees (preparation_donnees\lancer_preparation.bat puis copie dans app\).
chcp 65001 >nul
cd /d "%~dp0"
set "PY=%SAJE_PYTHON%"
if "%PY%"=="" (where py >nul 2>nul && set "PY=py" || set "PY=python")
%PY% prevoir.py %*
if errorlevel 1 (
  echo.
  echo Echec du calcul des previsions. Verifier que Python 3.9+ est installe.
) else (
  echo.
  echo Termine. Recharger app\index.html dans le navigateur.
)
pause
