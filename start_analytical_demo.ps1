param(
    [switch]$NoOpen,
    [ValidateSet('analytical', 'finance')]
    [string]$Workspace = 'analytical',
    [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

$existingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($existingListener) {
    $existingProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($existingListener.OwningProcess)" -ErrorAction SilentlyContinue
    $processSummary = if ($existingProcess) {
        "PID $($existingProcess.ProcessId): $($existingProcess.CommandLine)"
    } else {
        "PID $($existingListener.OwningProcess)"
    }
    Write-Error "Port $Port is already in use ($processSummary). Stop the existing server before starting this version."
    exit 1
}

if (-not $env:GEMINI_API_TOKEN) {
    $envFilePath = Join-Path $projectRoot '.env'
    if (Test-Path -LiteralPath $envFilePath) {
        Write-Host '[INFO] GEMINI_API_TOKEN not set in this shell; relying on .env (loaded by analytics_server.py).' -ForegroundColor Yellow
    } else {
        Write-Error 'GEMINI_API_TOKEN is not set and no .env file was found. Copy .env.example to .env and fill in GEMINI_API_TOKEN, or set $env:GEMINI_API_TOKEN before running this script.'
        exit 1
    }
}

if (-not $env:GEMINI_API_BASE) {
    $env:GEMINI_API_BASE = 'https://cloud.geminidata.com/api/v1'
}
if (-not $env:GEMINI_PORTAL_API_BASE) {
    $env:GEMINI_PORTAL_API_BASE = 'https://cloud.geminidata.com/api/portal/api10'
}
if (-not $env:GEMINI_TENANT_ID) {
    $env:GEMINI_TENANT_ID = '6a439e670763de002d27d6bd'
}

Set-Location -LiteralPath $projectRoot
$serverArgs = @('.\analytics_server.py', '--host', '127.0.0.1', '--port', $Port, '--workspace', $Workspace)
if (-not $NoOpen) {
    $serverArgs += '--open'
}

Write-Host "[INFO] Startup workspace: $Workspace" -ForegroundColor Yellow
# Windows App Execution Alias keeps a launcher process alive for the lifetime of
# Python. Resolve the real interpreter first so one demo server maps to one
# Python process and is easier to identify/stop from Task Manager.
$pythonExe = (& python -c "import sys; print(sys.executable)").Trim()
if (-not $pythonExe -or -not (Test-Path -LiteralPath $pythonExe)) {
    Write-Error 'Unable to resolve the Python interpreter.'
    exit 1
}
& $pythonExe @serverArgs
