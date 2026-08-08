param(
    [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1

if (-not $listener) {
    Write-Host "[INFO] No server is listening on port $Port." -ForegroundColor Yellow
    exit 0
}

$serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
if (-not $serverProcess -or
    $serverProcess.Name -ne 'python.exe' -or
    $serverProcess.CommandLine -notmatch 'analytics_server\.py' -or
    $serverProcess.CommandLine -notmatch "--port\s+$Port(?:\s|$)") {
    Write-Error "Port $Port is owned by another application (PID $($listener.OwningProcess)); nothing was stopped."
    exit 1
}

$processIds = @($serverProcess.ProcessId)
$parentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($serverProcess.ParentProcessId)" -ErrorAction SilentlyContinue
if ($parentProcess -and
    $parentProcess.Name -eq 'python.exe' -and
    $parentProcess.CommandLine -match 'analytics_server\.py' -and
    $parentProcess.CommandLine -match "--port\s+$Port(?:\s|$)") {
    $processIds += $parentProcess.ProcessId
}

foreach ($processId in $processIds) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 500
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    Write-Error "The verified analytical server could not be stopped on port $Port."
    exit 1
}

Write-Host "[OK] Analytical demo server on port $Port has been stopped." -ForegroundColor Green
