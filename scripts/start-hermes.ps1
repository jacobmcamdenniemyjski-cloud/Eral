$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ApiPort = if ($env:EARL_API_PORT) { $env:EARL_API_PORT } else { "3001" }
$ApiUrl = if ($env:EARL_API_URL) {
    $env:EARL_API_URL
} else {
    "http://127.0.0.1:$ApiPort"
}
$EarlProcess = $null
$StartedEarl = $false

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required."
}
if (-not (Get-Command hermes -ErrorAction SilentlyContinue)) {
    throw "Hermes Agent is required. Install it, then run: hermes setup"
}

Set-Location $Root
$env:EARL_BRAIN = "hermes"
$env:EARL_API_ENABLED = "true"
$env:EARL_API_URL = $ApiUrl

try {
    try {
        Invoke-RestMethod -Uri "$ApiUrl/health" -TimeoutSec 2 | Out-Null
    } catch {
        $EarlProcess = Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory $Root -PassThru
        $StartedEarl = $true

        $Ready = $false
        for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
            Start-Sleep -Seconds 1
            if ($EarlProcess.HasExited) {
                throw "Earl exited before the API became ready."
            }

            try {
                Invoke-RestMethod -Uri "$ApiUrl/health" -TimeoutSec 2 | Out-Null
                $Ready = $true
                break
            } catch {}
        }

        if (-not $Ready) {
            throw "Earl API did not become ready at $ApiUrl."
        }
    }

    $Prompt = Get-Content "$Root/prompts/SOUL-earl.md" -Raw
    $HermesArgs = @("chat", "--yolo", "-q", $Prompt)
    if ($env:EARL_HERMES_MODEL) {
        $HermesArgs += @("--model", $env:EARL_HERMES_MODEL)
    }
    if ($env:EARL_HERMES_PROVIDER) {
        $HermesArgs += @("--provider", $env:EARL_HERMES_PROVIDER)
    }

    Write-Host "Starting Earl's Hermes brain. API: $ApiUrl"
    & hermes @HermesArgs
} finally {
    if ($StartedEarl -and $EarlProcess -and -not $EarlProcess.HasExited) {
        Stop-Process -Id $EarlProcess.Id
    }
}
