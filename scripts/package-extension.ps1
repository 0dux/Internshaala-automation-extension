$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$extensionDir = Join-Path $root 'chrome-extension'
$manifestPath = Join-Path $extensionDir 'manifest.json'
$distDir = Join-Path $root 'dist'

if (-not (Test-Path $manifestPath)) {
  throw 'chrome-extension/manifest.json is missing.'
}

$manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
$zipPath = Join-Path $distDir "internshala-saved-filters-$($manifest.version).zip"

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipStream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
$archive = New-Object System.IO.Compression.ZipArchive(
  $zipStream,
  [System.IO.Compression.ZipArchiveMode]::Create
)

try {
  $files = Get-ChildItem -LiteralPath $extensionDir -Recurse -File
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($extensionDir.Length).TrimStart('\', '/')
    $entryName = $relative -replace '\\', '/'

    $entry = $archive.CreateEntry(
      $entryName,
      [System.IO.Compression.CompressionLevel]::Optimal
    )
    $entryStream = $entry.Open()
    $fileStream = [System.IO.File]::OpenRead($file.FullName)

    try {
      $fileStream.CopyTo($entryStream)
    } finally {
      $fileStream.Dispose()
      $entryStream.Dispose()
    }
  }
} finally {
  $archive.Dispose()
  $zipStream.Dispose()
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entryNames = $archive.Entries | ForEach-Object { $_.FullName }
} finally {
  $archive.Dispose()
}

if ($entryNames -notcontains 'manifest.json') {
  throw 'The zip does not contain manifest.json at its root.'
}

if ($entryNames -notcontains 'content.js') {
  throw 'The zip does not contain content.js.'
}

$unexpected = $entryNames | Where-Object {
  $_ -notmatch '^(manifest\.json|content\.js|popup\.html|popup\.css|icons/icon(16|32|48|128)\.png)$'
}

if ($unexpected) {
  throw "Unexpected files in the package: $($unexpected -join ', ')"
}

$size = (Get-Item $zipPath).Length
Write-Host "Created $zipPath ($size bytes)."
Write-Host "Entries: $($entryNames -join ', ')"
