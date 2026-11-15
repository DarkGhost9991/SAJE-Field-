@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
REM SAJE Field - collecte en flux du bassin du Congo (GCOV bande B + SME2), comblement, prevision, export vers app\
REM Relancer a tout moment : seuls les nouveaux produits NASA sont lus (reprise automatique apres coupure).
cd /d "%~dp0"
set PY=
if defined SAJE_PYTHON set "PY=%SAJE_PYTHON%"
for %%V in (3.13 3.12 3.11 3.10) do (
  if not defined PY ( py -%%V -c "import numpy, h5py, fsspec, pyproj" >nul 2>nul && set "PY=py -%%V" )
)
if not defined PY (
  echo Python 3.10+ avec numpy, h5py, fsspec, pyproj introuvable.
  echo Lancer d'abord ..\preparation_donnees\lancer_preparation.bat ^(il installe les modules^), puis relancer ce fichier.
  pause & exit /b 1
)
echo Python utilise : %PY%
echo Le jeton Earthdata est lu dans ..\preparation_donnees\"token nasa.txt" (jamais affiche).
echo.
%PY% collecter_bassin.py %*
echo.
echo Termine. Ouvrir ..\app\index.html puis la page "Bassin du Congo".
pause
