param(
    [string]$ProjectRoot = "c:/Users/User/Desktop/db agent/querymind",
    [string]$EnvFile = ".env.local",
    [string]$PythonExe = "c:/Users/User/Desktop/db agent/querymind/.venv/Scripts/python.exe",
    [string]$DatabaseUrl = $env:DATABASE_URL,
    [string]$PgHost = "127.0.0.1",
    [int]$Port = 5432,
    [string]$AdminUser = "postgres",
    [string]$AdminPassword = "",
    [string]$AdminDatabase = "postgres",
    [string]$PsqlExe = "",
    [string]$AppUser = "qm_user",
    [string]$AppPassword = "qm_pass",
    [string]$AppDb = "querymind",
    [string]$MetaDb = "querymind",
    [string]$ContainerName = "querymind-postgres",
    [switch]$UseDockerBootstrap = $false
)

$ErrorActionPreference = "Stop"
$script:PsqlExeResolved = ""

function Write-Step([string]$Message) {
    Write-Host "[init-local-postgres] $Message"
}

function Invoke-Checked([string]$FilePath, [string[]]$CommandArgs) {
    & $FilePath @CommandArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $FilePath $($CommandArgs -join ' ')"
    }
}

function Escape-SqlLiteral([string]$Value) {
    return $Value.Replace("'", "''")
}

function Parse-DatabaseUrl() {
    if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
        return
    }

    $uri = [System.Uri]$DatabaseUrl
    if ($uri.Scheme -notmatch "^postgres") {
        throw "DATABASE_URL must start with postgresql:// or postgres://"
    }

    if ([string]::IsNullOrWhiteSpace($uri.UserInfo)) {
        throw "DATABASE_URL must include user/password. Example: postgresql://postgres:pass@localhost:5433/postgres"
    }

    $parts = $uri.UserInfo.Split(":", 2)
    if ($parts.Count -ne 2) {
        throw "DATABASE_URL userinfo must be user:password"
    }

    $script:AdminUser = [System.Uri]::UnescapeDataString($parts[0])
    $script:AdminPassword = [System.Uri]::UnescapeDataString($parts[1])
    $script:PgHost = $uri.Host
    $script:Port = $uri.Port

    $pathDb = $uri.AbsolutePath.TrimStart("/")
    if (-not [string]::IsNullOrWhiteSpace($pathDb)) {
        $script:AdminDatabase = $pathDb
    }
}

function Ensure-AdminPassword() {
    if ([string]::IsNullOrWhiteSpace($AdminPassword)) {
        $secure = Read-Host "PostgreSQL admin password for user '$AdminUser'" -AsSecureString
        if (-not $secure) {
            throw "Admin password is required."
        }
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            $script:AdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        }
        finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        }
    }
}

function Resolve-PsqlExe() {
    if ($UseDockerBootstrap) {
        return
    }

    if ($PsqlExe -and (Test-Path $PsqlExe)) {
        $script:PsqlExeResolved = $PsqlExe
        return
    }

    $cmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($cmd) {
        $script:PsqlExeResolved = $cmd.Source
        return
    }

    $candidates = @(
        "C:/Program Files/PostgreSQL/17/bin/psql.exe",
        "C:/Program Files/PostgreSQL/16/bin/psql.exe",
        "C:/Program Files/PostgreSQL/15/bin/psql.exe",
        "C:/Program Files/PostgreSQL/14/bin/psql.exe",
        "C:/Program Files/PostgreSQL/13/bin/psql.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            $script:PsqlExeResolved = $candidate
            return
        }
    }

    throw "psql not found. Install PostgreSQL client or provide -PsqlExe."
}

function Resolve-PgPort() {
    if ($UseDockerBootstrap) {
        return
    }

    $reachable = Test-NetConnection -ComputerName $PgHost -Port $Port -InformationLevel Quiet
    if ($reachable) {
        return
    }

    $pids = Get-Process postgres -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id
    if (-not $pids) {
        return
    }

    $ports = @()
    foreach ($line in (netstat -ano)) {
        if ($line -notmatch "LISTENING") {
            continue
        }
        foreach ($pid in $pids) {
            if ($line -match "\s$pid$") {
                if ($line -match ":(\d+)\s+") {
                    $ports += [int]$matches[1]
                }
            }
        }
    }

    $uniquePorts = $ports | Sort-Object -Unique
    if ($uniquePorts.Count -ge 1) {
        $script:Port = $uniquePorts[0]
        Write-Step "Detected PostgreSQL listener on port $Port"
    }
}

function Ensure-DockerPostgres() {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker is required for -UseDockerBootstrap but was not found."
    }

    $exists = docker ps -a --format "{{.Names}}" | Where-Object { $_ -eq $ContainerName }
    if (-not $exists) {
        Write-Step "Creating PostgreSQL Docker container '$ContainerName' on port $Port"
        Invoke-Checked "docker" @(
            "run", "-d",
            "--name", $ContainerName,
            "-e", "POSTGRES_USER=$AdminUser",
            "-e", "POSTGRES_PASSWORD=$AdminPassword",
            "-e", "POSTGRES_DB=postgres",
            "-p", "${Port}:5432",
            "postgres:15"
        )
    }
    else {
        $running = docker ps --format "{{.Names}}" | Where-Object { $_ -eq $ContainerName }
        if (-not $running) {
            Write-Step "Starting existing container '$ContainerName'"
            Invoke-Checked "docker" @("start", $ContainerName)
        }
    }

    Write-Step "Waiting for PostgreSQL readiness"
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        docker exec -e "PGPASSWORD=$AdminPassword" $ContainerName pg_isready -U $AdminUser -d postgres | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Step "PostgreSQL is ready"
            return
        }
    }

    throw "PostgreSQL container did not become ready within timeout."
}

function Invoke-Psql([string]$Sql, [string]$Database = "postgres") {
    if ($UseDockerBootstrap) {
        $args = @(
            "exec",
            "-e", "PGPASSWORD=$AdminPassword",
            $ContainerName,
            "psql",
            "-U", $AdminUser,
            "-d", $Database,
            "-v", "ON_ERROR_STOP=1",
            "-tAc", $Sql
        )
        $output = & docker @args
        if ($LASTEXITCODE -ne 0) {
            throw "psql command failed against DB '$Database'"
        }
        return $output
    }

    $env:PGPASSWORD = $AdminPassword
    $output = & $script:PsqlExeResolved -h $PgHost -p $Port -U $AdminUser -d $Database -v ON_ERROR_STOP=1 -tAc $Sql
    if ($LASTEXITCODE -ne 0) {
        throw "psql command failed against DB '$Database'"
    }
    return $output
}

function Ensure-RoleAndDatabases() {
    $appUserSql = Escape-SqlLiteral $AppUser
    $appPassSql = Escape-SqlLiteral $AppPassword
    $appDbSql = Escape-SqlLiteral $AppDb
    $metaDbSql = Escape-SqlLiteral $MetaDb

    Write-Step "Ensuring role '$AppUser' exists"
        $roleTemplate = @'
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '__APP_USER_SQL__') THEN
        CREATE ROLE "__APP_USER__" LOGIN PASSWORD '__APP_PASS_SQL__';
    ELSE
        ALTER ROLE "__APP_USER__" WITH LOGIN PASSWORD '__APP_PASS_SQL__';
    END IF;
END
$$;
'@
        $roleSql = $roleTemplate.Replace("__APP_USER_SQL__", $appUserSql).Replace("__APP_USER__", $AppUser).Replace("__APP_PASS_SQL__", $appPassSql)
        Invoke-Psql $roleSql $AdminDatabase | Out-Null

    $appDbExistsRaw = Invoke-Psql "SELECT 1 FROM pg_database WHERE datname = '$appDbSql';" $AdminDatabase
    $appDbExists = if ($null -eq $appDbExistsRaw) { "" } else { "$appDbExistsRaw".Trim() }
    if (-not $appDbExists) {
        Write-Step "Creating database '$AppDb'"
        $createAppDbSql = 'CREATE DATABASE "{0}" OWNER "{1}";' -f $AppDb, $AppUser
        Invoke-Psql $createAppDbSql $AdminDatabase | Out-Null
    }

    if ($MetaDb -ne $AppDb) {
        $metaDbExistsRaw = Invoke-Psql "SELECT 1 FROM pg_database WHERE datname = '$metaDbSql';" $AdminDatabase
        $metaDbExists = if ($null -eq $metaDbExistsRaw) { "" } else { "$metaDbExistsRaw".Trim() }
        if (-not $metaDbExists) {
            Write-Step "Creating database '$MetaDb'"
            $createMetaDbSql = 'CREATE DATABASE "{0}" OWNER "{1}";' -f $MetaDb, $AppUser
            Invoke-Psql $createMetaDbSql $AdminDatabase | Out-Null
        }
    }

    Write-Step "Granting database and schema privileges"
    $grantAppDbSql = 'GRANT ALL PRIVILEGES ON DATABASE "{0}" TO "{1}";' -f $AppDb, $AppUser
    $grantSchemaSql = 'GRANT USAGE, CREATE ON SCHEMA public TO "{0}";' -f $AppUser
    Invoke-Psql $grantAppDbSql $AdminDatabase | Out-Null
    if ($MetaDb -ne $AppDb) {
        $grantMetaDbSql = 'GRANT ALL PRIVILEGES ON DATABASE "{0}" TO "{1}";' -f $MetaDb, $AppUser
        Invoke-Psql $grantMetaDbSql $AdminDatabase | Out-Null
    }
    Invoke-Psql $grantSchemaSql $AppDb | Out-Null
    if ($MetaDb -ne $AppDb) {
        Invoke-Psql $grantSchemaSql $MetaDb | Out-Null
    }
}

function Upsert-EnvLine([string]$Path, [string]$Key, [string]$Value) {
    if (-not (Test-Path $Path)) {
        New-Item -Path $Path -ItemType File -Force | Out-Null
    }

    $content = Get-Content -Path $Path -Raw
    $escapedKey = [regex]::Escape($Key)
    $pattern = "(?m)^$escapedKey=.*$"
    $newLine = "$Key=$Value"

    if ([regex]::IsMatch($content, $pattern)) {
        $updated = [regex]::Replace($content, $pattern, $newLine)
    }
    else {
        if ($content -and -not $content.EndsWith("`n")) {
            $content += "`r`n"
        }
        $updated = $content + $newLine + "`r`n"
    }

    Set-Content -Path $Path -Value $updated -NoNewline
}

function Update-EnvFile() {
    if (-not (Test-Path $EnvFile)) {
        if (Test-Path ".env.local.example") {
            Copy-Item ".env.local.example" $EnvFile -Force
            Write-Step "Created $EnvFile from .env.local.example"
        }
        else {
            New-Item -Path $EnvFile -ItemType File -Force | Out-Null
            Write-Step "Created empty $EnvFile"
        }
    }

    if ($MetaDb -ne $AppDb) {
        Write-Step "Using split databases: app='$AppDb', metadata='$MetaDb'"
    }
    else {
        Write-Step "Using single database mode: '$AppDb' for app + metadata"
    }

    $appUrl = "postgresql+psycopg2://${AppUser}:${AppPassword}@${PgHost}:${Port}/$AppDb"
    $metaUrl = "postgresql+psycopg2://${AppUser}:${AppPassword}@${PgHost}:${Port}/$MetaDb"
    $dbConnectionsJson = '{"default":"' + $appUrl + '"}'
    $adminUrlNormalized = "postgresql://${AdminUser}:${AdminPassword}@${PgHost}:${Port}/$AdminDatabase"

    Upsert-EnvLine -Path $EnvFile -Key "DB_CONNECTIONS" -Value $dbConnectionsJson
    Upsert-EnvLine -Path $EnvFile -Key "METADATA_DB_URL" -Value $metaUrl
    Upsert-EnvLine -Path $EnvFile -Key "DATABASE_URL" -Value $adminUrlNormalized
    Upsert-EnvLine -Path $EnvFile -Key "ENVIRONMENT" -Value "local"

    Write-Step "Updated $EnvFile with PostgreSQL connection strings"

    return @{
        AppUrl = $appUrl
        MetaUrl = $metaUrl
    }
}

function Run-PythonInit([string]$AppUrl, [string]$MetaUrl) {
    if (-not (Test-Path $PythonExe)) {
        throw "Python executable not found: $PythonExe"
    }

    Write-Step "Running metadata DB initialization"
    Invoke-Checked $PythonExe @("infra/scripts/init_meta_db.py")

    Write-Step "Running metadata seed"
    Invoke-Checked $PythonExe @("infra/scripts/seed_metadata.py", "--db-url", $MetaUrl)

    Write-Step "Running application demo seed"
    Invoke-Checked $PythonExe @("seed_demo.py", "--db-url", $AppUrl)
}

Set-Location $ProjectRoot

Parse-DatabaseUrl

if ($UseDockerBootstrap) {
    Ensure-AdminPassword
    Ensure-DockerPostgres
}
else {
    Resolve-PsqlExe
    Resolve-PgPort
    Ensure-AdminPassword
}

Ensure-RoleAndDatabases
$urls = Update-EnvFile
Run-PythonInit -AppUrl $urls.AppUrl -MetaUrl $urls.MetaUrl

Write-Step "Done. Local PostgreSQL initialization completed successfully."
