$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Get-Sha256Hex {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

$manifest = Join-Path $repoRoot "src-tauri\icons\android-icon-manifest.json"
$source = Join-Path $repoRoot "src-tauri\icons\icon.png"
$monochrome = Join-Path $repoRoot "src-tauri\icons\android-monochrome.svg"
$androidRes = Join-Path $repoRoot "src-tauri\gen\android\app\src\main\res"
$launcher = Join-Path $androidRes "mipmap-xxxhdpi\ic_launcher.png"
$foreground = Join-Path $androidRes "mipmap-xxxhdpi\ic_launcher_foreground.png"
$monochromePng = Join-Path $androidRes "mipmap-xxxhdpi\ic_launcher_monochrome.png"
$adaptive = Join-Path $androidRes "mipmap-anydpi-v26\ic_launcher.xml"
$adaptiveRound = Join-Path $androidRes "mipmap-anydpi-v26\ic_launcher_round.xml"
$themed = Join-Path $androidRes "mipmap-anydpi-v33\ic_launcher.xml"
$themedRound = Join-Path $androidRes "mipmap-anydpi-v33\ic_launcher_round.xml"
$launcherColors = Join-Path $androidRes "values\aether_launcher_colors.xml"
$stamp = Join-Path $repoRoot "src-tauri\gen\android\.aether-icon.sha256"

foreach ($required in @($manifest, $source, $monochrome)) {
    if (-not (Test-Path $required)) {
        throw "Android icon input is missing: $required"
    }
}

# Use the .NET hashing API instead of Get-FileHash so this works in stripped-down
# Windows PowerShell sessions as well as PowerShell 7.
$hashInput = @(
    (Get-Sha256Hex -Path $manifest)
    (Get-Sha256Hex -Path $source)
    (Get-Sha256Hex -Path $monochrome)
) -join "`n"
$hashBytes = [System.Text.Encoding]::UTF8.GetBytes($hashInput)
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
    $fingerprint = ([System.BitConverter]::ToString($sha.ComputeHash($hashBytes))).Replace("-", "").ToLowerInvariant()
}
finally {
    $sha.Dispose()
}

$requiredGenerated = @(
    $launcher,
    $foreground,
    $monochromePng,
    $adaptive,
    $adaptiveRound,
    $themed,
    $themedRound,
    $launcherColors
)
if (
    ($requiredGenerated | Where-Object { -not (Test-Path $_) }).Count -eq 0 -and
    (Test-Path $stamp) -and
    ((Get-Content -Raw $stamp).Trim() -eq $fingerprint)
) {
    Write-Host "Android launcher icons already match the Aether artwork." -ForegroundColor DarkGreen
    exit 0
}

$iconConfig = Get-Content -Raw $manifest | ConvertFrom-Json
$backgroundColor = [string]$iconConfig.bg_color
if ($backgroundColor -notmatch '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$') {
    throw "android-icon-manifest.json contains an invalid bg_color: $backgroundColor"
}

# Tauri creates Android density folders under --output\android together with
# unrelated desktop/iOS assets. Copy only Android mipmaps into the generated
# Android project so the separately approved Windows icon set is never
# overwritten.
$temporaryOutput = Join-Path ([System.IO.Path]::GetTempPath()) ("aether-android-icons-" + [guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Force -Path $temporaryOutput | Out-Null
    Write-Host "Generating Android launcher artwork from the Aether icon..." -ForegroundColor Cyan
    & pnpm tauri icon --output $temporaryOutput $manifest
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri Android icon generation failed with exit code $LASTEXITCODE."
    }

    $androidOutput = Join-Path $temporaryOutput "android"
    if (-not (Test-Path -LiteralPath $androidOutput -PathType Container)) {
        throw "Tauri did not generate an Android resource directory in $temporaryOutput"
    }

    $mipmapDirectories = @(Get-ChildItem -LiteralPath $androidOutput -Directory | Where-Object { $_.Name -like 'mipmap-*' })
    if ($mipmapDirectories.Count -eq 0) {
        throw "Tauri did not generate any Android mipmap directories in $androidOutput"
    }

    foreach ($directory in $mipmapDirectories) {
        $destination = Join-Path $androidRes $directory.Name
        New-Item -ItemType Directory -Force -Path $destination | Out-Null
        Copy-Item -Path (Join-Path $directory.FullName '*') -Destination $destination -Recurse -Force
    }

    $colorXml = @"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">$backgroundColor</color>
</resources>
"@
    Write-Utf8NoBom -Path $launcherColors -Content $colorXml

    $adaptiveXml = @'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
'@
    Write-Utf8NoBom -Path $adaptive -Content $adaptiveXml
    Write-Utf8NoBom -Path $adaptiveRound -Content $adaptiveXml

    # Android 13+ themed icons use the dedicated monochrome layer. Keep this in
    # v33 so older Android resource parsers only see the standard adaptive icon.
    $themedXml = @'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
'@
    Write-Utf8NoBom -Path $themed -Content $themedXml
    Write-Utf8NoBom -Path $themedRound -Content $themedXml
}
finally {
    Remove-Item $temporaryOutput -Recurse -Force -ErrorAction SilentlyContinue
}

foreach ($generated in $requiredGenerated) {
    if (-not (Test-Path $generated)) {
        throw "Expected Android launcher resource was not generated: $generated"
    }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stamp) | Out-Null
[System.IO.File]::WriteAllText($stamp, $fingerprint, [System.Text.UTF8Encoding]::new($false))
Write-Host "Android adaptive, round, legacy, and themed icons are ready; Windows icons were left unchanged." -ForegroundColor Green
