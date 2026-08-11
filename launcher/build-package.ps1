# Build the double-click Windows package locally.
#
#   powershell -ExecutionPolicy Bypass -File launcher\build-package.ps1
#
# Produces launcher\out\ZombieFarmReforged-Windows.zip: the offline game build
# plus the launcher, laid out so a player can unzip and double-click. This is the
# same package .github/workflows/release-windows.yml publishes - use it when you
# are packaging a MOD and can't run CI.
#
# -SkipBuild reuses an existing folder instead of compiling, which is what you
# want when the thing you are packaging is a modded dist:
#
#   powershell -ExecutionPolicy Bypass -File launcher\build-package.ps1 -SkipBuild -GameFolder C:\my-mod\dist

[CmdletBinding()]
param(
    # Built game to wrap. Defaults to the dist/ produced by this script.
    [string]$GameFolder = '',
    [string]$OutDir = '',
    # Don't run npm; just package $GameFolder as it stands.
    [switch]$SkipBuild,
    # Package even if the build still talks to the live server (mods shouldn't).
    [switch]$AllowOnlineBuild
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$packageSource = Join-Path $PSScriptRoot 'package'
if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot 'out' }
$folderName = 'Zombie Farm Reforged'
$zipPath = Join-Path $OutDir 'ZombieFarmReforged-Windows.zip'

if (-not $SkipBuild) {
    # .env.production.local outranks .env.production in Vite and is gitignored,
    # so the online config is switched off without editing a tracked file.
    $envLocal = Join-Path $repo '.env.production.local'
    $backup = "$envLocal.bak-package"
    if (Test-Path -LiteralPath $envLocal) { Move-Item -LiteralPath $envLocal -Destination $backup -Force }
    try {
        Set-Content -LiteralPath $envLocal -Value "VITE_API_URL=`nVITE_GOOGLE_CLIENT_ID=" -Encoding ASCII
        Write-Host 'Building the offline client (npm run build)...' -ForegroundColor Cyan
        Push-Location $repo
        try {
            & npm run build
            if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
        } finally { Pop-Location }
    } finally {
        Remove-Item -LiteralPath $envLocal -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $envLocal -Force }
    }
    if (-not $GameFolder) { $GameFolder = Join-Path $repo 'dist' }
}

if (-not $GameFolder) { $GameFolder = Join-Path $repo 'dist' }
if (-not (Test-Path -LiteralPath (Join-Path $GameFolder 'index.html'))) {
    throw "No index.html in '$GameFolder' - that isn't a built game folder."
}

# A local, moddable client must not be able to reach the live server: it would be
# a cheating vector, and the browser blocks the calls with CORS errors anyway.
$textFiles = Get-ChildItem -LiteralPath $GameFolder -Recurse -File -Include *.js, *.html, *.json, *.webmanifest -ErrorAction SilentlyContinue
$leak = $textFiles | Select-String -Pattern 'zombiefarm-server.zombiefarm.workers.dev' -SimpleMatch -List |
        Select-Object -First 1
if ($leak) {
    $message = "This build still references the live server ($($leak.Path)). It is an ONLINE build, not an offline one."
    if ($AllowOnlineBuild) { Write-Warning $message } else { throw "$message Re-run without -SkipBuild, or pass -AllowOnlineBuild." }
}

$staging = Join-Path $OutDir 'staging'
Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
$root = Join-Path $staging $folderName
New-Item -ItemType Directory -Path $root -Force | Out-Null

Write-Host "Assembling $folderName..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $packageSource '*') -Destination $root -Recurse -Force
Remove-Item -LiteralPath (Join-Path $root '.gitignore') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $root 'game') -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path $GameFolder -Destination (Join-Path $root 'game') -Recurse -Force

foreach ($required in @('Play Zombie Farm.cmd', 'launcher\launcher.ps1', 'launcher\zombiefarm.ico', 'game\index.html')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $required))) { throw "Package is missing $required" }
}

# cmd.exe can mis-parse multi-line blocks in an LF-only .cmd, and a checkout with
# unusual git settings may hand us one. Normalise what the player double-clicks.
foreach ($textFile in @('Play Zombie Farm.cmd', 'HOW TO PLAY.txt')) {
    $path = Join-Path $root $textFile
    $text = [IO.File]::ReadAllText($path) -replace "`r`n", "`n" -replace "`n", "`r`n"
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
Write-Host 'Zipping (this takes a minute - it is ~90 MB of art)...' -ForegroundColor Cyan
# Entries are added by hand because on .NET Framework both Compress-Archive and
# ZipFile.CreateFromDirectory write BACKSLASH separators, which the zip format
# doesn't specify and some extractors turn into one long filename. Players are on
# Windows, where that happens to work, but a mod package gets passed around.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$prefix = $staging.TrimEnd('\').Length + 1
$archive = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
    foreach ($file in Get-ChildItem -LiteralPath $staging -Recurse -File) {
        $entryName = $file.FullName.Substring($prefix).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $file.FullName, $entryName,
            [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue

$size = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 1)
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
Write-Host ''
Write-Host "Done: $zipPath ($size MB)" -ForegroundColor Green
Write-Host "SHA256: $hash"
