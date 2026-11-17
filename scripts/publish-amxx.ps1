param(
    [string]$SourceDir = 'C:\esf-build\amxx',
    [string]$Version = '',
    [string]$Notes = '',
    [string]$OutDir = 'C:\esf-release\amxx',
    [string]$ServerHost = '119.29.82.217',
    [string]$ServerUser = 'administrator',
    [string]$PasswordFile = "$env:TEMP\esf-newbox.pwd",
    [string]$RemoteDir = 'C:\esf\updates\amxx',
    [switch]$SkipUpload,
    [switch]$AllowRebuild,
    [switch]$SkipBuildCheck
)
$ErrorActionPreference = 'Stop'
$managed = @('esf_gamemode.amxx', 'esf_platform_auth.amxx', 'esf_ranked_lock.amxx', 'test_ranked.amxx')
if (-not (Test-Path $SourceDir)) { throw "source dir not found: $SourceDir" }
$files = @()
foreach ($m in $managed) {
    $p = Join-Path $SourceDir $m
    if (-not (Test-Path $p)) { throw "missing plugin: $p" }
    $files += Get-Item $p
}
if (-not $Version) { $Version = (Get-Date).ToString('yyyy.MM.dd-HHmm') }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$zipName = "esf-challenge-plugins-$Version.zip"
$zipPath = Join-Path $OutDir $zipName
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
foreach ($f in $files) { [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $f.Name) | Out-Null }
$zip.Dispose()
$zipInfo = Get-Item $zipPath
$zipHash = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
$pluginInfo = @()
foreach ($f in $files) {
    $pluginInfo += [ordered]@{
        name   = $f.Name
        size   = $f.Length
        sha256 = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower()
    }
}
$manifest = [ordered]@{
    channel  = 'amxx'
    version  = $Version
    file     = $zipName
    size     = $zipInfo.Length
    sha256   = $zipHash
    builtAt  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    notes    = $Notes
    plugins  = $pluginInfo
}
# Same version + new content is delivered by the updater, but it was the root of the 0.53 incident.
# Check that every plugin binary actually contains the package version (its BUILD constant).
$missing = @()
foreach ($f in $files) {
    $text = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::GetEncoding(28591))
    if ($text.IndexOf($Version) -lt 0) { $missing += $f.Name }
}
if ($missing.Count -gt 0) {
    Write-Warning ("plugin binaries missing version string " + $Version + ": " + ($missing -join ', '))
    Write-Warning '  -> likely built from stale sources; fix the BUILD constant or pass -SkipBuildCheck'
    # Advisory only: .amxx payloads may be compressed, so a missing string does not prove a stale build.
    if ($SkipBuildCheck) { 'build check skipped (-SkipBuildCheck)' }
}

$manifestPath = Join-Path $OutDir 'manifest.json'
$json = $manifest | ConvertTo-Json -Depth 5; [System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
"zip    : $zipPath ($($zipInfo.Length) bytes)"
"sha256 : $zipHash"
"manifest: $manifestPath"

if (-not $SkipUpload) {
    if (-not (Test-Path $PasswordFile)) { throw "password file not found: $PasswordFile" }
    $pw = (Get-Content $PasswordFile -Raw).Trim()
    $sec = ConvertTo-SecureString $pw -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential($ServerUser, $sec)
    $s = New-PSSession -ComputerName $ServerHost -Credential $cred -Authentication Negotiate
    try {
        # 同版本护栏：远端已发布过同一版本号时，内容不同必须显式确认，内容相同直接跳过。
        $remoteRaw = Invoke-Command -Session $s -ScriptBlock { param($d) $p = Join-Path $d 'manifest.json'; if (Test-Path $p) { Get-Content $p -Raw } } -ArgumentList $RemoteDir
        if ($remoteRaw) {
            $remote = $remoteRaw | ConvertFrom-Json
            if ($remote.version -eq $Version) {
                if ($remote.sha256 -eq $zipHash) {
                    "already published: $Version / $zipHash (nothing to upload)"
                    if (-not $AllowRebuild) { Remove-PSSession $s; exit 0 }
                } elseif (-not $AllowRebuild) {
                    throw "version $Version already published with different content (remote $($remote.sha256), local $zipHash). Pass -AllowRebuild to republish."
                } else {
                    "rebuild confirmed for $Version (-AllowRebuild)"
                }
            }
        }
        Invoke-Command -Session $s -ScriptBlock { param($d) if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null } } -ArgumentList $RemoteDir
        Copy-Item -ToSession $s -Path $zipPath -Destination "$RemoteDir\$zipName" -Force
        Copy-Item -ToSession $s -Path $manifestPath -Destination "$RemoteDir\manifest.json" -Force
        $check = Invoke-Command -Session $s -ScriptBlock { param($d, $f) Get-ChildItem $d | Select-Object Name, Length } -ArgumentList $RemoteDir
        $check | Format-Table -AutoSize
    } finally {
        Remove-PSSession $s
    }
    "uploaded to $ServerHost $RemoteDir"
}

