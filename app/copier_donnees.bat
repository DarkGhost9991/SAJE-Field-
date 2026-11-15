@echo off
chcp 65001 >nul
rem Copie les resultats du script (..\donnees_traitees) dans l'application :
rem   data_*.js  -> app\js\donnees\     (chiffres, dates, zones)
rem   img\       -> app\data\img\       (cartes WebP)
set "SRC=%~dp0..\donnees_traitees"
if not exist "%SRC%\data_province.js" (
  echo Aucune donnee trouvee dans :
  echo   %SRC%
  echo Lancez d'abord preparation_donnees\lancer_preparation.bat
  pause & exit /b 1
)
if not exist "%~dp0js\donnees" mkdir "%~dp0js\donnees"
copy /Y "%SRC%\data_*.js" "%~dp0js\donnees\" >nul
robocopy "%SRC%\img" "%~dp0data\img" /MIR /NFL /NDL /NJH /NJS >nul
echo Donnees copiees. L'application fonctionne sans Internet.
start "" "%~dp0index.html"
