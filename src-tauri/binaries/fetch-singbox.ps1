param(
    [string]$DestDir = $PSScriptRoot,
    [string]$Version = "v1.13.12"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Repo = "SagerNet/sing-box"
$Headers = @{
    "User-Agent" = "Aether-GUI-Sidecar-Installer"
    "Accept" = "application/vnd.github+json"
}
if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
    $Headers["Authorization"] = "Bearer $($env:GITHUB_TOKEN)"
}
$WintunVersion = "0.14.1"
$WintunSha256 = "07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51"

New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
$Target = Join-Path $DestDir "sing-box.exe"
$VersionFile = Join-Path $DestDir "sing-box-version.txt"
$TargetWintun = Join-Path $DestDir "wintun.dll"
if ((Test-Path $Target) -and (Test-Path $TargetWintun) -and (Test-Path $VersionFile)) {
    if ((Get-Content $VersionFile -Raw).Trim() -eq $Version) {
        Write-Host "[sidecar] sing-box $Version already prepared"
        exit 0
    }
}

function Download-WithRetry([string]$Uri, [string]$OutFile, [hashtable]$RequestHeaders = $Headers) {
    for ($attempt = 1; $attempt -le 4; $attempt++) {
        try {
            Remove-Item $OutFile -Force -ErrorAction SilentlyContinue
            Invoke-WebRequest -Uri $Uri -Headers $RequestHeaders -OutFile $OutFile -UseBasicParsing -TimeoutSec 120
            if ((Get-Item $OutFile).Length -le 0) { throw "Downloaded file is empty" }
            return
        } catch {
            if ($attempt -eq 4) { throw }
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
}

function Sha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
}

$Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/tags/$Version" -Headers $Headers -TimeoutSec 45
if ([string]$Release.tag_name -ne $Version) { throw "Unexpected sing-box release tag" }
$NumericVersion = $Version.TrimStart("v")
$AssetName = "sing-box-$NumericVersion-windows-amd64.zip"
$Asset = $Release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
if (-not $Asset -or -not ([string]$Asset.digest).StartsWith("sha256:")) {
    throw "Release $Version does not expose a SHA-256 digest for $AssetName"
}
$Expected = ([string]$Asset.digest).Substring(7).ToLowerInvariant()

$TempDir = Join-Path $DestDir (".singbox-install-" + [guid]::NewGuid().ToString("N"))
$Archive = Join-Path $TempDir $AssetName
$Extract = Join-Path $TempDir "extract"
New-Item -ItemType Directory -Force -Path $TempDir, $Extract | Out-Null
try {
    Download-WithRetry $Asset.browser_download_url $Archive
    if ((Sha256 $Archive) -ne $Expected) { throw "Checksum mismatch for $AssetName" }
    Expand-Archive -Path $Archive -DestinationPath $Extract -Force
    $Downloaded = Get-ChildItem -Path $Extract -Recurse -Filter "sing-box.exe" | Select-Object -First 1
    if (-not $Downloaded) { throw "sing-box.exe missing from $AssetName" }

    $WintunArchive = Join-Path $TempDir "wintun.zip"
    $WintunExtract = Join-Path $TempDir "wintun"
    Download-WithRetry "https://www.wintun.net/builds/wintun-$WintunVersion.zip" $WintunArchive @{}
    if ((Sha256 $WintunArchive) -ne $WintunSha256) { throw "Checksum mismatch for Wintun" }
    Expand-Archive -Path $WintunArchive -DestinationPath $WintunExtract -Force
    $DownloadedWintun = Get-ChildItem -Path $WintunExtract -Recurse -Filter "wintun.dll" |
        Where-Object { $_.FullName -match "amd64" } | Select-Object -First 1
    if (-not $DownloadedWintun) { throw "amd64 wintun.dll missing" }
    $Signature = Get-AuthenticodeSignature -FilePath $DownloadedWintun.FullName
    if ($Signature.Status -ne "Valid" -or $Signature.SignerCertificate.Subject -notmatch "WireGuard") {
        throw "Wintun Authenticode signature is not valid"
    }

    Copy-Item $Downloaded.FullName "$Target.new" -Force
    Move-Item "$Target.new" $Target -Force
    Copy-Item $DownloadedWintun.FullName $TargetWintun -Force
    Set-Content -Path $VersionFile -Value $Version -NoNewline
    Write-Host "[sidecar] sing-box $Version installed and verified"
} finally {
    Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
