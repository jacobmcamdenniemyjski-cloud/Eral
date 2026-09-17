param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [Parameter(Mandatory = $true)]
    [string]$LogFile,
    [int]$MaxRestarts = 10,
    [int]$RestartDelaySeconds = 3
)

$ErrorActionPreference = "Continue"
Set-Location $Root
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null

for ($Attempt = 0; $Attempt -le $MaxRestarts; $Attempt++) {
    $StartedAt = Get-Date -Format "o"
    Add-Content -Path $LogFile -Value "[$StartedAt] supervisor starting Earl (attempt $($Attempt + 1))."
    & npm.cmd start *>> $LogFile
    $ExitCode = $LASTEXITCODE
    $StoppedAt = Get-Date -Format "o"
    Add-Content -Path $LogFile -Value "[$StoppedAt] Earl exited with code $ExitCode."

    if ($Attempt -ge $MaxRestarts) {
        Add-Content -Path $LogFile -Value "[$StoppedAt] supervisor restart limit reached."
        exit $ExitCode
    }
    Start-Sleep -Seconds $RestartDelaySeconds
}
