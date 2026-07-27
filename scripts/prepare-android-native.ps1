param(
    [switch]$ForceRebuild,
    [string]$AndroidNdkVersion = "27.2.12479018",
    [int]$AndroidMinApi = 29
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$armAbi = "arm64-v8a"
$rustTarget = "aarch64-linux-android"
$hevCommit = "da33382c7282b4e764408535704f3cd96fea9a14"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $repoRoot
    )

    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code $LASTEXITCODE`: $Command $($Arguments -join ' ')"
        }
    }
    finally {
        Pop-Location
    }
}

function Test-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [string[]]$Arguments = @()
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "SilentlyContinue"
        & $Command @Arguments *> $null
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

function Resolve-CommandPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [string]$InstallHint
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "$Name was not found. $InstallHint"
    }
    return $command.Source
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

function Invoke-Python {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [string]$WorkingDirectory = $repoRoot
    )

    $python = Resolve-Python
    Invoke-Checked `
        -Command $python.Command `
        -Arguments @($python.Prefix + $Arguments) `
        -WorkingDirectory $WorkingDirectory
}

function Resolve-AndroidNdk {
    $candidates = New-Object System.Collections.Generic.List[string]

    foreach ($value in @(
        $env:NDK_HOME,
        $env:ANDROID_NDK_HOME,
        $env:ANDROID_NDK_ROOT
    )) {
        if ($value) {
            $candidates.Add($value)
        }
    }

    $sdkRoots = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA "Android\Sdk")
    ) | Where-Object { $_ } | Select-Object -Unique

    foreach ($sdkRoot in $sdkRoots) {
        $pinned = Join-Path $sdkRoot "ndk\$AndroidNdkVersion"
        $candidates.Add($pinned)

        $ndkRoot = Join-Path $sdkRoot "ndk"
        if (Test-Path $ndkRoot) {
            Get-ChildItem $ndkRoot -Directory -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending |
                ForEach-Object { $candidates.Add($_.FullName) }
        }
    }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (
            (Test-Path (Join-Path $candidate "ndk-build.cmd")) -or
            (Test-Path (Join-Path $candidate "ndk-build"))
        ) {
            return (Resolve-Path $candidate).Path
        }
    }

    throw "Android NDK was not found. Install NDK $AndroidNdkVersion from Android SDK Manager or set ANDROID_NDK_HOME."
}

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text.Replace("`r`n", "`n"), $encoding)
}

$cargo = Resolve-CommandPath -Name "cargo" -InstallHint "Install Rust with rustup and reopen PowerShell."
$rustup = Resolve-CommandPath -Name "rustup" -InstallHint "Install Rust with rustup and reopen PowerShell."
$git = Resolve-CommandPath -Name "git" -InstallHint "Install Git and reopen PowerShell."
$pnpm = Resolve-CommandPath -Name "pnpm" -InstallHint "Install pnpm and reopen PowerShell."
$ndkHome = Resolve-AndroidNdk

$env:NDK_HOME = $ndkHome
$env:ANDROID_NDK_HOME = $ndkHome
$env:ANDROID_NDK_ROOT = $ndkHome
$nmake = Get-ChildItem (Join-Path $env:ProgramFiles "Microsoft Visual Studio\2022") -Recurse -File -Filter "nmake.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\Hostx64\\x64\\nmake\.exe$" } |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $nmake) {
    throw "nmake.exe was not found. Install the Visual Studio C++ build tools."
}
$env:CMAKE_GENERATOR = "NMake Makefiles"
$env:PATH = "$(Split-Path -Parent $nmake);$env:PATH"
$env:CMAKE = Join-Path $repoRoot "scripts\native\cmake-android.cmd"

# cargo-ndk 4.1.2 exports CLANG_PATH without the .exe suffix on Windows.
# clang-sys validates that exact path before invoking bindgen, so provide the
# extensionless companion expected by cargo-ndk next to the NDK clang binary.
$llvmBin = Join-Path $ndkHome "toolchains\llvm\prebuilt\windows-x86_64\bin"
if (-not (Test-Path $llvmBin)) {
    $llvmBin = Get-ChildItem (Join-Path $ndkHome "toolchains\llvm\prebuilt") -Directory |
        Select-Object -First 1 -ExpandProperty FullName |
        Join-Path -ChildPath "bin"
}
$clangExe = Join-Path $llvmBin "clang.exe"
$clangShim = Join-Path $llvmBin "clang"
if ((Test-Path $clangExe) -and -not (Test-Path $clangShim)) {
    Copy-Item $clangExe $clangShim
}
if (-not (Test-Path $clangShim)) {
    throw "Android NDK clang executable was not found: $clangExe"
}

Write-Host "Android NDK: $ndkHome" -ForegroundColor Cyan
Write-Host "Preparing bundled Android ARM64 native runtime..." -ForegroundColor Cyan

if (-not (Test-CheckedCommand -Command $cargo -Arguments @("ndk", "--version"))) {
    Write-Host "Installing cargo-ndk 4.1.2..." -ForegroundColor Yellow
    Invoke-Checked -Command $cargo -Arguments @(
        "install",
        "cargo-ndk",
        "--version",
        "4.1.2",
        "--locked"
    )
}

Invoke-Checked -Command $rustup -Arguments @("target", "add", $rustTarget)

$coreCrate = Join-Path $repoRoot "vendor\aether\aether"
$coreManifest = Join-Path $coreCrate "Cargo.toml"
if (-not (Test-Path $coreManifest)) {
    throw "Pinned Aether submodule is missing. Run: git submodule update --init --recursive"
}

Invoke-Python -Arguments @(
    (Join-Path $repoRoot "scripts\ci\patch-aether-wg-fresh-session.py"),
    $repoRoot
)

$coreCandidates = @(
    (Join-Path $coreCrate "target\$rustTarget\release\aether"),
    (Join-Path $coreCrate "target\$rustTarget\release\aether.exe")
)
$core = $coreCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

$coreInputs = @(
    (Join-Path $coreCrate "Cargo.toml"),
    (Join-Path $coreCrate "Cargo.lock")
) + @(Get-ChildItem -Path (Join-Path $coreCrate "src") -File -Recurse)
$coreNewestInput = $coreInputs |
    Where-Object { Test-Path $_ } |
    ForEach-Object { Get-Item -LiteralPath $_ } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
$coreIsStale = $core -and $coreNewestInput -and
    ((Get-Item $core).LastWriteTimeUtc -lt $coreNewestInput.LastWriteTimeUtc)

if ($ForceRebuild -or -not $core -or $coreIsStale) {
    $reason = if ($ForceRebuild) {
        "forced"
    } elseif (-not $core) {
        "missing output"
    } else {
        "source is newer than output"
    }
    Write-Host "Building Aether core for $armAbi ($reason)..." -ForegroundColor Cyan
    Invoke-Checked `
        -Command $cargo `
        -Arguments @(
            "ndk",
            "--target",
            $armAbi,
            "--platform",
            "$AndroidMinApi",
            "build",
            "--release",
            "--bin",
            "aether"
        ) `
        -WorkingDirectory $coreCrate

    $core = $coreCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $core) {
    throw "Aether ARM64 executable was not produced under target\$rustTarget\release."
}

$hevRoot = Join-Path $repoRoot "third-party\hev-socks5-tunnel"
$hevLibrary = Join-Path $hevRoot "libs\$armAbi\libhev-socks5-tunnel.so"
$tunBridge = Join-Path $hevRoot "libs\$armAbi\libaethertun.so"
$bridgeSource = Join-Path $repoRoot "scripts\native\aethertun-jni.c"

if (-not (Test-Path $bridgeSource)) {
    throw "Aether TUN JNI bridge source is missing: $bridgeSource"
}

if ($ForceRebuild -or -not (Test-Path $hevLibrary) -or -not (Test-Path $tunBridge)) {
    Write-Host "Building pinned hev-socks5-tunnel for $armAbi..." -ForegroundColor Cyan

    if (Test-Path $hevRoot) {
        Remove-Item $hevRoot -Recurse -Force
    }
    New-Item (Split-Path -Parent $hevRoot) -ItemType Directory -Force | Out-Null

    Invoke-Checked -Command $git -Arguments @(
        "clone",
        "--filter=blob:none",
        "--no-checkout",
        "https://github.com/heiher/hev-socks5-tunnel.git",
        $hevRoot
    )
    Invoke-Checked -Command $git -Arguments @("-C", $hevRoot, "checkout", $hevCommit)
    Invoke-Checked -Command $git -Arguments @(
        "-C",
        $hevRoot,
        "submodule",
        "update",
        "--init",
        "--recursive",
        "--depth",
        "1"
    )

    Get-ChildItem $hevRoot -Recurse -Filter "*.mk" -File |
        ForEach-Object {
            $text = [System.IO.File]::ReadAllText($_.FullName)
            $text = [regex]::Replace($text, "[^\s]*hev-jni\.c", "")
            Write-Utf8NoBom -Path $_.FullName -Text $text
        }
    Get-ChildItem $hevRoot -Recurse -Filter "hev-jni.c" -File |
        Remove-Item -Force

    Invoke-Python -Arguments @(
        (Join-Path $repoRoot "scripts\ci\patch-hev-idempotent-stop.py"),
        $hevRoot
    )

    $applicationMk = @"
APP_OPTIM := release
APP_PLATFORM := android-$AndroidMinApi
APP_ABI := $armAbi
APP_CFLAGS := -O3
APP_STL := c++_static
APP_SUPPORT_FLEXIBLE_PAGE_SIZES := true
NDK_TOOLCHAIN_VERSION := clang
"@
    Write-Utf8NoBom -Path (Join-Path $hevRoot "Application.mk") -Text $applicationMk

    $ndkBuild = Join-Path $ndkHome "ndk-build.cmd"
    if (-not (Test-Path $ndkBuild)) {
        $ndkBuild = Join-Path $ndkHome "ndk-build"
    }
    Invoke-Checked `
        -Command $ndkBuild `
        -Arguments @(
            "-C",
            $hevRoot,
            "NDK_PROJECT_PATH=.",
            "APP_BUILD_SCRIPT=Android.mk",
            "NDK_APPLICATION_MK=Application.mk"
        )

    if (-not (Test-Path $hevLibrary)) {
        throw "hev-socks5-tunnel ARM64 library was not produced: $hevLibrary"
    }

    $prebuiltRoot = Join-Path $ndkHome "toolchains\llvm\prebuilt"
    $toolchain = Join-Path $prebuiltRoot "windows-x86_64"
    if (-not (Test-Path $toolchain)) {
        $toolchain = Get-ChildItem $prebuiltRoot -Directory |
            Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $toolchain) {
        throw "Android NDK LLVM toolchain was not found under $prebuiltRoot."
    }

    $clangCandidates = @(
        (Join-Path $toolchain "bin\aarch64-linux-android$AndroidMinApi-clang.cmd"),
        (Join-Path $toolchain "bin\aarch64-linux-android$AndroidMinApi-clang.exe"),
        (Join-Path $toolchain "bin\aarch64-linux-android$AndroidMinApi-clang")
    )
    $clang = $clangCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $clang) {
        throw "Android ARM64 clang wrapper was not found for API $AndroidMinApi."
    }

    New-Item (Split-Path -Parent $tunBridge) -ItemType Directory -Force | Out-Null
    Invoke-Checked -Command $clang -Arguments @(
        "-O2",
        "-fPIC",
        "-shared",
        "-pthread",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-Wl,-soname,libaethertun.so",
        "-Wl,--no-undefined",
        "-o",
        $tunBridge,
        $bridgeSource,
        "-L$(Split-Path -Parent $hevLibrary)",
        "-lhev-socks5-tunnel",
        "-llog"
    )
}

foreach ($required in @($core, $hevLibrary, $tunBridge)) {
    if (-not (Test-Path $required)) {
        throw "Required Android native component is missing: $required"
    }
}

$generatedGradle = Join-Path $repoRoot "src-tauri\gen\android\app\build.gradle.kts"
if (-not (Test-Path $generatedGradle)) {
    Write-Host "Generating the Tauri Android project..." -ForegroundColor Cyan
    Invoke-Checked -Command $pnpm -Arguments @(
        "tauri",
        "android",
        "init",
        "--ci",
        "--skip-targets-install"
    )
}

Invoke-Python -Arguments @(
    (Join-Path $repoRoot "scripts\ci\patch-android-packaging.py")
)

$destination = Join-Path $repoRoot "src-tauri\gen\android\app\src\main\jniLibs\$armAbi"
New-Item $destination -ItemType Directory -Force | Out-Null

Copy-Item $core (Join-Path $destination "libaether_exec.so") -Force
Copy-Item $hevLibrary (Join-Path $destination "libhev-socks5-tunnel.so") -Force
Copy-Item $tunBridge (Join-Path $destination "libaethertun.so") -Force

$bundled = @(
    (Join-Path $destination "libaether_exec.so"),
    (Join-Path $destination "libhev-socks5-tunnel.so"),
    (Join-Path $destination "libaethertun.so")
)

foreach ($file in $bundled) {
    if (-not (Test-Path $file)) {
        throw "Failed to bundle Android native component: $file"
    }
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = [System.BitConverter]::ToString(
            $sha256.ComputeHash([System.IO.File]::ReadAllBytes($file))
        ).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
    $size = (Get-Item $file).Length
    Write-Host "Bundled $(Split-Path -Leaf $file) ($size bytes, sha256=$hash)" -ForegroundColor Green
}

Write-Host "Android ARM64 native runtime is ready in $destination" -ForegroundColor Green
