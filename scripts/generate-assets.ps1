$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$iconDir = Join-Path $root 'chrome-extension\icons'
$storeDir = Join-Path $root 'store'
$previewPath = Join-Path $root 'preview.png'

New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
New-Item -ItemType Directory -Force -Path $storeDir | Out-Null

function New-RoundedPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2

  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()

  return $path
}

function Set-HighQuality {
  param([System.Drawing.Graphics]$Graphics)

  $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
}

# ---------------------------------------------------------------------------
# Master icon: 1024 x 1024, downscaled to the sizes Chrome needs.
# ---------------------------------------------------------------------------

$master = New-Object System.Drawing.Bitmap 1024, 1024, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($master)
Set-HighQuality -Graphics $g
$g.Clear([System.Drawing.Color]::Transparent)

$bgPath = New-RoundedPath -X 24 -Y 24 -Width 976 -Height 976 -Radius 220
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point 512, 24),
  (New-Object System.Drawing.Point 512, 1000),
  ([System.Drawing.Color]::FromArgb(255, 14, 138, 201)),
  ([System.Drawing.Color]::FromArgb(255, 7, 95, 146))
)
$g.FillPath($bgBrush, $bgPath)

$bookmark = New-Object System.Drawing.Drawing2D.GraphicsPath
$bookmark.AddArc(304, 224, 64, 64, 180, 90)
$bookmark.AddArc(656, 224, 64, 64, 270, 90)
$bookmark.AddLine(720, 256, 720, 800)
$bookmark.AddLine(720, 800, 512, 700)
$bookmark.AddLine(512, 700, 304, 800)
$bookmark.AddLine(304, 800, 304, 256)
$bookmark.CloseFigure()

$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillPath($white, $bookmark)

$white.Dispose()
$bookmark.Dispose()
$bgBrush.Dispose()
$bgPath.Dispose()
$g.Dispose()

foreach ($size in 16, 32, 48, 128) {
  $image = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $ig = [System.Drawing.Graphics]::FromImage($image)
  Set-HighQuality -Graphics $ig
  $ig.Clear([System.Drawing.Color]::Transparent)
  $ig.DrawImage($master, 0, 0, $size, $size)
  $ig.Dispose()

  $destination = Join-Path $iconDir "icon$size.png"
  $image.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
  $image.Dispose()
}

Copy-Item (Join-Path $iconDir 'icon128.png') (Join-Path $storeDir 'icon-128.png') -Force
$master.Dispose()

# ---------------------------------------------------------------------------
# Chrome Web Store screenshot: 1280 x 800 with the 1120 x 728 preview framed.
# ---------------------------------------------------------------------------

if (Test-Path $previewPath) {
  $screenshot = New-Object System.Drawing.Bitmap 1280, 800, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $sg = [System.Drawing.Graphics]::FromImage($screenshot)
  Set-HighQuality -Graphics $sg

  $background = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point 0, 0),
    (New-Object System.Drawing.Point 1280, 800),
    ([System.Drawing.Color]::FromArgb(255, 246, 251, 254)),
    ([System.Drawing.Color]::FromArgb(255, 231, 244, 251))
  )
  $sg.FillRectangle($background, 0, 0, 1280, 800)

  $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(22, 7, 45, 68))
  $shadowPath = New-RoundedPath -X 68 -Y 28 -Width 1144 -Height 752 -Radius 18
  $sg.FillPath($shadow, $shadowPath)
  $shadowPath.Dispose()

  $card = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $cardPath = New-RoundedPath -X 64 -Y 22 -Width 1152 -Height 756 -Radius 18
  $sg.FillPath($card, $cardPath)
  $cardPath.Dispose()

  $preview = [System.Drawing.Image]::FromFile($previewPath)
  $sg.DrawImage($preview, 80, 36, 1120, 728)
  $preview.Dispose()

  $border = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 214, 232, 242), 1)
  $sg.DrawRectangle($border, 80, 36, 1119, 727)

  $border.Dispose()
  $card.Dispose()
  $shadow.Dispose()
  $background.Dispose()
  $sg.Dispose()

  $screenshot.Save((Join-Path $storeDir 'screenshot-1280x800.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $screenshot.Dispose()
}

# ---------------------------------------------------------------------------
# Optional Chrome Web Store promo tile: 440 x 280.
# ---------------------------------------------------------------------------

$promo = New-Object System.Drawing.Bitmap 440, 280, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$pg = [System.Drawing.Graphics]::FromImage($promo)
Set-HighQuality -Graphics $pg

$promoBackground = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point 0, 0),
  (New-Object System.Drawing.Point 440, 280),
  ([System.Drawing.Color]::FromArgb(255, 11, 120, 181)),
  ([System.Drawing.Color]::FromArgb(255, 6, 78, 120))
)
$pg.FillRectangle($promoBackground, 0, 0, 440, 280)

$tilePath = New-RoundedPath -X 28 -Y 28 -Width 96 -Height 96 -Radius 22
$tileBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$pg.FillPath($tileBrush, $tilePath)
$tilePath.Dispose()
$tileBrush.Dispose()

$icon = [System.Drawing.Image]::FromFile((Join-Path $iconDir 'icon128.png'))
$pg.DrawImage($icon, 40, 40, 72, 72)
$icon.Dispose()

$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$softBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 207, 233, 248))
$faintBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 255, 255, 255))

$titleFont = New-Object System.Drawing.Font('Segoe UI', 34, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel))
$subtitleFont = New-Object System.Drawing.Font('Segoe UI', 16, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel))
$bodyFont = New-Object System.Drawing.Font('Segoe UI', 13.5, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel))
$fineFont = New-Object System.Drawing.Font('Segoe UI', 10.5, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel))

$pg.DrawString('Saved Filters', $titleFont, $whiteBrush, 144, 42)
$pg.DrawString('for Internshala', $subtitleFont, $softBrush, 146, 86)

$rule = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 255, 255, 255), 1)
$pg.DrawLine($rule, 146, 128, 404, 128)

$pg.DrawString('Save searches. Rename them.', $bodyFont, $whiteBrush, 146, 144)
$pg.DrawString('Reopen in one click.', $bodyFont, $whiteBrush, 146, 166)
$pg.DrawString('Unofficial helper', $fineFont, $faintBrush, 146, 226)

$rule.Dispose()
$titleFont.Dispose()
$subtitleFont.Dispose()
$bodyFont.Dispose()
$fineFont.Dispose()
$whiteBrush.Dispose()
$softBrush.Dispose()
$faintBrush.Dispose()
$promoBackground.Dispose()
$pg.Dispose()

$promo.Save((Join-Path $storeDir 'promo-tile-440x280.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$promo.Dispose()

Write-Host 'Generated extension icons and store images.'
