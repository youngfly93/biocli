@echo on
setlocal

set "npm_config_cache=%SRC_DIR%\.npm-cache"
set "npm_config_update_notifier=false"
set "npm_config_audit=false"
set "npm_config_fund=false"

call npm install --ignore-scripts
if errorlevel 1 exit /b 1

call npm run build
if errorlevel 1 exit /b 1

call npm prune --omit=dev
if errorlevel 1 exit /b 1

set "INSTALL_ROOT=%PREFIX%\lib\node_modules\@yangfei_93sky\biocli"
if not exist "%INSTALL_ROOT%" mkdir "%INSTALL_ROOT%"
if not exist "%PREFIX%\Scripts" mkdir "%PREFIX%\Scripts"

xcopy /E /I /Y dist "%INSTALL_ROOT%\dist" >NUL
if errorlevel 1 exit /b 1
xcopy /E /I /Y node_modules "%INSTALL_ROOT%\node_modules" >NUL
if errorlevel 1 exit /b 1
copy /Y package.json "%INSTALL_ROOT%\package.json" >NUL
if errorlevel 1 exit /b 1
copy /Y README.md "%INSTALL_ROOT%\README.md" >NUL
if errorlevel 1 exit /b 1
copy /Y LICENSE "%INSTALL_ROOT%\LICENSE" >NUL
if errorlevel 1 exit /b 1

> "%PREFIX%\Scripts\biocli.cmd" echo @echo off
>> "%PREFIX%\Scripts\biocli.cmd" echo "%PREFIX%\node.exe" "%INSTALL_ROOT%\dist\main.js" %%*
> "%PREFIX%\Scripts\ncbicli.cmd" echo @echo off
>> "%PREFIX%\Scripts\ncbicli.cmd" echo "%PREFIX%\node.exe" "%INSTALL_ROOT%\dist\main.js" %%*
