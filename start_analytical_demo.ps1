param(
    [switch]$NoOpen,
    [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $env:GEMINI_API_TOKEN) {
    $configPath = Join-Path $projectRoot 'js\config.js'
    if (Test-Path -LiteralPath $configPath) {
        $configText = Get-Content -Raw -LiteralPath $configPath
        $tokenMatch = [regex]::Match($configText, "GEMINI_JWT\s*=\s*'([^']+)'")
        if ($tokenMatch.Success) {
            $env:GEMINI_API_TOKEN = $tokenMatch.Groups[1].Value
            Write-Host '[INFO] Using demo token from js/config.js' -ForegroundColor Yellow
        } else {
            Write-Error 'API Token not found. Please set GEMINI_API_TOKEN environment variable.'
            exit 1
        }
    } else {
        Write-Error 'js/config.js not found. Please set GEMINI_API_TOKEN environment variable.'
        exit 1
    }
}

$env:GEMINI_API_BASE = 'https://cloud.geminidata.com/api/v1'
Set-Location -LiteralPath $projectRoot
$serverArgs = @('.\analytics_server.py', '--host', '127.0.0.1', '--port', $Port)
if (-not $NoOpen) {
    $serverArgs += '--open'
}
python @serverArgs
