param(
    [string]$DestDir = $PSScriptRoot,
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repo = "CluvexStudio/Aether"
$Headers = @{ "User-Agent" = "Aether-GUI-Core-Manager" }
$AssetName = "aether-windows-x86_64.zip"

New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

if ([string]::IsNullOrWhiteSpace($Version)) {
    $ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"
} else {
    $ApiUrl = "https://api.github.com/repos/$Repo/releases/tags/$Version"
}

$Release = Invoke-RestMethod -Uri $ApiUrl -Headers $Headers
$ResolvedVersion = [string]$Release.tag_name
if ([string]::IsNullOrWhiteSpace($ResolvedVersion)) {
    throw "Aether release metadata did not contain a tag name"
}
if (-not [string]::IsNullOrWhiteSpace($Version) -and $ResolvedVersion -ne $Version) {
    throw "Expected Aether release $Version but GitHub returned $ResolvedVersion"
}

$SafeVersion = $ResolvedVersion -replace '[^A-Za-z0-9._-]', '_'
$VersionedTarget = Join-Path $DestDir "aether-$SafeVersion.exe"
$FallbackTarget = Join-Path $DestDir "aether.exe"
$VersionFile = Join-Path $DestDir "aether-version.txt"

if (Test-Path $VersionedTarget) {
    Write-Host "[core-installer] Aether $ResolvedVersion is already installed"
    exit 0
}

$Asset = $Release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
$SumsAsset = $Release.assets | Where-Object { $_.name -eq "SHA256SUMS.txt" } | Select-Object -First 1
if (-not $Asset) {
    throw "Release $ResolvedVersion does not contain $AssetName"
}
if (-not $SumsAsset) {
    throw "Release $ResolvedVersion does not contain SHA256SUMS.txt"
}

$TempDir = Join-Path $DestDir ("_aether_install_" + [guid]::NewGuid().ToString("N"))
$ArchivePath = Join-Path $TempDir $AssetName
$SumsPath = Join-Path $TempDir "SHA256SUMS.txt"
$ExtractDir = Join-Path $TempDir "extract"
New-Item -ItemType Directory -Force -Path $TempDir, $ExtractDir | Out-Null

try {
    Write-Host "[core-installer] Downloading Aether $ResolvedVersion..."
    Invoke-WebRequest -Uri $Asset.browser_download_url -Headers $Headers -OutFile $ArchivePath
    Invoke-WebRequest -Uri $SumsAsset.browser_download_url -Headers $Headers -OutFile $SumsPath

    $ChecksumLine = Get-Content $SumsPath | Where-Object { $_ -match ("\s" + [regex]::Escape($AssetName) + "$") } | Select-Object -First 1
    if (-not $ChecksumLine) {
        throw "No checksum entry found for $AssetName"
    }

    $Expected = ($ChecksumLine -split "\s+")[0].ToLowerInvariant()
    $Actual = (Get-FileHash -Path $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected) {
        throw "Checksum mismatch for $AssetName"
    }

    Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force
    $DownloadedExe = Get-ChildItem -Path $ExtractDir -Recurse -Filter "aether.exe" | Select-Object -First 1
    if (-not $DownloadedExe) {
        throw "aether.exe was not found inside $AssetName"
    }

    $TemporaryTarget = "$VersionedTarget.new"
    Remove-Item $TemporaryTarget -Force -ErrorAction SilentlyContinue
    Copy-Item $DownloadedExe.FullName $TemporaryTarget -Force
    Move-Item $TemporaryTarget $VersionedTarget -Force

    # Keep a conventional bundled/manual-run alias. Runtime selection uses the
    # shared Core Registry's active-version pointer, never this alias.
    Copy-Item $VersionedTarget $FallbackTarget -Force
    Set-Content -Path $VersionFile -Value $ResolvedVersion -NoNewline

    Write-Host "[core-installer] Aether $ResolvedVersion installed and SHA-256 verified"
}
finally {
    Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
