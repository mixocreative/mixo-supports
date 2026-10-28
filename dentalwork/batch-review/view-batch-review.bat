@echo off
setlocal EnableExtensions
rem Reopen an earlier folder review in the viewer. Drop its batch-... folder onto this file,
rem or run it to open the newest one under dentalwork\output.
set "HERE=%~dp0"
set "OUT=%~1"
if "%OUT%"=="" for /f "delims=" %%d in ('dir /b /ad /o-n "%HERE%..\output\batch-*" 2^>nul') do if not defined OUT set "OUT=%HERE%..\output\%%d"
if "%OUT%"=="" (
  echo No folder review found under dentalwork\output. Run run-batch-review.bat first.
  pause
  exit /b 1
)
echo Opening %OUT%
node "%HERE%serve.mjs" "%OUT%"
