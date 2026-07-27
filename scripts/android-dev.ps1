param(
    [string]$DeviceSerial
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Resolve-Adb {
    $adbCommand = Get-Command adb -ErrorAction SilentlyContinue
    if ($adbCommand) {
        return $adbCommand.Source
    }

    $sdkRoots = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA "Android\Sdk")
    ) | Where-Object { $_ }

    foreach ($sdkRoot in $sdkRoots) {
        $candidate = Join-Path $sdkRoot "platform-tools\adb.exe"
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw "adb was not found. Reopen PowerShell after installing Android SDK Platform-Tools."
}

$adb = Resolve-Adb
$connectedDevices = @(
    & $adb devices |
        Select-Object -Skip 1 |
        ForEach-Object {
            if ($_ -match '^([^\s]+)\s+device$') {
                $Matches[1]
            }
        }
)

if ($DeviceSerial) {
    if ($connectedDevices -notcontains $DeviceSerial) {
        throw "Android device '$DeviceSerial' is not connected or not authorized. Connected devices: $($connectedDevices -join ', ')"
    }
    $serial = $DeviceSerial
}
elseif ($connectedDevices.Count -eq 1) {
    $serial = $connectedDevices[0]
}
elseif ($connectedDevices.Count -eq 0) {
    throw "No authorized Android device was found. Check USB debugging and run 'adb devices'."
}
else {
    throw "Multiple Android devices are connected. Run: pnpm android:dev -- -DeviceSerial <serial>"
}

$devPort = 1420
$hmrPort = 1421
$exitCode = 1

Write-Host "Using Android device: $serial" -ForegroundColor Cyan
Write-Host "Routing device localhost ports through USB ADB; VPN and LAN adapter addresses will be ignored." -ForegroundColor Cyan

try {
    & $adb -s $serial reverse --remove "tcp:$devPort" 2>$null | Out-Null
    & $adb -s $serial reverse --remove "tcp:$hmrPort" 2>$null | Out-Null

    & $adb -s $serial reverse "tcp:$devPort" "tcp:$devPort"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create the ADB reverse tunnel for Vite on port $devPort."
    }

    & $adb -s $serial reverse "tcp:$hmrPort" "tcp:$hmrPort"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create the ADB reverse tunnel for HMR on port $hmrPort."
    }

    $env:TAURI_DEV_HOST = "127.0.0.1"
    & pnpm tauri android dev --host 127.0.0.1
    $exitCode = $LASTEXITCODE
}
finally {
    & $adb -s $serial reverse --remove "tcp:$devPort" 2>$null | Out-Null
    & $adb -s $serial reverse --remove "tcp:$hmrPort" 2>$null | Out-Null
}

exit $exitCode
