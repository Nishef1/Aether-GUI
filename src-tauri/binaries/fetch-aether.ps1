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
$Target = Join-Path $DestDir "aether.exe"
$VersionFile = Join-Path $DestDir "aether-version.txt"

Write-Host "[core-updater] Checking latest stable Aether release..."
$Release = Invoke-RestMethod -Uri $ApiUrl -Headers $Headers
$Version = [string]$Release.tag_name
if ([string]::IsNullOrWhiteSpace($Version)) {
    throw "Latest Aether release did not contain a tag name"
}

if ((Test-Path $Target) -and (Test-Path $VersionFile)) {
    $InstalledVersion = (Get-Content $VersionFile -Raw).Trim()
    if ($InstalledVersion -eq $Version) {
        Write-Host "[core-updater] Aether $Version is already installed"
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

    $NewTarget = "$Target.new"
    $BackupTarget = "$Target.old"
    Remove-Item $NewTarget -Force -ErrorAction SilentlyContinue
    Copy-Item $DownloadedExe.FullName $NewTarget -Force

    Remove-Item $BackupTarget -Force -ErrorAction SilentlyContinue
    $HadExisting = Test-Path $Target
    if ($HadExisting) {
        Move-Item $Target $BackupTarget -Force
    }

    try {
        Move-Item $NewTarget $Target -Force
        Set-Content -Path $VersionFile -Value $Version -NoNewline
        Remove-Item $BackupTarget -Force -ErrorAction SilentlyContinue
    }
    catch {
        Remove-Item $Target -Force -ErrorAction SilentlyContinue
        if (Test-Path $BackupTarget) {
            Move-Item $BackupTarget $Target -Force
        }
        throw
    }

    Write-Host "[core-updater] Aether core updated to $Version"
}
finally {
    Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
