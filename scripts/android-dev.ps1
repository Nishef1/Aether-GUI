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

function Remove-AdbReverseQuietly {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AdbPath,
        [Parameter(Mandatory = $true)]
        [string]$Serial,
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    # A missing listener is the expected state on the first run. adb writes that
    # condition to stderr, and the script-wide Stop preference would otherwise
    # turn harmless cleanup into a fatal NativeCommandError.
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "SilentlyContinue"
        & $AdbPath -s $Serial reverse --remove "tcp:$Port" *> $null
    }
    catch {
        # Cleanup is best-effort. Real reverse-creation failures are handled below.
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
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

Write-Host "Using Android device: $serial" -ForegroundColor Cyan

$prepareNative = Join-Path $PSScriptRoot "prepare-android-native.ps1"
if (-not (Test-Path $prepareNative)) {
    throw "Android native preparation script is missing: $prepareNative"
}

# Tauri builds only the Rust application library. The executable Aether core and
# TUN bridge are separate native payloads and must already exist in jniLibs.
& $prepareNative
if ($LASTEXITCODE -ne 0) {
    throw "Android native runtime preparation failed with exit code $LASTEXITCODE."
}

$nativeDirectory = Join-Path $repoRoot "src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a"
foreach ($nativeName in @(
    "libaether_exec.so",
    "libhev-socks5-tunnel.so",
    "libaethertun.so"
)) {
    $nativePath = Join-Path $nativeDirectory $nativeName
    if (-not (Test-Path $nativePath)) {
        throw "Required Android native payload was not bundled: $nativePath"
    }
}

$devPort = 1420
$hmrPort = 1421
$exitCode = 1

Write-Host "Routing device localhost ports through USB ADB; VPN and LAN adapter addresses will be ignored." -ForegroundColor Cyan

try {
    Remove-AdbReverseQuietly -AdbPath $adb -Serial $serial -Port $devPort
    Remove-AdbReverseQuietly -AdbPath $adb -Serial $serial -Port $hmrPort

    & $adb -s $serial reverse "tcp:$devPort" "tcp:$devPort"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create the ADB reverse tunnel for Vite on port $devPort."
    }

    & $adb -s $serial reverse "tcp:$hmrPort" "tcp:$hmrPort"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create the ADB reverse tunnel for HMR on port $hmrPort."
    }

    $env:TAURI_DEV_HOST = "127.0.0.1"
    $env:VITE_AETHER_PLATFORM = "android"
    & pnpm tauri android dev --host 127.0.0.1
    $exitCode = $LASTEXITCODE
}
finally {
    Remove-AdbReverseQuietly -AdbPath $adb -Serial $serial -Port $devPort
    Remove-AdbReverseQuietly -AdbPath $adb -Serial $serial -Port $hmrPort
}

exit $exitCode
