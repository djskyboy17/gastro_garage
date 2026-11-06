#requires -Version 5.1
$ErrorActionPreference='Stop'
$zip=Join-Path $PSScriptRoot 'GastroGarage-Tremol-telepito.zip'
$stage=Join-Path $PSScriptRoot ('package-'+[guid]::NewGuid().ToString('N'))
try {
    $installer=Join-Path $stage 'tremol-bridge-installer'
    $bridge=Join-Path $stage 'tremol-bridge'
    [void][IO.Directory]::CreateDirectory($installer)
    [void][IO.Directory]::CreateDirectory($bridge)
    foreach ($file in @('setup.ps1','Telepites.cmd','README.md','SPEC.md')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $installer
    }
    foreach ($file in @('Bridge.ps1','GastroGarage-Tremol.ps1','Inditas.cmd','Kasszateszt.cmd','Eredmeny.cmd','Egyeztetes.cmd','settings.example.json','README.md')) {
        Copy-Item -LiteralPath (Join-Path (Join-Path $PSScriptRoot '..\tremol-bridge') $file) -Destination $bridge
    }
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($zip)
    try {
        if ($archive.Entries.Count -ne 12) { throw 'Unexpected package contents.' }
        if (-not ($archive.Entries.FullName -match 'tremol-bridge[/\\]Bridge.ps1')) { throw 'Bridge missing.' }
    } finally { $archive.Dispose() }
    Write-Host "Verified package: $zip"
} finally {
    if ((Split-Path $stage -Parent) -eq $PSScriptRoot -and (Split-Path $stage -Leaf) -like 'package-*') {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}
