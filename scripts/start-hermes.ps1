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
$LogDirectory = Join-Path $Root "data/logs"
$LogStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BodyLog = Join-Path $LogDirectory "earl-body-$LogStamp.log"

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
    $ExistingHealth = $null
    try {
        $ExistingHealth = Invoke-RestMethod -Uri "$ApiUrl/health" -TimeoutSec 2
    } catch {
        New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
        $Supervisor = Join-Path $Root "scripts/start-earl-supervisor.ps1"
        $SupervisorArgs = @(
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$Supervisor`"",
            "-Root", "`"$Root`"", "-LogFile", "`"$BodyLog`""
        )
        $EarlProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $SupervisorArgs -WorkingDirectory $Root -PassThru
        $StartedEarl = $true
        Write-Host "Earl body log: $BodyLog"

        $Ready = $false
        for ($Attempt = 0; $Attempt -lt 45; $Attempt++) {
            Start-Sleep -Seconds 1
            if ($EarlProcess.HasExited) {
                throw "Earl exited before the API became ready."
            }

            try {
                $Health = Invoke-RestMethod -Uri "$ApiUrl/health" -TimeoutSec 2
                $HealthData = if ($Health.data) { $Health.data } else { $Health }
                if ($HealthData.connected -eq $true) {
                    $Ready = $true
                    break
                }
            } catch {}
        }

        if (-not $Ready) {
            throw "Earl did not connect and spawn within 45 seconds. Check $BodyLog"
        }
    }

    $ExistingHealthData = if ($ExistingHealth -and $ExistingHealth.data) {
        $ExistingHealth.data
    } else {
        $ExistingHealth
    }
    if ($ExistingHealthData -and $ExistingHealthData.connected -ne $true) {
        throw "An Earl API is already running at $ApiUrl but Minecraft is disconnected. Stop the stale Earl process, then run this launcher again."
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
        try {
            & taskkill.exe /PID $EarlProcess.Id /T /F | Out-Null
        } catch {}
    }
    if ($HadSoul -and (Test-Path $SoulBackup)) {
        Move-Item $SoulBackup $SoulFile -Force
    } elseif (Test-Path $SoulFile) {
        Remove-Item $SoulFile
    }
}
