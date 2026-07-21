param(
    [string]$DestDir = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repo = "SagerNet/sing-box"
$ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"
$Headers = @{ "User-Agent" = "Aether-GUI-TUN-Fetcher" }
$WintunVersion = "0.14.1"
$WintunSha256 = "07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51"

New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

Write-Host "[tun-fetcher] Checking latest stable sing-box release..."
$Release = Invoke-RestMethod -Uri $ApiUrl -Headers $Headers
$Tag = [string]$Release.tag_name
if ([string]::IsNullOrWhiteSpace($Tag)) {
    throw "Latest sing-box release did not contain a tag name"
}
$Version = $Tag.TrimStart("v")
$AssetName = "sing-box-$Version-windows-amd64.zip"
$VersionFile = Join-Path $DestDir "sing-box-version.txt"
$TargetExe = Join-Path $DestDir "sing-box.exe"
$TargetWintun = Join-Path $DestDir "wintun.dll"

if ((Test-Path $TargetExe) -and (Test-Path $TargetWintun) -and (Test-Path $VersionFile)) {
    $InstalledVersion = (Get-Content $VersionFile -Raw).Trim()
    if ($InstalledVersion -eq $Tag) {
        Write-Host "[tun-fetcher] sing-box $Tag is already installed"
        exit 0
    }
}

$Asset = $Release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
if (-not $Asset) {
    throw "Release $Tag does not contain $AssetName"
}

$Digest = [string]$Asset.digest
if ([string]::IsNullOrWhiteSpace($Digest) -or -not $Digest.StartsWith("sha256:")) {
    throw "GitHub did not provide a SHA-256 digest for $AssetName; refusing an unverified download"
}
$Expected = $Digest.Substring("sha256:".Length).ToLowerInvariant()

$TempDir = Join-Path $DestDir ("_singbox_update_" + [guid]::NewGuid().ToString("N"))
$ArchivePath = Join-Path $TempDir $AssetName
$ExtractDir = Join-Path $TempDir "extract"
New-Item -ItemType Directory -Force -Path $TempDir, $ExtractDir | Out-Null

try {
    Write-Host "[tun-fetcher] Downloading sing-box $Tag..."
    Invoke-WebRequest -Uri $Asset.browser_download_url -Headers $Headers -OutFile $ArchivePath

    $Actual = (Get-FileHash -Path $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected) {
        throw "Checksum mismatch for $AssetName (expected $Expected, got $Actual)"
    }
    Write-Host "[tun-fetcher] sing-box SHA-256 verified"

    Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force
    $DownloadedExe = Get-ChildItem -Path $ExtractDir -Recurse -Filter "sing-box.exe" | Select-Object -First 1
    $DownloadedWintun = Get-ChildItem -Path $ExtractDir -Recurse -Filter "wintun.dll" | Select-Object -First 1
    $DownloadedCronet = Get-ChildItem -Path $ExtractDir -Recurse -Filter "libcronet.dll" | Select-Object -First 1

    if (-not $DownloadedExe) {
        throw "sing-box.exe was not found inside $AssetName"
    }

    # Some official sing-box packages ship Wintun side-by-side; if the selected
    # package does not, fetch it only from WireGuard's official distribution.
    # Verify both the archive's published SHA-256 and the extracted DLL's
    # Authenticode signer before accepting it.
    if (-not $DownloadedWintun) {
        Write-Host "[tun-fetcher] Wintun not bundled; downloading official signed Wintun $WintunVersion..."
        $WintunArchive = Join-Path $TempDir "wintun-$WintunVersion.zip"
        $WintunExtract = Join-Path $TempDir "wintun"
        Invoke-WebRequest -Uri "https://www.wintun.net/builds/wintun-$WintunVersion.zip" -OutFile $WintunArchive

        $WintunActual = (Get-FileHash -Path $WintunArchive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($WintunActual -ne $WintunSha256) {
            throw "Checksum mismatch for official Wintun archive (expected $WintunSha256, got $WintunActual)"
        }
        Write-Host "[tun-fetcher] Wintun archive SHA-256 verified"

        Expand-Archive -Path $WintunArchive -DestinationPath $WintunExtract -Force
        $DownloadedWintun = Get-ChildItem -Path $WintunExtract -Recurse -Filter "wintun.dll" |
            Where-Object { $_.FullName -match "amd64" } |
            Select-Object -First 1
        if (-not $DownloadedWintun) {
            throw "amd64 wintun.dll was not found in the official Wintun archive"
        }

        $Signature = Get-AuthenticodeSignature -FilePath $DownloadedWintun.FullName
        if ($Signature.Status -ne "Valid") {
            throw "wintun.dll Authenticode signature is not valid: $($Signature.Status)"
        }
        if (-not $Signature.SignerCertificate -or $Signature.SignerCertificate.Subject -notmatch "WireGuard") {
            throw "wintun.dll signer is not recognized as WireGuard"
        }
        Write-Host "[tun-fetcher] Wintun Authenticode signature verified"
    }

    Copy-Item $DownloadedExe.FullName $TargetExe -Force
    Copy-Item $DownloadedWintun.FullName $TargetWintun -Force
    if ($DownloadedCronet) {
        Copy-Item $DownloadedCronet.FullName (Join-Path $DestDir "libcronet.dll") -Force
    }
    Set-Content -Path $VersionFile -Value $Tag -NoNewline

    Write-Host "[tun-fetcher] sing-box $Tag and verified Wintun are ready"
}
finally {
    Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
