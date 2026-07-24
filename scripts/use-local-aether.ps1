param(
    [string]$AetherRepo = "",
    [string]$AppDataDir = "",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$GuiRoot = Split-Path $PSScriptRoot -Parent
$UsingBundledSubmodule = [string]::IsNullOrWhiteSpace($AetherRepo)
if ($UsingBundledSubmodule) {
    $AetherRepo = Join-Path $GuiRoot "vendor\aether"
}
$AetherRepo = [System.IO.Path]::GetFullPath($AetherRepo)

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
