@echo off
REM ============================================================
REM  Compliance Genie - Automated Demo Launcher
REM
REM  Double-click this file (or run from a terminal) to:
REM    1. Install Playwright + Chromium if missing (one-time)
REM    2. Start analytics_server.py in its own window
REM    3. Wait until the server responds
REM    4. Run scripts\demo_recording.py to record the automated demo
REM
REM  Usage:
REM    run_demo.cmd                 (pace 1.5, headed browser)
REM    run_demo.cmd 2.0             (custom pace)
REM    run_demo.cmd 1.5 headless    (headless recording)
REM    run_demo.cmd test            (dry run: checks setup only, no server/recording)
REM ============================================================
setlocal enabledelayedexpansion

set "REPO_ROOT=%~dp0"
set "PORT=8765"
set "PACE=1.5"
set "VIDEO_DIR=demo_output"
set "HEADLESS_FLAG="
set "DRY_RUN=0"

if /I "%~1"=="test" (
    set "DRY_RUN=1"
) else (
    if not "%~1"=="" set "PACE=%~1"
    if /I "%~2"=="headless" set "HEADLESS_FLAG=--headless"
)

echo ============================================================
echo  Compliance Genie - Automated Demo Launcher
echo ============================================================
echo  Repo root : %REPO_ROOT%
echo  Port      : %PORT%
echo  Pace      : %PACE%
echo  Video dir : %VIDEO_DIR%
if defined HEADLESS_FLAG echo  Mode      : headless
echo ============================================================
echo.

cd /d "%REPO_ROOT%"

where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] python was not found on PATH. Install Python 3 first.
    goto :end
)

if not exist ".env" (
    echo [ERROR] .env not found in %REPO_ROOT% - GEMINI_API_TOKEN is required.
    echo         Create .env with GEMINI_API_TOKEN=... before running the demo.
    goto :end
)

echo [setup] Checking Playwright installation...
python -c "import playwright" 2>nul
if errorlevel 1 (
    echo [setup] Installing Playwright package...
    pip install playwright
    if errorlevel 1 (
        echo [ERROR] pip install playwright failed.
        goto :end
    )
)

python -c "from playwright.sync_api import sync_playwright; p = sync_playwright().start(); b = p.chromium.launch(); b.close(); p.stop()" 2>nul
if errorlevel 1 (
    echo [setup] Installing Chromium for Playwright ^(one-time, ~100MB^)...
    python -m playwright install chromium
    if errorlevel 1 (
        echo [ERROR] playwright install chromium failed.
        goto :end
    )
)

echo [setup] OK.
echo.

if "%DRY_RUN%"=="1" (
    echo [test] Dry run only - setup looks good. Not starting server or recording.
    goto :end
)

echo [1/2] Starting demo server on port %PORT% in a new window...
start "Compliance Genie Demo Server" cmd /k "cd /d "%REPO_ROOT%" && python analytics_server.py --workspace finance --port %PORT%"

echo         Waiting for server to respond...
set "TRIES=0"
:waitloop
set /a TRIES+=1
if %TRIES% GTR 30 (
    echo [ERROR] Server did not respond after 30 seconds. Check the server window for errors.
    goto :end
)
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/pages/v2_workspace_finance.html' -UseBasicParsing -TimeoutSec 2).StatusCode } catch { '' }" > "%TEMP%\cg_status.txt" 2>nul
set /p STATUS=<"%TEMP%\cg_status.txt"
if not "%STATUS%"=="200" (
    timeout /t 1 /nobreak >nul
    goto waitloop
)
del "%TEMP%\cg_status.txt" >nul 2>nul
echo         Server is up.
echo.

echo [2/2] Running automated demo recording ^(pace=%PACE%^)...
python scripts\demo_recording.py --pace %PACE% %HEADLESS_FLAG% --video-dir "%VIDEO_DIR%"
if errorlevel 1 (
    echo [ERROR] Demo recording exited with an error - see output above.
    goto :end
)

echo.
echo ============================================================
echo  Done. Recording saved under: %REPO_ROOT%%VIDEO_DIR%
echo  The server window is still running - close it manually
echo  when you're finished (do not restart it mid-demo).
echo ============================================================

:end
pause
endlocal
