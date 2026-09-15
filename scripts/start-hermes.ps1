$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ApiPort = if ($env:EARL_API_PORT) { $env:EARL_API_PORT } else { "3001" }
$ApiUrl = if ($env:EARL_API_URL) {
    $env:EARL_API_URL
} else {
    "http://127.0.0.1:$ApiPort"
}
$HermesHome = if ($env:HERMES_HOME) {
    $env:HERMES_HOME
} else {
    Join-Path $HOME ".hermes"
}
$SoulFile = Join-Path $HermesHome "SOUL.md"
$SoulBackup = "$SoulFile.earl-$PID.bak"
$HadSoul = Test-Path $SoulFile
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
if (-not $env:EARL_AUTONOMY_ENABLED) {
    $env:EARL_AUTONOMY_ENABLED = "true"
}
New-Item -ItemType Directory -Force -Path $HermesHome | Out-Null

if ($HadSoul) {
    Copy-Item $SoulFile $SoulBackup
}
Copy-Item "$Root/prompts/SOUL-earl.md" $SoulFile -Force

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

    $Seed = "Start Earl companion mode. Check body health, autonomy status, and pending commands. Handle player requests before autonomous intentions. When idle, arm the background command listener described in HERMES.md."
    $HermesArgs = @("chat", "-q", $Seed)
    if ($env:EARL_HERMES_YOLO -ne "false") {
        $HermesArgs += "--yolo"
    }
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
    if ($HadSoul -and (Test-Path $SoulBackup)) {
        Move-Item $SoulBackup $SoulFile -Force
    } elseif (Test-Path $SoulFile) {
        Remove-Item $SoulFile
    }
}
