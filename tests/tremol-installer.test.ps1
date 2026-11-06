$ErrorActionPreference='Stop'
$original=$env:LOCALAPPDATA
$temp=Join-Path $PSScriptRoot ('tremol-installer-test-'+[guid]::NewGuid().ToString('N'))
function Get-CimInstance { param($ClassName,$Filter) @() }
try {
    $env:LOCALAPPDATA=$temp
    $script=Join-Path $PSScriptRoot '../tools/tremol-bridge-installer/setup.ps1'
    & $script -DiagnoseOnly
    if (Test-Path $temp) { throw 'Diagnostics wrote files.' }
    & $script -NoShortcuts
    $root=Join-Path $temp 'GastroGarage/Tremol'
    $settings=Join-Path $root 'settings.json'
    $bytes=[IO.File]::ReadAllBytes($settings)
    if ($bytes[0] -eq 239) { throw 'Unexpected BOM.' }
    if ((Get-Content $settings -Raw | ConvertFrom-Json).mode -ne 'preview') { throw 'Not preview.' }
    $journal=Join-Path $root 'journal'
    [void][IO.Directory]::CreateDirectory($journal)
    [IO.File]::WriteAllText((Join-Path $journal 'receipt.json'),'keep-me')
    [IO.File]::WriteAllText($settings,'{"mode":"live","custom":"keep-me"}',[Text.UTF8Encoding]::new($false))
    & $script -NoShortcuts
    if ([IO.File]::ReadAllText($settings) -cne '{"mode":"live","custom":"keep-me"}') { throw 'Settings changed.' }
    if ([IO.File]::ReadAllText((Join-Path $journal 'receipt.json')) -cne 'keep-me') { throw 'Journal changed.' }
    if (@(Get-ChildItem $root -Directory -Filter 'program-backup-*').Count -ne 1) { throw 'Upgrade backup missing.' }
    function Get-CimInstance { param($ClassName,$Filter) [pscustomobject]@{Name='USB Serial (COM3)';PNPDeviceID='DEMO';ConfigManagerErrorCode=0} }
    & $script -ComPort COM3 -NoShortcuts
    if ((Get-Content (Join-Path $root 'installation.json') -Raw | ConvertFrom-Json).selectedComPort -ne 'COM3') { throw 'Port selection failed.' }
    Write-Host 'PASS: diagnostics, disconnected installation, preview, UTF8, upgrade preservation, backup and explicit port.'
} finally {
    $env:LOCALAPPDATA=$original
    if ((Split-Path $temp -Leaf) -like 'tremol-installer-test-*') { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
}
