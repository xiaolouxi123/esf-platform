<#
.SYNOPSIS
  Restore a backup into a throw-away database and run sanity checks.

.DESCRIPTION
  This is the restore drill. It creates a temporary database, imports the .sql
  dump, checks the schema/core row counts, then drops the database. Production
  data is never touched.

  AdminDefaultsFile must point to a MySQL option file with CREATE/DROP and
  INSERT/ALTER privileges (normally root). Keep it outside the repository,
  restrict its ACL, and delete it after the drill.

.PARAMETER BackupFile
  Full path to a .sql file created by backup-db.ps1.

.PARAMETER MySql
  Full path to mysql.exe. Default: C:\esf\mysql\bin\mysql.exe

.PARAMETER AdminDefaultsFile
  MySQL option file for an administrative account.

.PARAMETER DatabasePrefix
  Prefix for the temporary database. Default: esf_restore_check_

.PARAMETER KeepDatabase
  Keep the temporary database for manual inspection. The caller must drop it.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,

  [string]$MySql = 'C:\esf\mysql\bin\mysql.exe',

  [Parameter(Mandatory = $true)]
  [string]$AdminDefaultsFile,

  [string]$DatabasePrefix = 'esf_restore_check_',

  [string]$RequiredRoutine = 'settle_ranked_match',

  [switch]$KeepDatabase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $BackupFile)) { throw "backup not found: $BackupFile" }
if (-not (Test-Path -LiteralPath $MySql)) { throw "mysql client not found: $MySql" }
if (-not (Test-Path -LiteralPath $AdminDefaultsFile)) { throw "admin option file not found: $AdminDefaultsFile" }
if ($DatabasePrefix -notmatch '^[A-Za-z0-9_]+$') { throw "Unsafe database prefix: $DatabasePrefix" }
if ($RequiredRoutine -and $RequiredRoutine -notmatch '^[A-Za-z0-9_]+$') { throw "Unsafe routine name: $RequiredRoutine" }

$backup = Get-Item -LiteralPath $BackupFile
if ($backup.Length -lt 1024) { throw "backup is suspiciously small: $($backup.Length) bytes" }

$tail = (Get-Content -LiteralPath $BackupFile -Tail 20 | Out-String)
if ($tail -notmatch 'Dump completed') { throw 'backup is incomplete: missing "Dump completed" marker' }

$db = $DatabasePrefix + (Get-Date -Format 'yyyyMMdd_HHmmss')
if ($db -notmatch '^[A-Za-z0-9_]+$') { throw "Unsafe temp database name: $db" }

function Invoke-Mysql {
  param([string[]]$Arguments)
  & $MySql @Arguments
  if ($LASTEXITCODE -ne 0) { throw "mysql exited with code $LASTEXITCODE" }
}

$created = $false
try {
  Write-Host "creating temporary database $db"
  Invoke-Mysql @(
    "--defaults-extra-file=$AdminDefaultsFile",
    '-e',
    "CREATE DATABASE ``$db`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
  )
  $created = $true

  Write-Host "importing $($backup.FullName) into $db"
  $importArgs = @("--defaults-extra-file=`"$AdminDefaultsFile`"", $db)
  $process = Start-Process -FilePath $MySql -ArgumentList $importArgs `
    -RedirectStandardInput $backup.FullName -NoNewWindow -PassThru -Wait
  if ($process.ExitCode -ne 0) {
    throw "restore import failed with exit code $($process.ExitCode)"
  }

  $query = @"
SELECT COUNT(*) AS tables_count
  FROM information_schema.tables
 WHERE table_schema = '$db';
SELECT COUNT(*) AS users_count FROM ``$db``.users;
SELECT COUNT(*) AS servers_count FROM ``$db``.servers;
SELECT COUNT(*) AS titles_count FROM ``$db``.titles;
SELECT COUNT(*) AS routine_count
  FROM information_schema.routines
 WHERE routine_schema = '$db' AND routine_name = '$RequiredRoutine';
"@
  $rows = & $MySql "--defaults-extra-file=$AdminDefaultsFile" -N -e $query
  if ($LASTEXITCODE -ne 0) { throw "verification query failed with code $LASTEXITCODE" }

  $counts = @($rows | ForEach-Object { [int]($_ -split "`t")[0] })
  if ($counts.Count -lt 5) { throw "unexpected verification output: $($rows -join ' | ')" }

  $tables = $counts[0]
  $users = $counts[1]
  $servers = $counts[2]
  $titles = $counts[3]
  $routine = $counts[4]

  Write-Host "restore ok tables=$tables users=$users servers=$servers titles=$titles routine=$routine"

  if ($tables -lt 15) { throw "restored schema looks incomplete: only $tables tables" }
  if ($users -lt 1) { throw 'restored data has no users' }
  if ($RequiredRoutine -and $routine -lt 1) { throw "restored database is missing routine: $RequiredRoutine" }
} finally {
  if ($created -and -not $KeepDatabase) {
    Write-Host "dropping temporary database $db"
    & $MySql "--defaults-extra-file=$AdminDefaultsFile" -e "DROP DATABASE IF EXISTS ``$db``"
    if ($LASTEXITCODE -ne 0) { Write-Warning "failed to drop temporary database $db" }
  } elseif ($created -and $KeepDatabase) {
    Write-Host "kept temporary database $db (drop it manually)"
  }
}
