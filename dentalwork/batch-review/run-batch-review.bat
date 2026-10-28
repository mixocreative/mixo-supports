@echo off
setlocal EnableExtensions
rem Folder review: every STL in the folder(s) through the app's own dental pipeline, then a local viewer.
rem Drop one or more folders onto this file, or run it and paste a folder path.
set "HERE=%~dp0"
set "ROOT=%HERE%..\..\"
set "VITE=%ROOT%node_modules\.bin\vite-node.cmd"
echo Mixo Supports - dental folder review
echo Review only: inspect every result before printing. Not clinically validated.
echo.
if not exist "%VITE%" (
  echo Project dependencies are missing. Run "npm ci" in %ROOT% first.
  pause
  exit /b 1
)
if not exist "%ROOT%crates\geometry-wasm\pkg-node" (
  echo Building the geometry engine once...
  pushd "%ROOT%" && call npm run wasm:build && popd
)
set "FOLDERS=%*"
if "%FOLDERS%"=="" set /p "FOLDERS=Folder with STL files (subfolders are included): "
if "%FOLDERS%"=="" exit /b 1
for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%t"
set "OUT=%HERE%..\output\batch-%STAMP%"
call "%VITE%" --script "%HERE%batch.ts" --out "%OUT%" %FOLDERS%
if errorlevel 1 (
  echo The review did not run. See the reason above.
  pause
  exit /b 2
)
echo.
echo Opening the viewer. Keep this window open while you look; close it when done.
node "%HERE%serve.mjs" "%OUT%"
