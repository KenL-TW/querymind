param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  throw 'psql is required. Install PostgreSQL client tools before exporting.'
}
if ([string]::IsNullOrWhiteSpace($env:PGHOST) -or [string]::IsNullOrWhiteSpace($env:PGDATABASE) -or [string]::IsNullOrWhiteSpace($env:PGUSER)) {
  throw 'Set PGHOST, PGDATABASE, PGUSER and PGPASSWORD in the current shell. Values are never written by this script.'
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$tables = @(
  'departments', 'employees', 'categories', 'suppliers', 'customers',
  'customer_addresses', 'products', 'promotions', 'orders', 'order_items',
  'inventory_transactions', 'product_reviews', 'sales_targets', 'support_tickets'
)

foreach ($table in $tables) {
  $target = Join-Path $resolvedOutput "$table.csv"
  $query = "\copy (SELECT * FROM public.$table ORDER BY id) TO STDOUT WITH (FORMAT CSV, HEADER TRUE, NULL '\N')"
  & psql -X --set ON_ERROR_STOP=1 --command $query | Set-Content -LiteralPath $target -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL export failed for table $table." }
}

Write-Output "Exported $($tables.Count) tables to $resolvedOutput"

