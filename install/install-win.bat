@echo off
setlocal

set "SOURCE_DIR=%~dp0.."
set "DESTINATION=%APPDATA%\Adobe\CEP\extensions\MotionPlug"

pushd "%SOURCE_DIR%"
call npm run build
if errorlevel 1 exit /b 1
popd

for %%V in (9 10 11 12 13 14 15) do (
  reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
)

if exist "%DESTINATION%" rmdir /s /q "%DESTINATION%"
mkdir "%DESTINATION%"
xcopy "%SOURCE_DIR%\dist\*" "%DESTINATION%\" /E /I /Y >nul

echo Motion Plug installed at: %DESTINATION%
echo Fully quit Premiere Pro, reopen it, then choose Window ^> Extensions ^> Motion Plug.
endlocal
