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

function Resolve-Python {
    foreach ($name in @("python", "python3")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) {
            return @{ Command = $command.Source; Prefix = @() }
        }
    }
    $launcher = Get-Command py -ErrorAction SilentlyContinue
    if ($launcher) {
        return @{ Command = $launcher.Source; Prefix = @("-3") }
    }
    throw "Python 3 was not found. Install Python 3 and reopen PowerShell."
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
$platformToolsDirectory = Split-Path -Parent $adb
$androidSdkDirectory = Split-Path -Parent $platformToolsDirectory
if (
    (Test-Path (Join-Path $androidSdkDirectory "platform-tools\adb.exe")) -and
    -not $env:ANDROID_HOME
) {
    $env:ANDROID_HOME = $androidSdkDirectory
}
if (-not $env:ANDROID_SDK_ROOT -and $env:ANDROID_HOME) {
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
}
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

$prepareIcons = Join-Path $PSScriptRoot "prepare-android-icons.ps1"
if (-not (Test-Path $prepareIcons)) {
    throw "Android icon preparation script is missing: $prepareIcons"
}
& $prepareIcons
if ($LASTEXITCODE -ne 0) {
    throw "Android icon preparation failed with exit code $LASTEXITCODE."
}

$prepareNative = Join-Path $PSScriptRoot "prepare-android-native-final.ps1"
if (-not (Test-Path $prepareNative)) {
    throw "Final Android native preparation script is missing: $prepareNative"
}
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

$serviceSource = Join-Path $repoRoot "src-tauri\plugins\aether-vpn\android\src\main\java\FinalAetherVpnPlugin.kt"
$efficiencyPatch = Join-Path $repoRoot "scripts\ci\patch-android-mobile-efficiency.py"
if (-not (Test-Path $serviceSource) -or -not (Test-Path $efficiencyPatch)) {
    throw "Android mobile-efficiency source or patch is missing."
}
$serviceBackup = [System.IO.File]::ReadAllBytes($serviceSource)
$python = Resolve-Python

$devPort = 1420
$hmrPort = 1421
$exitCode = 1

Write-Host "Routing device localhost ports through USB ADB; VPN and LAN adapter addresses will be ignored." -ForegroundColor Cyan

try {
    & $python.Command @($python.Prefix + @($efficiencyPatch, $repoRoot))
    if ($LASTEXITCODE -ne 0) {
        throw "Android mobile-efficiency patch failed with exit code $LASTEXITCODE."
    }

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
    [System.IO.File]::WriteAllBytes($serviceSource, $serviceBackup)
    Remove-AdbReverseQuietly -AdbPath $adb -Serial $serial -Port $devPort
    Remove-AdbReverseQuietly -AdbPath $adb -Serial $serial -Port $hmrPort
}

exit $exitCode
