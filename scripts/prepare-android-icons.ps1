$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

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

$hashInput = @(
    (Get-FileHash -Algorithm SHA256 -LiteralPath $manifest).Hash,
    (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash,
    (Get-FileHash -Algorithm SHA256 -LiteralPath $monochrome).Hash
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

Write-Host "Generating adaptive Android launcher icons from src-tauri/icons/icon.png..." -ForegroundColor Cyan
& pnpm tauri icon $manifest
if ($LASTEXITCODE -ne 0) {
    throw "Tauri Android icon generation failed with exit code $LASTEXITCODE."
}

foreach ($generated in @($launcher, $adaptive)) {
    if (-not (Test-Path $generated)) {
        throw "Expected Android launcher icon was not generated: $generated"
    }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stamp) | Out-Null
[System.IO.File]::WriteAllText($stamp, $fingerprint, [System.Text.UTF8Encoding]::new($false))
Write-Host "Android adaptive, round, legacy, and themed icons are ready." -ForegroundColor Green
