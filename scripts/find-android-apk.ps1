param(
    [switch]$PathOnly
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = Join-Path $repoRoot "src-tauri\gen\android\app\build\outputs\apk"

if (-not (Test-Path $outputRoot)) {
    throw "No Android APK output directory exists yet. Run: pnpm build:android:arm64"
}

$apk = Get-ChildItem -Path $outputRoot -Recurse -File -Filter "*.apk" |
    Where-Object {
        $_.Name -notmatch '(?i)unaligned|unsigned' -and
        $_.FullName -match '(?i)aarch64|arm64|release'
    } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $apk) {
    $apk = Get-ChildItem -Path $outputRoot -Recurse -File -Filter "*.apk" |
        Where-Object { $_.Name -notmatch '(?i)unaligned|unsigned' } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

if (-not $apk) {
    throw "No installable APK was found under $outputRoot. Run: pnpm build:android:arm64"
}

if ($PathOnly) {
    Write-Output $apk.FullName
    exit 0
}

Write-Host "Latest Android ARM64 APK:" -ForegroundColor Cyan
Write-Host $apk.FullName -ForegroundColor Green
Write-Host ("Size: {0:N1} MB" -f ($apk.Length / 1MB))
Write-Host ("Built: {0}" -f $apk.LastWriteTime)
