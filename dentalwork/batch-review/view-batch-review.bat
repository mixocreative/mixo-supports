@echo off
setlocal EnableExtensions
rem Reopen an earlier folder review in the viewer. Drop its batch-... folder (or any file in it) onto
rem this file, or run it to open the newest one under dentalwork\output. With no run found, the viewer
rem opens empty: drop a batch-... folder onto the page.
set "HERE=%~dp0"
set "OUT=%~1"
if defined OUT if not exist "%OUT%\*" set "OUT=%~dp1."
if "%OUT%"=="" for /f "delims=" %%d in ('dir /b /ad /o-n "%HERE%..\output\batch-*" 2^>nul') do if not defined OUT set "OUT=%HERE%..\output\%%d"
if "%OUT%"=="" (
  echo No folder review found under dentalwork\output. Opening an empty viewer: drop a batch-... folder onto the page.
  node "%HERE%serve.mjs"
  exit /b
)
echo Opening %OUT%
node "%HERE%serve.mjs" "%OUT%"
