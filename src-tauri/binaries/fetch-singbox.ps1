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
$SingBoxLicenseTarget = Join-Path $DestDir "sing-box-LICENSE.txt"
$TargetWintun = Join-Path $DestDir "wintun.dll"
$WintunLicenseTarget = Join-Path $DestDir "wintun-LICENSE.txt"
if ((Test-Path $Target) -and (Test-Path $TargetWintun) -and
    (Test-Path $SingBoxLicenseTarget) -and (Test-Path $WintunLicenseTarget) -and
    (Test-Path $VersionFile)) {
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
    $Stream = [System.IO.File]::OpenRead($Path)
    try {
        $Hasher = [System.Security.Cryptography.SHA256]::Create()
        try {
            $Bytes = $Hasher.ComputeHash($Stream)
            return ([System.BitConverter]::ToString($Bytes)).Replace("-", "").ToLowerInvariant()
        } finally {
            $Hasher.Dispose()
        }
    } finally {
        $Stream.Dispose()
    }
}

function Test-TrustedAuthenticode([string]$Path, [string]$ExpectedSignerPattern) {
    if (-not ("AetherWinTrustVerifier" -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class AetherWinTrustVerifier
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private sealed class WinTrustFileInfo : IDisposable
    {
        public uint cbStruct = (uint)Marshal.SizeOf(typeof(WinTrustFileInfo));
        public IntPtr pcwszFilePath;
        public IntPtr hFile = IntPtr.Zero;
        public IntPtr pgKnownSubject = IntPtr.Zero;

        public WinTrustFileInfo(string filePath)
        {
            pcwszFilePath = Marshal.StringToCoTaskMemUni(filePath);
        }

        public void Dispose()
        {
            if (pcwszFilePath != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(pcwszFilePath);
                pcwszFilePath = IntPtr.Zero;
            }
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private sealed class WinTrustData : IDisposable
    {
        public uint cbStruct = (uint)Marshal.SizeOf(typeof(WinTrustData));
        public IntPtr pPolicyCallbackData = IntPtr.Zero;
        public IntPtr pSIPClientData = IntPtr.Zero;
        public uint dwUIChoice = 2;
        public uint fdwRevocationChecks = 0;
        public uint dwUnionChoice = 1;
        public IntPtr pFile;
        public uint dwStateAction = 0;
        public IntPtr hWVTStateData = IntPtr.Zero;
        public IntPtr pwszURLReference = IntPtr.Zero;
        public uint dwProvFlags = 0x00001000;
        public uint dwUIContext = 0;

        public WinTrustData(WinTrustFileInfo fileInfo)
        {
            pFile = Marshal.AllocCoTaskMem(Marshal.SizeOf(typeof(WinTrustFileInfo)));
            Marshal.StructureToPtr(fileInfo, pFile, false);
        }

        public void Dispose()
        {
            if (pFile != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(pFile);
                pFile = IntPtr.Zero;
            }
        }
    }

    [DllImport("wintrust.dll", ExactSpelling = true, SetLastError = false, CharSet = CharSet.Unicode)]
    private static extern uint WinVerifyTrust(
        IntPtr hwnd,
        [MarshalAs(UnmanagedType.LPStruct)] Guid actionId,
        WinTrustData trustData);

    public static int Verify(string filePath)
    {
        Guid action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
        using (var fileInfo = new WinTrustFileInfo(filePath))
        using (var trustData = new WinTrustData(fileInfo))
        {
            return unchecked((int)WinVerifyTrust(new IntPtr(-1), action, trustData));
        }
    }
}
"@
    }

    $Result = [AetherWinTrustVerifier]::Verify($Path)
    if ($Result -ne 0) {
        $UnsignedResult = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$Result), 0)
        throw ("WinVerifyTrust rejected {0} with status 0x{1:X8}" -f $Path, $UnsignedResult)
    }

    $RawCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($Path)
    $Certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($RawCertificate)
    try {
        if ($Certificate.Subject -notmatch $ExpectedSignerPattern) {
            throw "Authenticode signer '$($Certificate.Subject)' does not match '$ExpectedSignerPattern'"
        }
    } finally {
        $Certificate.Dispose()
    }
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
    $SingBoxLicense = Get-ChildItem -Path $Extract -Recurse -File |
        Where-Object { $_.Name -in @("LICENSE", "LICENSE.txt", "COPYING") } |
        Select-Object -First 1
    if (-not $Downloaded) { throw "sing-box.exe missing from $AssetName" }
    if (-not $SingBoxLicense) { throw "sing-box license missing from $AssetName" }

    $WintunArchive = Join-Path $TempDir "wintun.zip"
    $WintunExtract = Join-Path $TempDir "wintun"
    Download-WithRetry "https://www.wintun.net/builds/wintun-$WintunVersion.zip" $WintunArchive @{}
    if ((Sha256 $WintunArchive) -ne $WintunSha256) { throw "Checksum mismatch for Wintun" }
    Expand-Archive -Path $WintunArchive -DestinationPath $WintunExtract -Force
    $DownloadedWintun = Get-ChildItem -Path $WintunExtract -Recurse -Filter "wintun.dll" |
        Where-Object { $_.FullName -match "amd64" } | Select-Object -First 1
    $WintunLicense = Get-ChildItem -Path $WintunExtract -Recurse -File |
        Where-Object { $_.Name -match "license" } | Select-Object -First 1
    if (-not $DownloadedWintun) { throw "amd64 wintun.dll missing" }
    if (-not $WintunLicense) { throw "Wintun prebuilt-binaries license missing" }

    Test-TrustedAuthenticode $DownloadedWintun.FullName "WireGuard"

    Copy-Item $Downloaded.FullName "$Target.new" -Force
    Copy-Item $SingBoxLicense.FullName "$SingBoxLicenseTarget.new" -Force
    Move-Item "$Target.new" $Target -Force
    Move-Item "$SingBoxLicenseTarget.new" $SingBoxLicenseTarget -Force
    Copy-Item $DownloadedWintun.FullName $TargetWintun -Force
    Copy-Item $WintunLicense.FullName $WintunLicenseTarget -Force
    Set-Content -Path $VersionFile -Value $Version -NoNewline
    Write-Host "[sidecar] sing-box $Version and Wintun installed with verified licenses"
} finally {
    Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
