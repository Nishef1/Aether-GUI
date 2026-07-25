param(
    [string]$DestDir = $PSScriptRoot,
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repo = "XTLS/Xray-core"
$Headers = @{
    "User-Agent" = "Aether-GUI-Core-Manager"
    "Accept" = "application/vnd.github+json"
}
if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
    $Headers["Authorization"] = "Bearer $($env:GITHUB_TOKEN)"
}
$AssetName = "Xray-windows-64.zip"
$WintunVersion = "0.14.1"
$WintunSha256 = "07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Invoke-RestJsonWithRetry {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [int]$Attempts = 3
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            return Invoke-RestMethod -Uri $Uri -Headers $Headers -TimeoutSec 30
        }
        catch {
            if ($attempt -eq $Attempts) {
                throw
            }
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
}

function Invoke-DownloadWithRetry {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$OutFile,
        [hashtable]$RequestHeaders = $Headers,
        [int]$Attempts = 3
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            Remove-Item $OutFile -Force -ErrorAction SilentlyContinue
            Invoke-WebRequest -Uri $Uri -Headers $RequestHeaders -OutFile $OutFile -UseBasicParsing -TimeoutSec 90
            if (-not (Test-Path $OutFile) -or (Get-Item $OutFile).Length -le 0) {
                throw "Downloaded file is empty: $OutFile"
            }
            return
        }
        catch {
            Remove-Item $OutFile -Force -ErrorAction SilentlyContinue
            if ($attempt -eq $Attempts) {
                throw
            }
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
}

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

function Assert-WintunAuthenticode {
    param([Parameter(Mandatory = $true)][string]$Path)

    $SecurityModuleManifest = Join-Path $PSHOME "Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1"
    Import-Module -Name $SecurityModuleManifest -ErrorAction Stop
    $Signature = Get-AuthenticodeSignature -FilePath $Path
    if ($Signature.Status -ne "Valid") {
        throw "wintun.dll Authenticode signature is not valid: $($Signature.Status)"
    }
    if (-not $Signature.SignerCertificate -or $Signature.SignerCertificate.Subject -notmatch "WireGuard") {
        throw "wintun.dll signer is not recognized as WireGuard"
    }
}

New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

if ([string]::IsNullOrWhiteSpace($Version)) {
    $ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"
} else {
    $ApiUrl = "https://api.github.com/repos/$Repo/releases/tags/$Version"
}

$Release = Invoke-RestJsonWithRetry -Uri $ApiUrl
$Tag = [string]$Release.tag_name
if ([string]::IsNullOrWhiteSpace($Tag)) {
    throw "Xray release metadata did not contain a tag name"
}
if (-not [string]::IsNullOrWhiteSpace($Version) -and $Tag -ne $Version) {
    throw "Expected Xray release $Version but GitHub returned $Tag"
}

$SafeVersion = $Tag -replace '[^A-Za-z0-9._-]', '_'
$VersionedTarget = Join-Path $DestDir "xray-$SafeVersion.exe"
$FallbackTarget = Join-Path $DestDir "xray.exe"
$VersionFile = Join-Path $DestDir "xray-version.txt"
$TargetWintun = Join-Path $DestDir "wintun.dll"

$Asset = $Release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
if (-not $Asset) {
    throw "Release $Tag does not contain $AssetName"
}
$Digest = [string]$Asset.digest
if ([string]::IsNullOrWhiteSpace($Digest) -or -not $Digest.StartsWith("sha256:")) {
    throw "GitHub did not provide a SHA-256 digest for $AssetName"
}
$Expected = $Digest.Substring("sha256:".Length).ToLowerInvariant()

$TempDir = Join-Path $DestDir ("_xray_install_" + [guid]::NewGuid().ToString("N"))
$ArchivePath = Join-Path $TempDir $AssetName
$ExtractDir = Join-Path $TempDir "extract"
$WintunArchive = Join-Path $TempDir "wintun-$WintunVersion.zip"
$WintunExtract = Join-Path $TempDir "wintun"
New-Item -ItemType Directory -Force -Path $TempDir, $ExtractDir, $WintunExtract | Out-Null

try {
    Write-Host "[core-installer] Downloading Xray $Tag..."
    Invoke-DownloadWithRetry -Uri $Asset.browser_download_url -OutFile $ArchivePath
    $Actual = Get-Sha256Hex -Path $ArchivePath
    if ($Actual -ne $Expected) {
        throw "Checksum mismatch for $AssetName"
    }

    Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force
    $DownloadedExe = Get-ChildItem -Path $ExtractDir -Recurse -Filter "xray.exe" | Select-Object -First 1
    if (-not $DownloadedExe -or $DownloadedExe.Length -le 0) {
        throw "xray.exe was not found or is empty inside $AssetName"
    }

    Invoke-DownloadWithRetry -Uri "https://www.wintun.net/builds/wintun-$WintunVersion.zip" -OutFile $WintunArchive -RequestHeaders @{}
    $WintunActual = Get-Sha256Hex -Path $WintunArchive
    if ($WintunActual -ne $WintunSha256) {
        throw "Checksum mismatch for official Wintun archive"
    }
    Expand-Archive -Path $WintunArchive -DestinationPath $WintunExtract -Force
    $DownloadedWintun = Get-ChildItem -Path $WintunExtract -Recurse -Filter "wintun.dll" |
        Where-Object { $_.FullName -match "amd64" } |
        Select-Object -First 1
    if (-not $DownloadedWintun -or $DownloadedWintun.Length -le 0) {
        throw "amd64 wintun.dll was not found or is empty"
    }
    Assert-WintunAuthenticode -Path $DownloadedWintun.FullName

    $TemporaryTarget = "$VersionedTarget.new"
    Remove-Item $TemporaryTarget -Force -ErrorAction SilentlyContinue
    Copy-Item $DownloadedExe.FullName $TemporaryTarget -Force
    if ((Get-Item $TemporaryTarget).Length -le 0) {
        throw "Prepared Xray binary is empty"
    }
    Remove-Item $VersionedTarget -Force -ErrorAction SilentlyContinue
    Move-Item $TemporaryTarget $VersionedTarget -Force

    Copy-Item $VersionedTarget $FallbackTarget -Force
    Copy-Item $DownloadedWintun.FullName $TargetWintun -Force
    Set-Content -Path $VersionFile -Value $Tag -NoNewline

    if (-not (Test-Path $VersionedTarget) -or (Get-Item $VersionedTarget).Length -le 0) {
        throw "Xray versioned binary was not installed correctly"
    }
    if (-not (Test-Path $FallbackTarget) -or (Get-Item $FallbackTarget).Length -le 0) {
        throw "Xray fallback binary was not installed correctly"
    }
    if (-not (Test-Path $TargetWintun) -or (Get-Item $TargetWintun).Length -le 0) {
        throw "wintun.dll was not installed correctly"
    }
    if ((Get-Content $VersionFile -Raw).Trim() -ne $Tag) {
        throw "Xray version metadata was not written correctly"
    }

    Write-Host "[core-installer] Xray $Tag installed, SHA-256 verified, and Wintun signature validated"
}
finally {
    Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
