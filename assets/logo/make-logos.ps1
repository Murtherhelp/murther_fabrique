<#
.SYNOPSIS
  Rasterise the MURTHER FABRIQUE logo and pack a Windows .ico.

.DESCRIPTION
  The SVG in this folder is the source of truth; this script is the printer.
  Nothing here invents pixels: the same geometry the SVG draws (64-unit grid,
  14-unit corner radius, 8-unit stroke) is replayed with System.Drawing, so the
  .ico the .exe embeds and the mark the web app shows are the same drawing.

  System.Drawing is used because it is already on every Windows machine, gives
  a real alpha channel (an icon needs one) and draws anti-aliased geometry. A
  browser screenshot was the other candidate and it is not available headless
  here; a dependency for eight shapes would be worse than either.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File assets\logo\make-logos.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# Windows scales an .ico out of these; anything else is stored but never picked.
$icoSizes = 16, 24, 32, 48, 64, 128, 256
$pngSizes = 16, 24, 32, 48, 64, 128, 180, 256, 512

$inkTop    = [System.Drawing.Color]::FromArgb(255, 0x18, 0x21, 0x42)
$inkBottom = [System.Drawing.Color]::FromArgb(255, 0x08, 0x0B, 0x18)
$edge      = [System.Drawing.Color]::FromArgb(140, 0x39, 0x45, 0x6F)
$accent    = [System.Drawing.Color]::FromArgb(255, 0xFF, 0x7A, 0x1A)

function New-MarkBitmap {
    param([int]$Size)

    $bmp = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $s = $Size / 64.0
    # 64-unit design grid -> pixels. Everything below is in grid units.
    function S([double]$v) { [single]($v * $s) }
    function P([double]$x, [double]$y) { [System.Drawing.PointF]::new((S $x), (S $y)) }

    try {
        $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.Clear([System.Drawing.Color]::Transparent)

        # Plate: a rounded rectangle filled top to bottom.
        $d = S 28            # corner arc diameter
        $plate = [System.Drawing.Drawing2D.GraphicsPath]::new()
        $plate.AddArc((S 0), (S 0), $d, $d, 180, 90)
        $plate.AddArc((S 64) - $d, (S 0), $d, $d, 270, 90)
        $plate.AddArc((S 64) - $d, (S 64) - $d, $d, $d, 0, 90)
        $plate.AddArc((S 0), (S 64) - $d, $d, $d, 90, 90)
        $plate.CloseFigure()

        $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new((P 0 0), (P 0 64), $inkTop, $inkBottom)
        $g.FillPath($brush, $plate)
        $brush.Dispose()

        # No bevel outline. An inset stroke inside a dark plate reads as a second,
        # clumsier rounded rectangle rather than as depth; the gradient carries it.

        $m = [System.Drawing.Drawing2D.GraphicsPath]::new()

        # The M: one polyline, miter joins, flat caps. Flat caps are deliberate —
        # a round cap eats a third of the stroke at 16 px and the letter closes up.
        # MiterLimit 2 is the load-bearing number: the two top corners need a
        # miter ratio of ~2.6, so they get cut flat, while the centre notch needs
        # only 1.41 and stays sharp. That is the difference between an M and an
        # industrial-looking M, for one integer.
        #
        # Two sizes, not one drawing. Below 32 px an M drawn at full fidelity is a
        # 8 px letter with a 2 px stroke and no counters — it renders as an orange
        # smudge. The small variant is the same letter, heavier and wider, which
        # is how every real icon family is drawn.
        if ($Size -le 24) {
            $m.AddLines([System.Drawing.PointF[]]@((P 13 47), (P 13 25), (P 32 39), (P 51 25), (P 51 47)))
            $mw = 11
        } else {
            $m.AddLines([System.Drawing.PointF[]]@((P 16 47), (P 16 23), (P 32 39), (P 48 23), (P 48 47)))
            $mw = 8
        }
        $penM = [System.Drawing.Pen]::new($accent, [single]($s * $mw))
        $penM.LineJoin   = [System.Drawing.Drawing2D.LineJoin]::Miter
        $penM.StartCap   = [System.Drawing.Drawing2D.LineCap]::Flat
        $penM.EndCap     = [System.Drawing.Drawing2D.LineCap]::Flat
        $penM.MiterLimit = 2
        $g.DrawPath($penM, $m)
        $penM.Dispose()
        $m.Dispose()
        $plate.Dispose()
        return $bmp
    } catch {
        $g.Dispose(); $bmp.Dispose(); throw
    }
}

function Save-Mark {
    param([int]$Size)
    $bmp = New-MarkBitmap -Size $Size
    try {
        $out = Join-Path $here "mark-$Size.png"
        $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
        return $out
    } finally { $bmp.Dispose() }
}

function Save-Lockup {
    param([int]$Width)
    # The lockup viewBox is 720x180; the mark occupies the left 136 units.
    $height = [int][math]::Round($Width * 180 / 720)
    $bmp = [System.Drawing.Bitmap]::new($Width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $s = $Width / 720.0
    function S([double]$v) { [single]($v * $s) }
    function P([double]$x, [double]$y) { [System.Drawing.PointF]::new((S $x), (S $y)) }
    try {
        $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $g.Clear([System.Drawing.Color]::Transparent)

        $markSize = [int][math]::Round(128 * $s)
        $mark = New-MarkBitmap -Size $markSize
        try { $g.DrawImage($mark, [int](8 * $s), [int](26 * $s), $markSize, $markSize) }
        finally { $mark.Dispose() }

        $font = [System.Drawing.Font]::new('Segoe UI', (S 54),
            [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $ink = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 0x0B, 0x10, 0x20))
        try {
            $g.DrawString('MURTHER',  $font, $ink, (P 166 30))
            $g.DrawString('FABRIQUE', $font, $ink, (P 166 78))
        } finally { $ink.Dispose(); $font.Dispose() }

        $bar = [System.Drawing.SolidBrush]::new($accent)
        try {
            $g.FillRectangle($bar, (S 168), (S 146), (S 296), [single][math]::Max(2, $s * 6))
        } finally { $bar.Dispose() }

        $out = Join-Path $here "logo-$Width.png"
        $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
        return $out
    } finally { $g.Dispose(); $bmp.Dispose() }
}

function Save-Ico {
    param([int[]]$Sizes)
    # ICONDIR + one ICONDIRENTRY per image + the raw PNG payloads.
    # PNG-compressed entries are valid from Vista on, which is every Windows
    # this application supports.
    $entries = foreach ($s in $Sizes) {
        [pscustomobject]@{ Size = $s; Bytes = [System.IO.File]::ReadAllBytes((Join-Path $here "mark-$s.png")) }
    }

    $ms = [System.IO.MemoryStream]::new()
    $w = [System.IO.BinaryWriter]::new($ms)
    try {
        $w.Write([uint16]0)              # reserved
        $w.Write([uint16]1)              # 1 = icon
        $w.Write([uint16]$entries.Count)
        $offset = 6 + 16 * $entries.Count
        foreach ($e in $entries) {
            $dim = if ($e.Size -ge 256) { [byte]0 } else { [byte]$e.Size }
            $w.Write($dim); $w.Write($dim)
            $w.Write([byte]0)            # palette size
            $w.Write([byte]0)            # reserved
            $w.Write([uint16]1)          # colour planes
            $w.Write([uint16]32)         # bits per pixel
            $w.Write([uint32]$e.Bytes.Length)
            $w.Write([uint32]$offset)
            $offset += $e.Bytes.Length
        }
        foreach ($e in $entries) { $w.Write($e.Bytes) }
        $w.Flush()
        $path = Join-Path $here 'murther-fabrique.ico'
        [System.IO.File]::WriteAllBytes($path, $ms.ToArray())
        return $path
    } finally { $w.Dispose(); $ms.Dispose() }
}

$written = @()
foreach ($s in $pngSizes) { $written += Save-Mark -Size $s }
foreach ($w in 360, 720, 1440) { $written += Save-Lockup -Width $w }
$ico = Save-Ico -Sizes $icoSizes

Write-Output "logo: $($written.Count) PNG + $(Split-Path -Leaf $ico)"
Write-Output ("ico : {0} sizes, {1:N0} bytes" -f $icoSizes.Count, (Get-Item $ico).Length)