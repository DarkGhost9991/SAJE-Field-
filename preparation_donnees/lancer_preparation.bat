@echo off
chcp 65001 >nul
REM SAJE Field - recolte et preparation des donnees NISAR (GCOV + SME2) pour l'application
cd /d "%~dp0"
REM Choisir un interpreteur installe et verifie (Python >= 3.10).
set PY=
if defined SAJE_PYTHON (
  "%SAJE_PYTHON%" -c "import sys; assert sys.version_info >= (3,10)" >nul 2>nul && set PY="%SAJE_PYTHON%"
)
for %%V in (3.13 3.12 3.11 3.10) do (
  if not defined PY ( py -%%V -c "import sys" >nul 2>nul && set "PY=py -%%V" )
)
if not defined PY ( python -c "import sys; assert sys.version_info >= (3,10)" >nul 2>nul && set "PY=python" )
if not defined PY (
  echo.
  echo Aucun Python utilisable trouve. Installer Python 3.13 ou definir SAJE_PYTHON avec le chemin de python.exe.
  echo Installer avec :  py install 3.13
  echo ou depuis https://www.python.org/downloads/ ^(version 3.13^), puis relancer ce fichier.
  pause & exit /b 1
)
echo Python utilise : %PY%
echo Verification des modules Python...
%PY% -m pip install --user --quiet --only-binary=:all: -r requirements.txt || (echo Echec de l'installation des modules. Copier le message ci-dessus et l'envoyer. & pause & exit /b 1)
echo.
echo Recolte automatique : province de l'Estuaire, de la date la plus ancienne disponible a aujourd'hui.
echo Le jeton est lu automatiquement dans "token nasa.txt", a cote du script.
echo Une variable EDL_TOKEN definie reste prioritaire. Le contenu du jeton n'est jamais affiche.
echo En cas de coupure, relancer ce fichier : il reprend la ou il s'est arrete.
echo.
%PY% preparer_donnees_prototype.py --niveau province %*
set SAJE_RESULT=%ERRORLEVEL%
if not "%SAJE_RESULT%"=="0" echo La preparation a signale une erreur. Consulter le message ci-dessus.
echo.
echo Application : ..\app\index.html   -   Journal : ..\donnees_traitees\journal_recolte.txt
pause
exit /b %SAJE_RESULT%
