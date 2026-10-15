<#
.SYNOPSIS
  Build the MURTHER FABRIQUE portable Windows executable.

.DESCRIPTION
  Produces ONE self-contained file, dist\MurtherFabrique.exe: no installer, no
  sidecar DLLs, nothing to install, nothing to download after launch.

  Four steps, in order:
    1. node build.mjs          -> dist\generator.html (the single-file app)
    2. fetch the WebView2 SDK  -> desktop\.cache (pinned version, ~10 MB
       downloaded, ~43 MB unpacked)
    3. rc.exe                  -> app.res (icon, version info, the app as RCDATA)
    4. cl.exe                  -> the executable, WebView2LoaderStatic linked in

  Requires the MSVC build tools and the Windows SDK. Load Developer PowerShell,
  or let this script find vcvars64.bat and run the compiler through it.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File desktop\build.ps1
#>
[CmdletBinding()]
param(
    # Skip the WebView2 download when the SDK is already cached.
    [switch]$NoFetch
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$project  = Split-Path -Parent $here
$repo     = Split-Path -Parent $project
$src      = Join-Path $project 'src'
$dist     = Join-Path $project 'dist'
$cache    = Join-Path $here '.cache'
$icon     = Join-Path $repo 'assets\logo\murther-fabrique.ico'
# The archived first generator, carried inside the executable so the launcher can
# open either one without the user installing anything.
$original = Join-Path $repo '01-legacy-generator-ORIGINAL\index.html'

# Pinned, not floating. The launcher compiles against these exact headers and
# links this exact loader, so "latest" would make the build unreproducible.
$wv2Version = '1.0.2903.40'
$wv2Url     = "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$wv2Version"

function Write-Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }

# --------------------------------------------------------------- 1. the app

Write-Step 'building the single-file application'
Push-Location $project
try { & node (Join-Path $project 'build.mjs') } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "build.mjs failed with exit code $LASTEXITCODE" }

$app = Join-Path $dist 'generator.html'
if (-not (Test-Path -LiteralPath $app)) { throw "build.mjs did not produce $app" }
$appBytes = (Get-Item -LiteralPath $app).Length
if (-not (Test-Path -LiteralPath $original)) { throw "the original generator is missing: $original" }
$originalBytes = (Get-Item -LiteralPath $original).Length

# ------------------------------------------------------------ 2. the WebView2 SDK

$sdk = Join-Path $cache "wv2-$wv2Version"
if (-not (Test-Path -LiteralPath (Join-Path $sdk 'build\native\include\WebView2.h'))) {
    if ($NoFetch) { throw "WebView2 SDK missing in $cache and -NoFetch was given" }
    Write-Step "fetching the WebView2 SDK $wv2Version"
    New-Item -ItemType Directory -Force -Path $cache | Out-Null
    $nupkg = Join-Path $cache "webview2.zip"
    Invoke-WebRequest -Uri $wv2Url -OutFile $nupkg -UseBasicParsing -TimeoutSec 300
    if (Test-Path -LiteralPath $sdk) { Remove-Item -LiteralPath $sdk -Recurse -Force }
    Expand-Archive -LiteralPath $nupkg -DestinationPath $sdk -Force
    Remove-Item -LiteralPath $nupkg -Force
}
$include   = Join-Path $sdk 'build\native\include'
$loaderLib = Join-Path $sdk 'build\native\x64\WebView2LoaderStatic.lib'
foreach ($p in @((Join-Path $include 'WebView2.h'), $loaderLib)) {
    if (-not (Test-Path -LiteralPath $p)) { throw "WebView2 SDK is incomplete: $p is missing" }
}

# ------------------------------------------------------------- 3. the tools

function Find-Tool {
    param([string]$Name, [string]$Hint)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $found = Get-ChildItem -Path 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter $Name `
                -Recurse -ErrorAction SilentlyContinue |
             Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending |
             Select-Object -First 1
    if ($found) { return $found.FullName }
    throw "$Name not found. $Hint"
}

$rc = Find-Tool 'rc.exe' 'Install the Windows SDK (Desktop C++ workload).'

# vswhere is Microsoft's own locator for a Visual Studio install and it knows
# about the side-by-side version directories; a path glob does not, and getting
# it wrong fails with "not found" on a machine that plainly has the tools.
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vcvars = $null
if (Test-Path -LiteralPath $vswhere) {
    $found = & $vswhere -latest -products * -find '**\vcvars64.bat'
    # @() because a one-line result is a bare string, and `$string[0]` is a char.
    if ($found) { $vcvars = @($found)[0] }
}
if (-not $vcvars) {
    $found = Get-ChildItem -Path 'C:\Program Files (x86)\Microsoft Visual Studio',
                               'C:\Program Files\Microsoft Visual Studio' `
                            -Filter 'vcvars64.bat' -Recurse -ErrorAction SilentlyContinue |
             Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { $vcvars = $found.FullName }
}
if (-not $vcvars) {
    throw 'vcvars64.bat not found. Install the MSVC build tools: Visual Studio Build Tools with the "Desktop development with C++" workload.'
}

# vcvars64.bat sits at <root>\VC\Auxiliary\Build\vcvars64.bat, so three levels up
# from the file is already <root>\VC -- where the compiler lives.
$msvcRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $vcvars))
$cl = Get-ChildItem -Path (Join-Path $msvcRoot 'Tools') -Filter 'cl.exe' -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'HostX64\\x64' } |
        Sort-Object FullName -Descending | Select-Object -First 1
if (-not $cl) { throw "cl.exe not found under $msvcRoot. The C++ workload looks incomplete." }

Write-Step "toolchain: $($cl.FullName)"

# ------------------------------------------------------------- 4. the resources

Write-Step 'compiling resources (icon, version, embedded application)'
$rcDir  = Join-Path $dist 'rc'
New-Item -ItemType Directory -Force -Path $rcDir | Out-Null

$appEscaped = $app -replace '\\', '/'
$originalEscaped = $original -replace '\\', '/'
$iconEscaped = $icon -replace '\\', '/'
$rcText = @"
// Generated by desktop\build.ps1 -- do not edit.
// windows.h is here for VOS_NT_WINDOWS32 and VFT_APP; rc.exe runs inside the
// vcvars shell precisely so the SDK include path is set.
#include <windows.h>

// These must be numbers, not names: launcher.cpp looks each resource up with
// MAKEINTRESOURCEW. Without the defines, rc.exe stores a resource literally
// called "IDR_APP_NEXT" and FindResource by number never finds it.
#define IDI_APPICON        1
#define IDR_APP_NEXT     100
#define IDR_APP_ORIGINAL 101

IDI_APPICON ICON "$iconEscaped"

VS_VERSION_INFO VERSIONINFO
 FILEVERSION    1,0,0,0
 PRODUCTVERSION 1,0,0,0
 FILEOS         VOS_NT_WINDOWS32
 FILETYPE       VFT_APP
BEGIN
    BLOCK "StringFileInfo"
    BEGIN
        BLOCK "040904b0"
        BEGIN
            VALUE "CompanyName",      "MURTHER FABRIQUE"
            VALUE "FileDescription",  "MURTHER FABRIQUE - visual website generator"
            VALUE "FileVersion",      "1.0.0"
            VALUE "InternalName",     "MurtherFabrique"
            VALUE "OriginalFilename", "MurtherFabrique.exe"
            VALUE "ProductName",      "MURTHER FABRIQUE"
            VALUE "ProductVersion",   "1.0.0"
        END
    END
    BLOCK "VarFileInfo"
    BEGIN
        VALUE "Translation", 0x409, 1200
    END
END

// Both generators, compiled into the executable. The launcher opens one or the
// other; neither costs the user a download.
IDR_APP_NEXT     RCDATA "$appEscaped"
IDR_APP_ORIGINAL RCDATA "$originalEscaped"
"@
$rcFile = Join-Path $rcDir 'app.rc'
[System.IO.File]::WriteAllText($rcFile, $rcText, [System.Text.ASCIIEncoding]::new())

$res = Join-Path $rcDir 'app.res'
# At the repository root, next to both generators: the .exe opens either of them,
# so it belongs beside both rather than buried in one of them.
$exe = Join-Path $repo 'MutherFabrique.exe'

# Remove the old executable before linking, not after.
#
# An antivirus scanner holds a freshly written executable open for a moment. Link
# into that window and the write goes nowhere, while the directory entry from the
# previous build is still there to be measured: Test-Path succeeds, Get-Item
# reports the size of the binary from the last run, and the script prints a
# successful build of a file that was never written. Deleting first turns that
# into an honest failure.
if (Test-Path -LiteralPath $exe) {
    try {
        Remove-Item -LiteralPath $exe -Force -ErrorAction Stop
    } catch {
        throw "the previous executable is held open and cannot be replaced: $($_.Exception.Message)"
    }
}

Write-Step 'compiling the launcher'
# /MT: the C runtime is linked in, so the executable needs nothing installed.
# /guard:cf plus /DYNAMICBASE /NXCOMPAT /CETCOMPAT /HIGHENTROPYVA: the Windows
# exploit mitigations. The first is a compiler flag; the rest belong after /link,
# because handing them to cl.exe directly is silently ignored -- the last thing a
# security flag should be.
#
# rc.exe needs the SDK include paths and cl.exe needs the whole environment, so
# both run inside one vcvars64 shell rather than each being set up by hand.
$cmd = @(
    "`"$($cl.FullName)`"",
    '/nologo', '/O2', '/MT', '/W4', '/permissive-', '/GS', '/guard:cf', '/GL',
    "/I`"$include`"",
    '/DUNICODE', '/D_UNICODE', '/D_WIN32_WINNT=0x0A00', '/DNOMINMAX',
    "`"$here\launcher.cpp`"",
    # Objects land in the scratch folder, not next to the source: a build that
    # leaves launcher.obj in desktop/ teaches everyone to gitignore it instead.
    "/Fo`"$rcDir\\`"",
    "/Fe:`"$exe`"",
    "`"$res`"",
    "`"$loaderLib`"",
    'user32.lib', 'ole32.lib', 'shell32.lib', 'shlwapi.lib', 'gdi32.lib',
    # advapi32: the loader reads the runtime install path from the registry.
    # wevtapi:  the loader emits ETW events for the WebView2 diagnostics channel.
    'advapi32.lib', 'wevtapi.lib',
    '/link', '/DYNAMICBASE', '/NXCOMPAT', '/CETCOMPAT', '/HIGHENTROPYVA'
) -join ' '

$bat = Join-Path $rcDir 'build.bat'
$batText = "`r`n" +
    '@echo off' + "`r`n" +
    'call "' + $vcvars + '" >nul' + "`r`n" +
    'if errorlevel 1 exit /b 1' + "`r`n" +
    'rc /nologo /fo "' + $res + '" /i "' + $rcDir + '" "' + $rcFile + '"' + "`r`n" +
    'if errorlevel 1 exit /b 1' + "`r`n" +
    $cmd + "`r`n"
[System.IO.File]::WriteAllText($bat, $batText, [System.Text.ASCIIEncoding]::new())

& cmd.exe /c "`"$bat`""
if ($LASTEXITCODE -ne 0) { throw "the build failed with exit code $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $exe)) { throw 'the link produced nothing' }

# Open the result. A directory entry can survive a failed write, so existing is
# not evidence: if the file cannot be read back, nothing was linked.
try {
    $stream = [System.IO.File]::OpenRead($exe)
    $linked = $stream.Length
    $stream.Dispose()
} catch {
    throw "the link left an unreadable file: $($_.Exception.Message)"
}

Remove-Item -LiteralPath $rcDir -Recurse -Force -ErrorAction SilentlyContinue

$size = $linked
Write-Host ''
Write-Host ("MURTHER FABRIQUE -> {0}" -f $exe)
Write-Host ("  executable  {0:N0} bytes" -f $size)
Write-Host ("  embedded    {0:N0} bytes of NEXT, {1:N0} bytes of ORIGINAL" -f $appBytes, $originalBytes)
Write-Host '  double-click it to choose a generator. Nothing else is needed beside it.'