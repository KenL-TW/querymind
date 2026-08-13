param(
    [string]$ApiBase = "http://localhost:8080",
    [string]$PythonExe = "c:/Users/User/Desktop/db agent/querymind/.venv/Scripts/python.exe",
    [string]$ProjectRoot = "c:\Users\User\Desktop\db agent\querymind",
    [string]$OwnerEmail = "owner@local",
    [string]$OwnerPassword = "OwnerPass2026",
    [string]$OwnerDisplayName = "Owner",
    [int]$StartupTimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"

function Invoke-JsonGet {
    param([string]$Uri, [hashtable]$Headers = @{})
    Invoke-RestMethod -Method Get -Uri $Uri -Headers $Headers -TimeoutSec 20
}

function Invoke-JsonPost {
    param(
        [string]$Uri,
        [object]$Body,
        [hashtable]$Headers = @{}
    )
    $json = $Body | ConvertTo-Json -Depth 8
    Invoke-RestMethod -Method Post -Uri $Uri -ContentType "application/json" -Body $json -Headers $Headers -TimeoutSec 30
}

function Wait-Health {
    param([string]$BaseUrl, [int]$TimeoutSeconds)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            return Invoke-JsonGet -Uri "$BaseUrl/health"
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    throw "API did not become healthy within $TimeoutSeconds seconds."
}

$startedServer = $false
$serverJob = $null

try {
    $health = $null
    try {
        $health = Invoke-JsonGet -Uri "$ApiBase/health"
    } catch {
        $health = $null
    }

    if (-not $health) {
        $serverJob = Start-Job -ScriptBlock {
            param($Root, $Py)
            Set-Location $Root
            $env:AUTH_ENABLED = "true"
            $env:PYTHONPATH = "."
            & $Py main.py
        } -ArgumentList $ProjectRoot, $PythonExe
        $startedServer = $true
        $health = Wait-Health -BaseUrl $ApiBase -TimeoutSeconds $StartupTimeoutSeconds
    }

    Write-Host "Health:" ($health | ConvertTo-Json -Compress)

    if ($health.first_run_pending) {
        $setup = Invoke-JsonPost -Uri "$ApiBase/v1/auth/first-run/setup" -Body @{
            new_email = $OwnerEmail
            new_password = $OwnerPassword
            display_name = $OwnerDisplayName
        }
        Write-Host "First-run setup complete."
        Write-Host "Setup response:" ($setup | ConvertTo-Json -Compress)
        $token = $setup.access_token
    } else {
        $login = Invoke-JsonPost -Uri "$ApiBase/v1/auth/login" -Body @{
            email = $OwnerEmail
            password = $OwnerPassword
        }
        Write-Host "Login complete."
        Write-Host "Login response:" ($login | ConvertTo-Json -Compress)
        $token = $login.access_token
    }

    $headers = @{ Authorization = "Bearer $token" }
    $me = Invoke-JsonGet -Uri "$ApiBase/v1/me" -Headers $headers
    $systemInfo = Invoke-JsonGet -Uri "$ApiBase/v1/admin/system-info" -Headers $headers
    $usageStats = Invoke-JsonGet -Uri "$ApiBase/v1/admin/usage-stats" -Headers $headers

    Write-Host "Me:" ($me | ConvertTo-Json -Compress)
    Write-Host "SystemInfo:" ($systemInfo | ConvertTo-Json -Compress)
    Write-Host "UsageStats:" ($usageStats | ConvertTo-Json -Compress)
    Write-Host "Smoke test passed."
}
finally {
    if ($startedServer -and $serverJob) {
        Stop-Job $serverJob | Out-Null
        Remove-Job $serverJob | Out-Null
    }
}