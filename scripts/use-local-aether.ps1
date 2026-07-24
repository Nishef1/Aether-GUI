param(
    [string]$AetherRepo = "",
    [string]$AppDataDir = "",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Require-Command {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$InstallHint
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "$Name is required but was not found. $InstallHint"
    }
    return $command.Source
}

function Find-CMake {
    $command = Get-Command "cmake.exe" -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = New-Object System.Collections.Generic.List[string]

    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $candidates.Add((Join-Path $env:ProgramFiles "CMake\bin\cmake.exe"))
    }

    $vswhere = $null
    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
        $vswhereCandidate = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
        if (Test-Path $vswhereCandidate) {
            $vswhere = $vswhereCandidate
        }
    }

    if ($vswhere) {
        $installations = @(
            & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.CMake.Project -property installationPath 2>$null
        ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

        foreach ($installation in $installations) {
            $candidates.Add((Join-Path $installation.Trim() "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"))
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        foreach ($edition in @("Community", "Professional", "Enterprise", "BuildTools")) {
            $candidates.Add((Join-Path $env:ProgramFiles "Microsoft Visual Studio\2022\$edition\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"))
        }
    }

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }

    return $null
}

function Prepare-NativeBuildTools {
    Require-Command -Name "git.exe" -InstallHint "Install Git for Windows and reopen the terminal." | Out-Null
    Require-Command -Name "cargo.exe" -InstallHint "Install Rust with rustup and reopen the terminal." | Out-Null

    $cmake = Find-CMake
    if (-not $cmake) {
        throw @"
CMake is required to build Aether's BoringSSL dependency but was not found.
Install it once, reopen the terminal, and run pnpm dev:custom again:

  winget install --id Kitware.CMake -e --source winget

Alternatively, open Visual Studio Installer and add:
  Desktop development with C++
  C++ CMake tools for Windows
"@
    }

    $cmakeDir = Split-Path $cmake -Parent
    if (($env:PATH -split ';') -notcontains $cmakeDir) {
        $env:PATH = "$cmakeDir;$env:PATH"
    }

    $cmakeVersion = (& $cmake --version | Select-Object -First 1)
    Write-Host "[local-core] Using $cmakeVersion from $cmake"
}

$GuiRoot = Split-Path $PSScriptRoot -Parent
$UsingBundledSubmodule = [string]::IsNullOrWhiteSpace($AetherRepo)
if ($UsingBundledSubmodule) {
    $AetherRepo = Join-Path $GuiRoot "vendor\aether"
}
$AetherRepo = [System.IO.Path]::GetFullPath($AetherRepo)

if (-not $SkipBuild) {
    Prepare-NativeBuildTools
}

$Manifest = Join-Path $AetherRepo "aether\Cargo.toml"
if ($UsingBundledSubmodule -and -not (Test-Path $Manifest)) {
    Write-Host "[local-core] Initializing vendor/aether submodule..."
    & git -C $GuiRoot submodule update --init --recursive -- "vendor/aether"
    if ($LASTEXITCODE -ne 0) {
        throw "Could not initialize vendor/aether (exit code $LASTEXITCODE)"
    }
}

$BuiltBinary = Join-Path $AetherRepo "aether\target\release\aether.exe"
if (-not (Test-Path $Manifest)) {
    throw "Aether manifest not found at $Manifest. Run 'git submodule update --init --recursive' or pass -AetherRepo explicitly."
}

if (-not $SkipBuild) {
    Write-Host "[local-core] Building embedded Aether core..."
    & cargo build --release --manifest-path $Manifest
    if ($LASTEXITCODE -ne 0) {
        throw "cargo build failed with exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path $BuiltBinary) -or (Get-Item $BuiltBinary).Length -le 0) {
    throw "Built Aether executable is missing or empty at $BuiltBinary"
}

$GitSha = ""
try {
    $GitSha = (& git -C $AetherRepo rev-parse --short=12 HEAD 2>$null).Trim()
}
catch {
    $GitSha = ""
}
if ([string]::IsNullOrWhiteSpace($GitSha)) {
    $GitSha = [DateTime]::UtcNow.ToString("yyyyMMddHHmmss")
}

$Version = "dev-$GitSha"
$SafeVersion = $Version -replace '[^A-Za-z0-9._-]', '_'

if ([string]::IsNullOrWhiteSpace($AppDataDir)) {
    if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
        throw "APPDATA is unavailable. Pass -AppDataDir explicitly."
    }
    $AppDataDir = Join-Path $env:APPDATA "com.cluvexstudio.aethergui"
}
$AppDataDir = [System.IO.Path]::GetFullPath($AppDataDir)
$ManagedDir = Join-Path $AppDataDir "cores\aether"
$Target = Join-Path $ManagedDir "aether-$SafeVersion.exe"
$TemporaryTarget = "$Target.new"
$ActiveVersionFile = Join-Path $ManagedDir "active-version.txt"
$RejectedVersionFile = Join-Path $ManagedDir "rejected-version.txt"
$MetadataFile = Join-Path $ManagedDir "local-source.json"

New-Item -ItemType Directory -Force -Path $ManagedDir | Out-Null
Remove-Item $TemporaryTarget -Force -ErrorAction SilentlyContinue
Copy-Item $BuiltBinary $TemporaryTarget -Force
if (-not (Test-Path $TemporaryTarget) -or (Get-Item $TemporaryTarget).Length -le 0) {
    throw "Failed to stage the local Aether executable"
}

$SourceHash = (Get-FileHash -Path $BuiltBinary -Algorithm SHA256).Hash.ToLowerInvariant()
$StagedHash = (Get-FileHash -Path $TemporaryTarget -Algorithm SHA256).Hash.ToLowerInvariant()
if ($SourceHash -ne $StagedHash) {
    Remove-Item $TemporaryTarget -Force -ErrorAction SilentlyContinue
    throw "SHA-256 mismatch while staging the local Aether executable"
}

Remove-Item $Target -Force -ErrorAction SilentlyContinue
Move-Item $TemporaryTarget $Target -Force
Set-Content -Path $ActiveVersionFile -Value $Version -NoNewline
Remove-Item $RejectedVersionFile -Force -ErrorAction SilentlyContinue

$ReportedVersion = ""
try {
    $ReportedVersion = (& $Target --version 2>&1 | Out-String).Trim()
}
catch {
    $ReportedVersion = "unavailable"
}

$Metadata = [ordered]@{
    version = $Version
    commit = $GitSha
    repository = $AetherRepo
    executable = $Target
    sha256 = $SourceHash
    reported_version = $ReportedVersion
    installed_at_utc = [DateTime]::UtcNow.ToString("o")
}
$Metadata | ConvertTo-Json | Set-Content -Path $MetadataFile -Encoding UTF8

Write-Host "[local-core] Installed and selected embedded Aether $Version"
Write-Host "[local-core] Binary: $Target"
Write-Host "[local-core] SHA-256: $SourceHash"
Write-Host "[local-core] Core reports: $ReportedVersion"
Write-Host "[local-core] Restart or reconnect Aether-GUI to use this core."
