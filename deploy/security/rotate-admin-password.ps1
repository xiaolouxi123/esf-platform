# Rotate the local administrator password on a remote machine via WinRM.
#
# Usage (run ON the dev workstation, PowerShell 5.1, ASCII-only by design):
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy\security\rotate-admin-password.ps1 `
#     -ComputerName 119.29.82.217 -PwdFile "$env:TEMP\esf-newbox.pwd"
#
# What it does:
#   1. Reads the CURRENT password from -PwdFile (plain text file, e.g. %TEMP%\esf-newbox.pwd)
#   2. Generates a random 22-char ASCII password
#   3. Connects WinRM with the current password and changes the account password
#   4. Re-connects with the NEW password to verify nothing was mistyped
#   5. On success, overwrites -PwdFile with the new password
#
# If verification fails the script exits 1 WITHOUT touching -PwdFile.
# Never commit this file with real values; it takes everything from parameters.

param(
    [Parameter(Mandatory = $true)][string]$ComputerName,
    [Parameter(Mandatory = $true)][string]$PwdFile,
    [string]$Account = 'administrator'
)

$ErrorActionPreference = 'Stop'

function New-RandomPassword {
    # Alphabet deliberately avoids: 0/O, 1/l/I (readability) and shell-hostile chars
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-_.@#'
    $length = 22
    $bytes = New-Object byte[] $length
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    $sb = New-Object System.Text.StringBuilder
    for ($i = 0; $i -lt $length; $i++) {
        [void]$sb.Append($alphabet[$bytes[$i] % $alphabet.Length])
    }
    return $sb.ToString()
}

if (-not (Test-Path $PwdFile)) {
    Write-Output ("FAIL: password file not found: " + $PwdFile)
    exit 1
}

$old = (Get-Content $PwdFile -Raw).Trim()
if (-not $old) {
    Write-Output "FAIL: password file is empty"
    exit 1
}

$new = New-RandomPassword

# --- 1. connect with the CURRENT password ---
$oldSec = ConvertTo-SecureString $old -AsPlainText -Force
$oldCred = New-Object System.Management.Automation.PSCredential($Account, $oldSec)
$session = New-PSSession -ComputerName $ComputerName -Credential $oldCred -ErrorAction Stop

try {
    # --- 2. change the password on the remote machine ---
    Invoke-Command -Session $session -ScriptBlock {
        param($acct, $newp)
        $user = [ADSI]("WinNT://./" + $acct + ",user")
        $user.Invoke("SetPassword", $newp)
    } -ArgumentList $Account, $new
} finally {
    Remove-PSSession -Session $session -ErrorAction SilentlyContinue
}

# --- 3. verify the NEW password before saving anything ---
$newSec = ConvertTo-SecureString $new -AsPlainText -Force
$newCred = New-Object System.Management.Automation.PSCredential($Account, $newSec)
try {
    $verify = New-PSSession -ComputerName $ComputerName -Credential $newCred -ErrorAction Stop
    $who = Invoke-Command -Session $verify -ScriptBlock { whoami }
    Remove-PSSession -Session $verify
} catch {
    Write-Output "FAIL: new password could not be verified - DO NOT lose the old one. Error:"
    Write-Output $_.Exception.Message
    Write-Output "New password (copy it somewhere safe NOW):"
    Write-Output $new
    exit 1
}

# --- 4. persist the new password ---
Set-Content -Path $PwdFile -Value $new -Encoding ascii -NoNewline

Write-Output ("ROTATED OK on " + $ComputerName + " (" + $who + ")")
Write-Output ("New password saved to: " + $PwdFile)
Write-Output "REMINDER: if any RDP saved-credential / scheduled task / script also used this"
Write-Output "account, update them with the new password now."
