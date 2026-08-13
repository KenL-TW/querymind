param(
    [string]$ProjectRoot = "c:/Users/User/Desktop/db agent/querymind",
    [string]$PythonExe = "c:/Users/User/Desktop/db agent/querymind/.venv/Scripts/python.exe",
    [string]$DatabaseUrl = "postgresql://postgres:845623@localhost:5433/postgres",
    [string]$PsqlExe = "C:/Program Files/PostgreSQL/14/bin/psql.exe",
    [switch]$InstallRequirements = $true,
    [switch]$StartApi = $false
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host "[run-querymind-local-postgres] $Message"
}

function Invoke-Checked([string]$FilePath, [string[]]$CommandArgs) {
    & $FilePath @CommandArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $FilePath $($CommandArgs -join ' ')"
    }
}

Set-Location $ProjectRoot

Write-Step "Project root: $ProjectRoot"
Write-Step "Python exe: $PythonExe"
Write-Step "Database URL: $DatabaseUrl"

if (-not (Test-Path $PythonExe)) {
    throw "Python executable not found: $PythonExe"
}

if ($InstallRequirements) {
    Write-Step "Installing requirements"
    Invoke-Checked $PythonExe @("-m", "pip", "install", "-r", "requirements.txt")

    Write-Step "Ensuring psycopg2-binary"
    Invoke-Checked $PythonExe @("-m", "pip", "install", "psycopg2-binary==2.9.9")
}

Write-Step "Running non-Docker PostgreSQL one-click init"
& ".\\scripts\\init_local_postgres.ps1" `
    -ProjectRoot $ProjectRoot `
    -UseDockerBootstrap:$false `
    -DatabaseUrl $DatabaseUrl `
    -PsqlExe $PsqlExe
if ($LASTEXITCODE -ne 0) {
    throw "Command failed: .\\scripts\\init_local_postgres.ps1 -DatabaseUrl $DatabaseUrl -PsqlExe $PsqlExe"
}

Write-Step "Initialization completed"

if ($StartApi) {
    Write-Step "Starting API server"
    Invoke-Checked $PythonExe @("main.py")
}
else {
    Write-Step "Skip API start. Use -StartApi to launch service after init."
}
