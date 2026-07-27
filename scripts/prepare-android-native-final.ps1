param(
    [switch]$ForceRebuild,
    [string]$AndroidNdkVersion = "27.2.12479018",
    [int]$AndroidMinApi = 29
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$basePrepare = Join-Path $PSScriptRoot "prepare-android-native.ps1"
if (-not (Test-Path $basePrepare)) {
    throw "Base Android native preparation script is missing: $basePrepare"
}

$baseArguments = @{
    AndroidNdkVersion = $AndroidNdkVersion
    AndroidMinApi = $AndroidMinApi
}
if ($ForceRebuild) {
    $baseArguments.ForceRebuild = $true
}

# Prepare the NDK environment, TUN bridge, hev-socks5-tunnel, Gradle packaging,
# and the baseline Aether binary. The baseline script still applies the older
# session patch, so the final egress patch and core rebuild intentionally happen
# after it returns.
& $basePrepare @baseArguments
if ($LASTEXITCODE -ne 0) {
    throw "Base Android native preparation failed with exit code $LASTEXITCODE."
}

function Resolve-Python {
    foreach ($name in @("python", "python3")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) {
            return @{
                Command = $command.Source
                Prefix = @()
            }
        }
    }

    $launcher = Get-Command py -ErrorAction SilentlyContinue
    if ($launcher) {
        return @{
            Command = $launcher.Source
            Prefix = @("-3")
        }
    }

    throw "Python 3 was not found. Install Python 3 and reopen PowerShell."
}

$patch = Join-Path $repoRoot "scripts\ci\patch-aether-wg-real-egress.py"
if (-not (Test-Path $patch)) {
    throw "WireGuard real-egress patch is missing: $patch"
}

$python = Resolve-Python
& $python.Command @($python.Prefix + @($patch, $repoRoot))
if ($LASTEXITCODE -ne 0) {
    throw "WireGuard real-egress patch failed with exit code $LASTEXITCODE."
}

$cargoCommand = Get-Command cargo -ErrorAction SilentlyContinue
if (-not $cargoCommand) {
    throw "cargo was not found. Install Rust with rustup and reopen PowerShell."
}

$coreCrate = Join-Path $repoRoot "vendor\aether\aether"
$coreManifest = Join-Path $coreCrate "Cargo.toml"
if (-not (Test-Path $coreManifest)) {
    throw "Pinned Aether submodule is missing. Run: git submodule update --init --recursive"
}

Write-Host "Rebuilding final patched Aether core for Android ARM64..." -ForegroundColor Cyan
Push-Location $coreCrate
try {
    & $cargoCommand.Source ndk `
        --target arm64-v8a `
        --platform $AndroidMinApi `
        build `
        --release `
        --bin aether
    if ($LASTEXITCODE -ne 0) {
        throw "Final patched Aether ARM64 build failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

$coreCandidates = @(
    (Join-Path $coreCrate "target\aarch64-linux-android\release\aether"),
    (Join-Path $coreCrate "target\aarch64-linux-android\release\aether.exe")
)
$core = $coreCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $core) {
    throw "Final patched Aether ARM64 executable was not produced."
}

$nativeDirectory = Join-Path $repoRoot "src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a"
New-Item $nativeDirectory -ItemType Directory -Force | Out-Null
$bundledCore = Join-Path $nativeDirectory "libaether_exec.so"
Copy-Item -LiteralPath $core -Destination $bundledCore -Force

if (-not (Test-Path $bundledCore)) {
    throw "Final patched Aether core was not bundled: $bundledCore"
}

$size = (Get-Item -LiteralPath $bundledCore).Length
Write-Host "Bundled final patched libaether_exec.so ($size bytes)" -ForegroundColor Green
