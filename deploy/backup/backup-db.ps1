<#
.SYNOPSIS
  Create a consistent MySQL logical backup for the ESF platform.

.DESCRIPTION
  Runs mysqldump with a dedicated MySQL option file, writes an uncompressed .sql
  file (the database is small), records a SHA-256 sidecar, applies retention and
  optionally copies the result to a second directory.

  The MySQL account only needs SELECT, LOCK TABLES, SHOW VIEW, EVENT and TRIGGER
  on the platform database. The password lives in the option file, never in this
  script or in Task Scheduler arguments.

.PARAMETER BackupDir
  Directory for .sql, .sha256 and backup.log. Default: C:\esf\backups

.PARAMETER RetentionDays
  Delete backups older than this many days. Default: 14

.PARAMETER MySqlDump
  Full path to mysqldump.exe. Default: C:\esf\mysql\bin\mysqldump.exe

.PARAMETER DefaultsFile
  MySQL option file containing [client] user/password/host.
  Default: C:\esf\backup\backup.cnf

.PARAMETER Database
  Database name. Default: esf_platform

.PARAMETER OffsiteDir
  Optional second directory (another disk or UNC share) to copy the backup to.
  A copy failure is logged as a warning and does not delete the local backup.

.PARAMETER RequiredPattern
  Optional literal text that must appear in the dump. For this platform use
  settle_ranked_match so a dump with missing routines fails loudly.
#>
[CmdletBinding()]
param(
  [string]$BackupDir = 'C:\esf\backups',
  [int]$RetentionDays = 14,
  [string]$MySqlDump = 'C:\esf\mysql\bin\mysqldump.exe',
  [string]$DefaultsFile = 'C:\esf\backup\backup.cnf',
  [string]$Database = 'esf_platform',
  [string]$OffsiteDir = '',
  [string]$RequiredPattern = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($RetentionDays -lt 1) { throw 'RetentionDays must be >= 1' }
if ($Database -notmatch '^[A-Za-z0-9_]+$') { throw "Unsafe database name: $Database" }
if (-not (Test-Path -LiteralPath $MySqlDump)) { throw "mysqldump not found: $MySqlDump" }
if (-not (Test-Path -LiteralPath $DefaultsFile)) { throw "MySQL option file not found: $DefaultsFile" }

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$logFile = Join-Path $BackupDir 'backup.log'

function Write-BackupLog([string]$Message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  Write-Host $line
}

$started = Get-Date
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$baseName = "$Database-$stamp"
$sqlPath = Join-Path $BackupDir "$baseName.sql"
$hashPath = "$sqlPath.sha256"

Write-BackupLog "backup start database=$Database target=$sqlPath"

$dumpArgs = @(
  "--defaults-extra-file=$DefaultsFile",
  '--single-transaction',
  '--quick',
  '--routines',
  '--triggers',
  '--events',
  '--hex-blob',
  '--no-tablespaces',
  '--set-gtid-purged=OFF',
  '--default-character-set=utf8mb4',
  "--result-file=$sqlPath",
  $Database
)

try {
  & $MySqlDump @dumpArgs 2>> $logFile
  if ($LASTEXITCODE -ne 0) {
    throw "mysqldump exited with code $LASTEXITCODE"
  }

  if (-not (Test-Path -LiteralPath $sqlPath)) {
    throw 'mysqldump did not create the output file'
  }

  $file = Get-Item -LiteralPath $sqlPath
  if ($file.Length -lt 1024) {
    throw "backup is suspiciously small: $($file.Length) bytes"
  }

  $tail = (Get-Content -LiteralPath $sqlPath -Tail 20 | Out-String)
  if ($tail -notmatch 'Dump completed') {
    throw 'backup is incomplete: missing "Dump completed" marker'
  }

  if ($RequiredPattern) {
    $found = Select-String -LiteralPath $sqlPath -Pattern $RequiredPattern -SimpleMatch -Quiet
    if (-not $found) {
      throw "backup is missing required pattern: $RequiredPattern"
    }
  }

  $hash = (Get-FileHash -LiteralPath $sqlPath -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $baseName.sql" | Set-Content -LiteralPath $hashPath -Encoding ASCII

  $elapsed = [int]((Get-Date) - $started).TotalSeconds
  Write-BackupLog "backup ok size=$($file.Length) sha256=$hash elapsed=${elapsed}s"
} catch {
  Write-BackupLog "backup FAILED: $($_.Exception.Message)"
  if (Test-Path -LiteralPath $sqlPath) { Remove-Item -LiteralPath $sqlPath -Force }
  if (Test-Path -LiteralPath $hashPath) { Remove-Item -LiteralPath $hashPath -Force }
  exit 1
}

# Retention: only touch files created by this script's naming convention.
$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -Path $BackupDir -Filter "$Database-*.sql" -File |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  ForEach-Object {
    $oldSql = $_.FullName
    $oldHash = "$oldSql.sha256"
    Remove-Item -LiteralPath $oldSql -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $oldHash -Force -ErrorAction SilentlyContinue
    Write-BackupLog "retention removed $(Split-Path -Leaf $oldSql)"
  }

if ($OffsiteDir) {
  try {
    New-Item -ItemType Directory -Force -Path $OffsiteDir | Out-Null
    Copy-Item -LiteralPath $sqlPath -Destination $OffsiteDir -Force
    Copy-Item -LiteralPath $hashPath -Destination $OffsiteDir -Force
    Write-BackupLog "offsite copy ok target=$OffsiteDir"
  } catch {
    Write-BackupLog "offsite copy WARNING: $($_.Exception.Message)"
  }
}

Write-BackupLog 'backup done'
exit 0
