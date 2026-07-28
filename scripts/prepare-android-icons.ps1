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

$manifest = Join-Path $repoRoot "src-tauri\icons\android-icon-manifest.json"
$source = Join-Path $repoRoot "src-tauri\icons\icon.png"
$monochrome = Join-Path $repoRoot "src-tauri\icons\android-monochrome.svg"
$androidRes = Join-Path $repoRoot "src-tauri\gen\android\app\src\main\res"
$launcher = Join-Path $androidRes "mipmap-xxxhdpi\ic_launcher.png"
$adaptive = Join-Path $androidRes "mipmap-anydpi-v26\ic_launcher.xml"
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

if (
    (Test-Path $launcher) -and
    (Test-Path $adaptive) -and
    (Test-Path $stamp) -and
    ((Get-Content -Raw $stamp).Trim() -eq $fingerprint)
) {
    Write-Host "Android launcher icons already match the Aether artwork." -ForegroundColor DarkGreen
    exit 0
}

# Tauri writes mobile icons directly into the generated Android Studio project.
# Send its unrelated desktop outputs to a temporary directory so Android icon
# generation never overwrites the separately approved Windows icon set.
$temporaryOutput = Join-Path ([System.IO.Path]::GetTempPath()) ("aether-android-icons-" + [guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Force -Path $temporaryOutput | Out-Null
    Write-Host "Generating adaptive Android launcher icons from the Aether artwork..." -ForegroundColor Cyan
    & pnpm tauri icon --output $temporaryOutput $manifest
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri Android icon generation failed with exit code $LASTEXITCODE."
    }
}
finally {
    Remove-Item $temporaryOutput -Recurse -Force -ErrorAction SilentlyContinue
}

foreach ($generated in @($launcher, $adaptive)) {
    if (-not (Test-Path $generated)) {
        throw "Expected Android launcher icon was not generated: $generated"
    }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stamp) | Out-Null
[System.IO.File]::WriteAllText($stamp, $fingerprint, [System.Text.UTF8Encoding]::new($false))
Write-Host "Android adaptive, round, legacy, and themed icons are ready; Windows icons were left unchanged." -ForegroundColor Green
