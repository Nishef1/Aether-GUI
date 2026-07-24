param(
    [string]$AetherRepo = "",
    [string]$AppDataDir = "",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

# Some constrained Windows PowerShell environments do not expose the
# Microsoft.PowerShell.Utility Get-FileHash cmdlet. The installer helper only
# needs SHA-256, so provide a compatible .NET implementation in that case.
if (-not (Get-Command "Get-FileHash" -ErrorAction SilentlyContinue)) {
    function global:Get-FileHash {
        param(
            [Parameter(Mandatory = $true)][string]$Path,
            [ValidateSet("SHA256")][string]$Algorithm = "SHA256"
        )

        $fullPath = [System.IO.Path]::GetFullPath($Path)
        $stream = [System.IO.File]::OpenRead($fullPath)
        try {
            $hasher = [System.Security.Cryptography.SHA256]::Create()
            try {
                $hash = $hasher.ComputeHash($stream)
                [PSCustomObject]@{
                    Algorithm = $Algorithm
                    Hash = ([System.BitConverter]::ToString($hash)).Replace("-", "")
                    Path = $fullPath
                }
            }
            finally {
                $hasher.Dispose()
            }
        }
        finally {
            $stream.Dispose()
        }
    }
}

function Add-DirectoryToPath {
    param([Parameter(Mandatory = $true)][string]$Directory)

    $normalized = [System.IO.Path]::GetFullPath($Directory).TrimEnd('\')
    $entries = @($env:PATH -split ';') | ForEach-Object {
        if ([string]::IsNullOrWhiteSpace($_)) { return }
        try { [System.IO.Path]::GetFullPath($_).TrimEnd('\') } catch { $_.TrimEnd('\') }
    }
    if ($entries -notcontains $normalized) {
        $env:PATH = "$normalized;$env:PATH"
    }
}

function Find-LibClangDirectory {
    $candidates = New-Object System.Collections.Generic.List[string]

    if (-not [string]::IsNullOrWhiteSpace($env:LIBCLANG_PATH)) {
        $candidates.Add($env:LIBCLANG_PATH)
    }

    $clang = Get-Command "clang.exe" -ErrorAction SilentlyContinue
    if ($clang) {
        $candidates.Add((Split-Path $clang.Source -Parent))
    }

    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $candidates.Add((Join-Path $env:ProgramFiles "LLVM\bin"))
    }
    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
        $candidates.Add((Join-Path ${env:ProgramFiles(x86)} "LLVM\bin"))
    }
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $candidates.Add((Join-Path $env:LOCALAPPDATA "Programs\LLVM\bin"))

        $wingetRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
        if (Test-Path $wingetRoot) {
            $wingetPackages = Get-ChildItem -Path $wingetRoot -Directory -Filter "LLVM.LLVM_*" -ErrorAction SilentlyContinue
            foreach ($package in $wingetPackages) {
                $dll = Get-ChildItem -Path $package.FullName -Recurse -File -Filter "libclang.dll" -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($dll) {
                    $candidates.Add($dll.DirectoryName)
                }
            }
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        $candidates.Add((Join-Path $env:USERPROFILE "scoop\apps\llvm\current\bin"))
    }
    if (-not [string]::IsNullOrWhiteSpace($env:ChocolateyInstall)) {
        $candidates.Add((Join-Path $env:ChocolateyInstall "lib\llvm\tools\llvm\bin"))
    }

    $vswhere = $null
    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
        $vswhereCandidate = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
        if (Test-Path $vswhereCandidate) {
            $vswhere = $vswhereCandidate
        }
    }

    if ($vswhere) {
        $installations = @(
            & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Llvm.Clang -property installationPath 2>$null
        ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

        foreach ($installation in $installations) {
            $root = $installation.Trim()
            $candidates.Add((Join-Path $root "VC\Tools\Llvm\x64\bin"))
            $candidates.Add((Join-Path $root "VC\Tools\Llvm\bin"))
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        foreach ($edition in @("Community", "Professional", "Enterprise", "BuildTools")) {
            $vsRoot = Join-Path $env:ProgramFiles "Microsoft Visual Studio\2022\$edition"
            $candidates.Add((Join-Path $vsRoot "VC\Tools\Llvm\x64\bin"))
            $candidates.Add((Join-Path $vsRoot "VC\Tools\Llvm\bin"))
        }
    }

    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        $directory = [System.IO.Path]::GetFullPath($candidate)
        if (Test-Path (Join-Path $directory "libclang.dll")) {
            return $directory
        }
    }

    return $null
}

if (-not $SkipBuild) {
    $libClangDirectory = Find-LibClangDirectory
    if (-not $libClangDirectory) {
        throw @"
LLVM/Clang is required because Rust bindgen needs libclang.dll, but it was not found.
Install it once, reopen the terminal, pull main, and run pnpm dev:custom again:

  winget install --id LLVM.LLVM -e --source winget

Alternatively, open Visual Studio Installer > Modify > Individual components and add:
  C++ Clang tools for Windows
"@
    }

    $env:LIBCLANG_PATH = $libClangDirectory
    Add-DirectoryToPath -Directory $libClangDirectory

    $clangExe = Join-Path $libClangDirectory "clang.exe"
    $clangVersion = if (Test-Path $clangExe) {
        (& $clangExe --version | Select-Object -First 1)
    } else {
        (Get-Item (Join-Path $libClangDirectory "libclang.dll")).VersionInfo.FileVersion
    }
    Write-Host "[local-core] Using LLVM/Clang $clangVersion from $libClangDirectory"
}

$helper = Join-Path $PSScriptRoot "use-local-aether.ps1"
$arguments = @{}
if (-not [string]::IsNullOrWhiteSpace($AetherRepo)) {
    $arguments.AetherRepo = $AetherRepo
}
if (-not [string]::IsNullOrWhiteSpace($AppDataDir)) {
    $arguments.AppDataDir = $AppDataDir
}
if ($SkipBuild) {
    $arguments.SkipBuild = $true
}

& $helper @arguments
