param(
  [string]$Asset = ""
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$DestDir = Join-Path $Root "src-tauri\binaries"
$VersionsPath = Join-Path $Root "scripts\runtime-versions.json"
$Versions = Get-Content $VersionsPath -Raw | ConvertFrom-Json
$Version = [string]$Versions.aether.version

if ($Version -notmatch '^v\d+\.\d+\.\d+$') {
  throw "Invalid Aether version in scripts/runtime-versions.json"
}

if ([string]::IsNullOrWhiteSpace($Asset)) {
  if (-not [string]::IsNullOrWhiteSpace($env:AETHER_ASSET)) {
    $Asset = $env:AETHER_ASSET
  } else {
    $Asset = "aether-windows-x86_64.zip"
  }
}

New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
$Target = Join-Path $DestDir "aether.exe"
$Stamp = Join-Path $DestDir "aether-version.txt"
$ExpectedVersion = $Version -replace '^v', ''

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

function Test-AetherVersion {
  if (-not (Test-Path $Target)) {
    return $false
  }
  try {
    $reported = (& $Target --version 2>$null | Out-String).Trim()
    return $reported.Contains($ExpectedVersion)
  } catch {
    return $false
  }
}

if ((Test-Path $Target) -and (Test-Path $Stamp)) {
  $stampVersion = (Get-Content $Stamp -Raw).Trim()
  if ($stampVersion -eq $Version -and (Test-AetherVersion)) {
    Write-Host "[core] Aether $Version already prepared"
    exit 0
  }
  if ($stampVersion -eq $Version) {
    Write-Warning "Existing Aether stamp matched but binary version did not; replacing it"
  }
}

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("aether-core-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
  $Archive = Join-Path $TempDir $Asset
  $Sums = Join-Path $TempDir "SHA256SUMS.txt"
  $BaseUrl = "https://github.com/CluvexStudio/Aether/releases/download/$Version"

  Invoke-WebRequest -UseBasicParsing "$BaseUrl/$Asset" -OutFile $Archive
  Invoke-WebRequest -UseBasicParsing "$BaseUrl/SHA256SUMS.txt" -OutFile $Sums

  $ExpectedSha = $null
  foreach ($line in Get-Content $Sums) {
    $parts = $line.Trim() -split '\s+'
    if ($parts.Count -lt 2) {
      continue
    }
    $name = $parts[-1].TrimStart("*")
    if ($name -eq $Asset) {
      $ExpectedSha = $parts[0].ToLowerInvariant()
      break
    }
  }

  if (-not $ExpectedSha -or $ExpectedSha -notmatch '^[0-9a-f]{64}$') {
    throw "Aether checksum entry was not found for $Asset"
  }

  $ActualSha = Sha256 $Archive
  if ($ActualSha -ne $ExpectedSha) {
    throw "Checksum verification failed for $Asset"
  }

  $Extract = Join-Path $TempDir "extract"
  Expand-Archive $Archive -DestinationPath $Extract
  $Downloaded = Get-ChildItem $Extract -Recurse -File -Filter "aether.exe" | Select-Object -First 1
  if (-not $Downloaded) {
    throw "Aether executable was not found in $Asset"
  }

  $Staged = "$Target.new"
  Copy-Item $Downloaded.FullName $Staged -Force
  Move-Item $Staged $Target -Force

  if (-not (Test-AetherVersion)) {
    Remove-Item $Target -Force -ErrorAction SilentlyContinue
    throw "Downloaded Aether binary did not report expected version $ExpectedVersion"
  }

  Set-Content -Path $Stamp -Value $Version -NoNewline
  Write-Host "[core] Aether $Version ready from $Asset"
} finally {
  Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
