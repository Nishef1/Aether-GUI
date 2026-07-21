param(
    [string]$DestDir = $PSScriptRoot,
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repo = "CluvexStudio/Aether"
$Headers = @{
    "User-Agent" = "Aether-GUI-Core-Manager"
    "Accept" = "application/vnd.github+json"
}
$AssetName = "aether-windows-x86_64.zip"

# Windows PowerShell 5.1 can otherwise negotiate an obsolete TLS version on
# older machines. GitHub requires modern TLS.
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
        [int]$Attempts = 3
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            Remove-Item $OutFile -Force -ErrorAction SilentlyContinue
            Invoke-WebRequest -Uri $Uri -Headers $Headers -OutFile $OutFile -UseBasicParsing -TimeoutSec 90
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

New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

if ([string]::IsNullOrWhiteSpace($Version)) {
    $ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"
} else {
    $ApiUrl = "https://api.github.com/repos/$Repo/releases/tags/$Version"
}

$Release = Invoke-RestJsonWithRetry -Uri $ApiUrl
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
    Invoke-DownloadWithRetry -Uri $Asset.browser_download_url -OutFile $ArchivePath
    Invoke-DownloadWithRetry -Uri $SumsAsset.browser_download_url -OutFile $SumsPath

    $ChecksumLine = Get-Content $SumsPath | Where-Object { $_ -match ("\s" + [regex]::Escape($AssetName) + "$") } | Select-Object -First 1
    if (-not $ChecksumLine) {
        throw "No checksum entry found for $AssetName"
    }

    $Expected = ($ChecksumLine -split "\s+")[0].ToLowerInvariant()
    $Actual = Get-Sha256Hex -Path $ArchivePath
    if ($Actual -ne $Expected) {
        throw "Checksum mismatch for $AssetName"
    }

    Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force
    $DownloadedExe = Get-ChildItem -Path $ExtractDir -Recurse -Filter "aether.exe" | Select-Object -First 1
    if (-not $DownloadedExe -or $DownloadedExe.Length -le 0) {
        throw "aether.exe was not found or is empty inside $AssetName"
    }

    # Replace the immutable versioned binary only after the verified archive has
    # been fully downloaded and extracted. A failed download never destroys the
    # previously working version.
    $TemporaryTarget = "$VersionedTarget.new"
    Remove-Item $TemporaryTarget -Force -ErrorAction SilentlyContinue
    Copy-Item $DownloadedExe.FullName $TemporaryTarget -Force
    if ((Get-Item $TemporaryTarget).Length -le 0) {
        throw "Prepared Aether binary is empty"
    }
    Remove-Item $VersionedTarget -Force -ErrorAction SilentlyContinue
    Move-Item $TemporaryTarget $VersionedTarget -Force

    Copy-Item $VersionedTarget $FallbackTarget -Force
    Set-Content -Path $VersionFile -Value $ResolvedVersion -NoNewline

    if (-not (Test-Path $VersionedTarget) -or (Get-Item $VersionedTarget).Length -le 0) {
        throw "Aether versioned binary was not installed correctly"
    }
    if (-not (Test-Path $FallbackTarget) -or (Get-Item $FallbackTarget).Length -le 0) {
        throw "Aether fallback binary was not installed correctly"
    }
    if ((Get-Content $VersionFile -Raw).Trim() -ne $ResolvedVersion) {
        throw "Aether version metadata was not written correctly"
    }

    Write-Host "[core-installer] Aether $ResolvedVersion installed and SHA-256 verified"
}
finally {
    Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}