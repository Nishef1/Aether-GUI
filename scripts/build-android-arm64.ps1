param(
    [switch]$Debug
)

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
$releaseSigningPatch = Join-Path $repoRoot "scripts\ci\patch-android-release-signing.py"
$serviceSource = Join-Path $repoRoot "src-tauri\plugins\aether-vpn\android\src\main\java\FinalAetherVpnPlugin.kt"
$python = Resolve-Python

foreach ($required in @($prepareIcons, $prepareNative, $efficiencyPatch, $releaseSigningPatch, $serviceSource)) {
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

& $python.Command @($python.Prefix + @($releaseSigningPatch))
if ($LASTEXITCODE -ne 0) {
    throw "Android release APK signing preparation failed with exit code $LASTEXITCODE."
}

$serviceBackup = [System.IO.File]::ReadAllBytes($serviceSource)
$exitCode = 1
try {
    & $python.Command @($python.Prefix + @($efficiencyPatch, $repoRoot))
    if ($LASTEXITCODE -ne 0) {
        throw "Android mobile-efficiency patch failed with exit code $LASTEXITCODE."
    }

    $env:VITE_AETHER_PLATFORM = "android"
    $buildArguments = @("tauri", "android", "build", "--apk", "--target", "aarch64", "--split-per-abi")
    if ($Debug) {
        $buildArguments += "--debug"
        Write-Host "Building an installable ARM64 debug APK for direct sideload testing..." -ForegroundColor Cyan
    } else {
        Write-Host "Building an ARM64 release APK; a release signing configuration may be required." -ForegroundColor Cyan
    }
    & pnpm @buildArguments
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
