param(
    [string]$DestDir = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repo = "CluvexStudio/Aether"
$ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"
$Headers = @{ "User-Agent" = "Aether-GUI-Core-Updater" }
$AssetName = "aether-windows-x86_64.zip"

New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
$FallbackTarget = Join-Path $DestDir "aether.exe"
$VersionFile = Join-Path $DestDir "aether-version.txt"

Write-Host "[core-updater] Checking latest stable Aether release..."
$Release = Invoke-RestMethod -Uri $ApiUrl -Headers $Headers
$Version = [string]$Release.tag_name
if ([string]::IsNullOrWhiteSpace($Version)) {
    throw "Latest Aether release did not contain a tag name"
}
$SafeVersion = $Version -replace '[^A-Za-z0-9._-]', '_'
$VersionedTarget = Join-Path $DestDir "aether-$SafeVersion.exe"

if ((Test-Path $VersionedTarget) -and (Test-Path $VersionFile)) {
    $InstalledVersion = (Get-Content $VersionFile -Raw).Trim()
    if ($InstalledVersion -eq $Version) {
        Write-Host "[core-updater] Aether $Version is already installed"
        if (-not (Test-Path $FallbackTarget)) {
            Copy-Item $VersionedTarget $FallbackTarget -Force
        }
        exit 0
    }
}

$Asset = $Release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
$SumsAsset = $Release.assets | Where-Object { $_.name -eq "SHA256SUMS.txt" } | Select-Object -First 1
if (-not $Asset) {
    throw "Release $Version does not contain $AssetName"
}
if (-not $SumsAsset) {
    throw "Release $Version does not contain SHA256SUMS.txt"
}

$TempDir = Join-Path $DestDir ("_aether_update_" + [guid]::NewGuid().ToString("N"))
$ArchivePath = Join-Path $TempDir $AssetName
$SumsPath = Join-Path $TempDir "SHA256SUMS.txt"
$ExtractDir = Join-Path $TempDir "extract"
New-Item -ItemType Directory -Force -Path $TempDir, $ExtractDir | Out-Null

try {
    Write-Host "[core-updater] Downloading Aether $Version..."
    Invoke-WebRequest -Uri $Asset.browser_download_url -Headers $Headers -OutFile $ArchivePath
    Invoke-WebRequest -Uri $SumsAsset.browser_download_url -Headers $Headers -OutFile $SumsPath

    $ChecksumLine = Get-Content $SumsPath | Where-Object { $_ -match ("\s" + [regex]::Escape($AssetName) + "$") } | Select-Object -First 1
    if (-not $ChecksumLine) {
        throw "No checksum entry found for $AssetName"
    }

    $Expected = ($ChecksumLine -split "\s+")[0].ToLowerInvariant()
    $Actual = (Get-FileHash -Path $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected) {
        throw "Checksum mismatch for $AssetName (expected $Expected, got $Actual)"
    }
    Write-Host "[core-updater] SHA-256 verified"

    Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force
    $DownloadedExe = Get-ChildItem -Path $ExtractDir -Recurse -Filter "aether.exe" | Select-Object -First 1
    if (-not $DownloadedExe) {
        throw "aether.exe was not found inside $AssetName"
    }

    # Install the new core under an immutable versioned filename. A connection
    # already using an older version keeps that file untouched; only the small
    # version pointer changes for future connections.
    $VersionedNew = "$VersionedTarget.new"
    Remove-Item $VersionedNew -Force -ErrorAction SilentlyContinue
    Copy-Item $DownloadedExe.FullName $VersionedNew -Force
    Move-Item $VersionedNew $VersionedTarget -Force

    $VersionFileNew = "$VersionFile.new"
    Set-Content -Path $VersionFileNew -Value $Version -NoNewline
    Move-Item $VersionFileNew $VersionFile -Force

    # Keep a conventional filename as a build/manual-run fallback. Failure to
    # refresh this alias must not invalidate the verified versioned install.
    try {
        Copy-Item $VersionedTarget $FallbackTarget -Force
    }
    catch {
        Write-Warning "Could not refresh aether.exe fallback alias: $_"
    }

    Write-Host "[core-updater] Aether core updated to $Version"
}
finally {
    Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
