param(
    [string]$DeviceSerial
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$findApk = Join-Path $PSScriptRoot "find-android-apk.ps1"
if (-not (Test-Path $findApk)) {
    throw "APK locator is missing: $findApk"
}

$adbCommand = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adbCommand) {
    $candidate = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
    if (Test-Path $candidate) {
        $adb = $candidate
    } else {
        throw "adb was not found. Install Android SDK Platform-Tools or add adb to PATH."
    }
} else {
    $adb = $adbCommand.Source
}

$devices = @(
    & $adb devices |
        Select-Object -Skip 1 |
        ForEach-Object {
            if ($_ -match '^([^\s]+)\s+device$') { $Matches[1] }
        }
)

if ($DeviceSerial) {
    if ($devices -notcontains $DeviceSerial) {
        throw "Android device '$DeviceSerial' is not connected or authorized. Connected devices: $($devices -join ', ')"
    }
    $serial = $DeviceSerial
} elseif ($devices.Count -eq 1) {
    $serial = $devices[0]
} elseif ($devices.Count -eq 0) {
    throw "No authorized Android phone was found. Enable USB debugging and run adb devices."
} else {
    throw "Multiple devices are connected. Run: pnpm android:install -- -DeviceSerial <serial>"
}

$apk = (& $findApk -PathOnly | Select-Object -Last 1).Trim()
if (-not (Test-Path $apk)) {
    throw "Resolved APK does not exist: $apk"
}

Write-Host "Installing $(Split-Path -Leaf $apk) on $serial..." -ForegroundColor Cyan
& $adb -s $serial install -r $apk
if ($LASTEXITCODE -ne 0) {
    throw "adb install failed with exit code $LASTEXITCODE."
}

Write-Host "Aether installed successfully on $serial." -ForegroundColor Green
