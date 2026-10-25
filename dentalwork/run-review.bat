@echo off
setlocal EnableExtensions
set "ROOT=%~dp0..\"
set "VITE=%ROOT%node_modules\.bin\vite-node.cmd"
echo Dental aligner orientation, support, and region review
echo Diagnostic only: support contacts currently use the legacy broad mask.
echo.
set /p "STL=Enter the full path to an STL file: "
set "STL=%STL:"=%"
if not exist "%STL%" (
  echo STL not found.
  pause
  exit /b 1
)
if not exist "%VITE%" (
  echo Project dependencies are missing. Run npm ci in %ROOT% first.
  pause
  exit /b 1
)
set "OUTDIR=%~dp0output"
if not exist "%OUTDIR%" mkdir "%OUTDIR%"
set "OUT=%OUTDIR%\dental-review-%RANDOM%-%RANDOM%.glb"
call "%VITE%" --script "%ROOT%scripts\dental-region-review\cli.ts" --input "%STL%" --output "%OUT%" --with-supports
if errorlevel 1 (
  echo The review was not generated. See the reason above.
  pause
  exit /b 2
)
echo.
echo Auto-oriented review GLB with region, edges, and app-generated supports: %OUT%
explorer /select,"%OUT%"
pause
