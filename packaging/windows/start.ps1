param([ValidateRange(0,65535)][int]$Port = 0, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$browserJob = $null
try {
    if (!(Test-Path -LiteralPath './coderova.exe') -or !(Test-Path -LiteralPath './public/index.html')) {
        throw 'Package incomplete. Extract the entire ZIP before starting.'
    }
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    $selectedPort = $listener.LocalEndpoint.Port
    $listener.Stop()
    $url = "http://127.0.0.1:$selectedPort/"
    if (!$NoBrowser) {
        $browserJob = Start-Job -ArgumentList $url -ScriptBlock {
            param($url)
            for ($attempt = 0; $attempt -lt 60; $attempt++) {
                try {
                    $null = Invoke-WebRequest -UseBasicParsing -Uri ($url + 'api/health') -TimeoutSec 1
                    Start-Process $url
                    return
                } catch { Start-Sleep -Milliseconds 500 }
            }
        }
    }
    Write-Host "CodeRova: $url" -ForegroundColor Cyan
    Write-Host 'Keep this window open. Press Ctrl+C to stop.'
    Write-Host 'Configure source projects in callgraph.projects.local.json, then restart.'
    & './coderova.exe' serve --host 127.0.0.1 --port $selectedPort --config callgraph.projects.local.json
    if ($LASTEXITCODE -ne 0) { throw "Server exited with code $LASTEXITCODE" }
} catch {
    Write-Host $_ -ForegroundColor Red
    exit 1
} finally {
    if ($browserJob) { Stop-Job $browserJob; Remove-Job $browserJob -Force }
}
