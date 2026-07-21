param(
    [string]$DestDir = $PSScriptRoot,
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repo = "SagerNet/sing-box"
$Headers = @{ "User-Agent" = "Aether-GUI-Core-Manager" }
$WintunVersion = "0.14.1"
$WintunSha256 = "07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51"

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

New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

if ([string]::IsNullOrWhiteSpace($Version)) {
    $ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"
} else {
    $ApiUrl = "https://api.github.com/repos/$Repo/releases/tags/$Version"
}

$Release = Invoke-RestMethod -Uri $ApiUrl -Headers $Headers
$Tag = [string]$Release.tag_name
if ([string]::IsNullOrWhiteSpace($Tag)) {
    throw "sing-box release metadata did not contain a tag name"
}
if (-not [string]::IsNullOrWhiteSpace($Version) -and $Tag -ne $Version) {
    throw "Expected sing-box release $Version but GitHub returned $Tag"
}

$NumericVersion = $Tag.TrimStart("v")
$SafeVersion = $Tag -replace '[^A-Za-z0-9._-]', '_'
$AssetName = "sing-box-$NumericVersion-windows-amd64.zip"
$VersionedTarget = Join-Path $DestDir "sing-box-$SafeVersion.exe"
$FallbackTarget = Join-Path $DestDir "sing-box.exe"
$TargetWintun = Join-Path $DestDir "wintun.dll"
$VersionFile = Join-Path $DestDir "sing-box-version.txt"

if ((Test-Path $VersionedTarget) -and (Test-Path $TargetWintun)) {
    # Never let a cached executable skip the aliases and metadata bundled by
    # Tauri. libcronet.dll, when present from the selected build, is retained.
    Copy-Item $VersionedTarget $FallbackTarget -Force
    Set-Content -Path $VersionFile -Value $Tag -NoNewline
    Write-Host "[core-installer] sing-box $Tag is already installed and packaging outputs were refreshed"
    exit 0
}

$Asset = $Release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
if (-not $Asset) {
    throw "Release $Tag does not contain $AssetName"
}
$Digest = [string]$Asset.digest
if ([string]::IsNullOrWhiteSpace($Digest) -or -not $Digest.StartsWith("sha256:")) {
    throw "GitHub did not provide a SHA-256 digest for $AssetName"
}
$Expected = $Digest.Substring("sha256:".Length).ToLowerInvariant()

$TempDir = Join-Path $DestDir ("_singbox_install_" + [guid]::NewGuid().ToString("N"))
$ArchivePath = Join-Path $TempDir $AssetName
$ExtractDir = Join-Path $TempDir "extract"
New-Item -ItemType Directory -Force -Path $TempDir, $ExtractDir | Out-Null

try {
    Invoke-WebRequest -Uri $Asset.browser_download_url -Headers $Headers -OutFile $ArchivePath
    $Actual = Get-Sha256Hex -Path $ArchivePath
    if ($Actual -ne $Expected) {
        throw "Checksum mismatch for $AssetName"
    }

    Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force
    $DownloadedExe = Get-ChildItem -Path $ExtractDir -Recurse -Filter "sing-box.exe" | Select-Object -First 1
    $DownloadedWintun = Get-ChildItem -Path $ExtractDir -Recurse -Filter "wintun.dll" | Select-Object -First 1
    $DownloadedCronet = Get-ChildItem -Path $ExtractDir -Recurse -Filter "libcronet.dll" | Select-Object -First 1
    if (-not $DownloadedExe) {
        throw "sing-box.exe was not found inside $AssetName"
    }

    if (-not $DownloadedWintun -and -not (Test-Path $TargetWintun)) {
        $WintunArchive = Join-Path $TempDir "wintun-$WintunVersion.zip"
        $WintunExtract = Join-Path $TempDir "wintun"
        Invoke-WebRequest -Uri "https://www.wintun.net/builds/wintun-$WintunVersion.zip" -OutFile $WintunArchive
        $WintunActual = Get-Sha256Hex -Path $WintunArchive
        if ($WintunActual -ne $WintunSha256) {
            throw "Checksum mismatch for official Wintun archive"
        }
        Expand-Archive -Path $WintunArchive -DestinationPath $WintunExtract -Force
        $DownloadedWintun = Get-ChildItem -Path $WintunExtract -Recurse -Filter "wintun.dll" |
            Where-Object { $_.FullName -match "amd64" } |
            Select-Object -First 1
        if (-not $DownloadedWintun) {
            throw "amd64 wintun.dll was not found in the official Wintun archive"
        }
        # PSModulePath can contain the PowerShell 7 module directory even when
        # this script is launched by Windows PowerShell (and vice versa). Let
        # the current host load its matching security module explicitly instead
        # of relying on module auto-loading, which can fail with
        # CouldNotAutoloadMatchingModule.
        $SecurityModuleManifest = Join-Path $PSHOME "Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1"
        Import-Module -Name $SecurityModuleManifest -ErrorAction Stop
        $Signature = Get-AuthenticodeSignature -FilePath $DownloadedWintun.FullName
        if ($Signature.Status -ne "Valid") {
            throw "wintun.dll Authenticode signature is not valid: $($Signature.Status)"
        }
        if (-not $Signature.SignerCertificate -or $Signature.SignerCertificate.Subject -notmatch "WireGuard") {
            throw "wintun.dll signer is not recognized as WireGuard"
        }
    }

    $TemporaryTarget = "$VersionedTarget.new"
    Remove-Item $TemporaryTarget -Force -ErrorAction SilentlyContinue
    Copy-Item $DownloadedExe.FullName $TemporaryTarget -Force
    Move-Item $TemporaryTarget $VersionedTarget -Force

    if ($DownloadedWintun) {
        Copy-Item $DownloadedWintun.FullName $TargetWintun -Force
    }
    Copy-Item $VersionedTarget $FallbackTarget -Force
    if ($DownloadedCronet) {
        Copy-Item $DownloadedCronet.FullName (Join-Path $DestDir "libcronet.dll") -Force
    }
    Set-Content -Path $VersionFile -Value $Tag -NoNewline

    Write-Host "[core-installer] sing-box $Tag installed and SHA-256 verified"
}
finally {
    Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
