$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

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

$prepareIcons = Join-Path $PSScriptRoot "prepare-android-icons.ps1"
$prepareNative = Join-Path $PSScriptRoot "prepare-android-native-final.ps1"
$efficiencyPatch = Join-Path $repoRoot "scripts\ci\patch-android-mobile-efficiency.py"
$serviceSource = Join-Path $repoRoot "src-tauri\plugins\aether-vpn\android\src\main\java\FinalAetherVpnPlugin.kt"

foreach ($required in @($prepareIcons, $prepareNative, $efficiencyPatch, $serviceSource)) {
    if (-not (Test-Path $required)) {
        throw "Required Android build input is missing: $required"
    }
}

& $prepareIcons
if ($LASTEXITCODE -ne 0) {
    throw "Android icon preparation failed with exit code $LASTEXITCODE."
}

& $prepareNative
if ($LASTEXITCODE -ne 0) {
    throw "Android native runtime preparation failed with exit code $LASTEXITCODE."
}

$serviceBackup = [System.IO.File]::ReadAllBytes($serviceSource)
$python = Resolve-Python
$exitCode = 1
try {
    & $python.Command @($python.Prefix + @($efficiencyPatch, $repoRoot))
    if ($LASTEXITCODE -ne 0) {
        throw "Android mobile-efficiency patch failed with exit code $LASTEXITCODE."
    }

    $env:VITE_AETHER_PLATFORM = "android"
    & pnpm tauri android build --apk --target aarch64 --split-per-abi
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "Android ARM64 APK build failed with exit code $exitCode."
    }
}
finally {
    [System.IO.File]::WriteAllBytes($serviceSource, $serviceBackup)
}

& (Join-Path $PSScriptRoot "find-android-apk.ps1")
exit $exitCode
