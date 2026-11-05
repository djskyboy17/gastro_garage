$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:LOCALAPPDATA 'GastroGarage/Tremol/program'
[void][IO.Directory]::CreateDirectory($destination)
foreach ($file in @('Bridge.ps1', 'GastroGarage-Tremol.ps1', 'Inditas.cmd', 'Kasszateszt.cmd', 'Eredmeny.cmd', 'Egyeztetes.cmd', 'settings.example.json', 'README.md')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $destination $file)
}
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
foreach ($item in @(@('Gastro Garage - Tremol', 'Inditas.cmd'), @('Gastro Garage - Kasszateszt', 'Kasszateszt.cmd'), @('Gastro Garage - Kasszaeredmeny', 'Eredmeny.cmd'))) {
    $shortcut = $shell.CreateShortcut((Join-Path $desktop ($item[0] + '.lnk')))
    $shortcut.TargetPath = Join-Path $destination $item[1]
    $shortcut.WorkingDirectory = $destination
    $shortcut.Save()
}
Write-Host 'Telepites kesz. A Gastro Garage - Tremol es a Kasszateszt parancsikon az Asztalon van.'
