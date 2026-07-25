param(
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$GuiRoot = Split-Path $PSScriptRoot -Parent
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $GuiRoot "src-tauri\binaries"
}
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$AetherRepo = Join-Path $GuiRoot "vendor\aether"
$BuiltBinary = Join-Path $AetherRepo "aether\target\release\aether.exe"
$TemporaryAppData = Join-Path ([System.IO.Path]::GetTempPath()) ("aether-gui-bundle-" + [guid]::NewGuid().ToString("N"))

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            $hash = $sha256.ComputeHash($stream)
            return ([System.BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()
        }
        finally {
            $sha256.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

try {
    # Reuse the same native-tool preflight, submodule synchronization, and release
    # build path used by `pnpm dev:custom`. Isolating AppData prevents a packaging
    # build from changing the developer's currently selected managed core.
    & (Join-Path $PSScriptRoot "run-local-aether.ps1") -AppDataDir $TemporaryAppData

    $GitSha = (& git -C $AetherRepo rev-parse --short=12 HEAD 2>$null | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($GitSha)) {
        throw "Could not determine the pinned embedded Aether commit"
    }

    $DirtyState = (& git -C $AetherRepo status --porcelain --untracked-files=all 2>$null | Out-String).Trim()
    if (-not [string]::IsNullOrWhiteSpace($DirtyState)) {
        throw "vendor/aether contains uncommitted changes. Commit them and update the GUI submodule pointer before building a distributable installer."
    }

    if (-not (Test-Path $BuiltBinary) -or (Get-Item $BuiltBinary).Length -le 0) {
        throw "Embedded Aether build did not produce a usable executable at $BuiltBinary"
    }

    $Version = "dev-$GitSha"
    $SafeVersion = $Version -replace '[^A-Za-z0-9._-]', '_'
    $VersionedTarget = Join-Path $OutputDir "aether-$SafeVersion.exe"
    $AliasTarget = Join-Path $OutputDir "aether.exe"
    $VersionFile = Join-Path $OutputDir "aether-version.txt"

    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

    # Tauri packages binaries by wildcard. Remove stale versioned Aether copies so
    # an installer cannot accidentally ship both the current fork and an older
    # public release while presenting only one version in the UI.
    Get-ChildItem -Path $OutputDir -File -Filter "aether-*.exe" -ErrorAction SilentlyContinue |
        Remove-Item -Force

    $TemporaryVersionedTarget = "$VersionedTarget.new"
    Remove-Item $TemporaryVersionedTarget -Force -ErrorAction SilentlyContinue
    Copy-Item $BuiltBinary $TemporaryVersionedTarget -Force

    $SourceHash = Get-Sha256Hex -Path $BuiltBinary
    $StagedHash = Get-Sha256Hex -Path $TemporaryVersionedTarget
    if ($SourceHash -ne $StagedHash) {
        throw "SHA-256 mismatch while staging the embedded Aether core"
    }

    Move-Item $TemporaryVersionedTarget $VersionedTarget -Force
    Copy-Item $VersionedTarget $AliasTarget -Force
    [System.IO.File]::WriteAllText(
        $VersionFile,
        $Version,
        [System.Text.UTF8Encoding]::new($false)
    )

    if ((Get-Sha256Hex -Path $VersionedTarget) -ne (Get-Sha256Hex -Path $AliasTarget)) {
        throw "Bundled Aether alias does not match the pinned versioned executable"
    }

    Write-Host "[bundle-core] Bundled embedded Aether $Version"
    Write-Host "[bundle-core] Commit: $GitSha"
    Write-Host "[bundle-core] SHA-256: $SourceHash"
}
finally {
    Remove-Item $TemporaryAppData -Recurse -Force -ErrorAction SilentlyContinue
}
