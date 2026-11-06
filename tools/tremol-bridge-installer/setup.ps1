#requires -Version 5.1
[CmdletBinding()]
param([string]$ComPort,[string]$DriverDirectory,[switch]$DiagnoseOnly,[switch]$NoShortcuts)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\tremol-bridge'
$dataRoot = Join-Path $env:LOCALAPPDATA 'GastroGarage\Tremol'
try {
    if ($DriverDirectory -and -not $DiagnoseOnly) {
        $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Driver installation requires Administrator PowerShell; no installation performed.' }
        $infs = @(Get-ChildItem -LiteralPath (Resolve-Path -LiteralPath $DriverDirectory).Path -Filter '*.inf' -File)
        if ($infs.Count -eq 0) { throw 'No INF found. Supply the complete manufacturer package with CAT/SYS files.' }
        foreach ($inf in $infs) {
            & "$env:SystemRoot\System32\pnputil.exe" /add-driver $inf.FullName /install
            if ($LASTEXITCODE -eq 3010) { Write-Warning 'Restart required for driver installation.' }
            elseif ($LASTEXITCODE -ne 0) { throw "Driver installation failed: $LASTEXITCODE" }
        }
    }
    $ports = @(Get-CimInstance Win32_PnPEntity -Filter "PNPClass = 'Ports'" | Where-Object { $_.ConfigManagerErrorCode -eq 0 -and $_.Name -match '\(COM\d+\)' } | ForEach-Object {
        [pscustomobject]@{ Port=[regex]::Match($_.Name,'COM\d+').Value; Name=$_.Name; Id=$_.PNPDeviceID }
    })
    $ports | Format-Table -AutoSize | Out-Host
    if ($ComPort) {
        if ($ComPort -notmatch '^COM[1-9][0-9]*$' -or $ComPort -notin @($ports | ForEach-Object {$_.Port})) { throw 'Requested COM port is not connected.' }
        Write-Host "Set $ComPort and the actual device baud rate in ZFPLabServer."
    } else { Write-Warning 'Printer COM port must be selected in ZFPLabServer. No COM1 fallback is assumed.' }
    if ($DiagnoseOnly) { return }
    $files = @('Bridge.ps1','GastroGarage-Tremol.ps1','Inditas.cmd','Kasszateszt.cmd','Eredmeny.cmd','Egyeztetes.cmd','settings.example.json','README.md')
    foreach ($file in $files) { if (-not (Test-Path -LiteralPath (Join-Path $source $file) -PathType Leaf)) { throw "Missing package file: $file" } }
    $settings = Join-Path $dataRoot 'settings.json'
    if (Test-Path -LiteralPath $settings) {
        $config = Get-Content -LiteralPath $settings -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($config.mode -notin @('preview','live')) { throw 'Invalid existing settings; left unchanged.' }
    }
    [void][IO.Directory]::CreateDirectory($dataRoot)
    $target = Join-Path $dataRoot 'program'
    $stage = Join-Path $dataRoot ('stage-'+[guid]::NewGuid().ToString('N'))
    $backup = Join-Path $dataRoot ('program-backup-'+[guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($stage)
    $moved = $false
    try {
        foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $source $file) -Destination $stage }
        if (-not (Test-Path -LiteralPath $settings)) {
            $config = Get-Content -LiteralPath (Join-Path $stage 'settings.example.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            [IO.File]::WriteAllText($settings, ($config | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
        }
        if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $backup; $moved=$true }
        Move-Item -LiteralPath $stage -Destination $target
    } catch {
        if ($moved -and -not (Test-Path -LiteralPath $target)) { Move-Item -LiteralPath $backup -Destination $target }
        throw
    } finally {
        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    }
    # Connection metadata is deliberately separate: the bridge uses ZFPLabServer, not this COM field.
    $metadata = @{selectedComPort=$ComPort; hardwareVerified=$false; note='Configure the official RO ZFPLabServer separately.'}
    [IO.File]::WriteAllText((Join-Path $dataRoot 'installation.json'),($metadata | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    if (-not $NoShortcuts) {
        $shell = New-Object -ComObject WScript.Shell
        foreach ($item in @(@('Gastro Garage - Tremol','Inditas.cmd'),@('Gastro Garage - Kasszateszt','Kasszateszt.cmd'),@('Gastro Garage - Kasszaeredmeny','Eredmeny.cmd'))) {
            $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) ($item[0]+'.lnk')))
            $shortcut.TargetPath=Join-Path $target $item[1]; $shortcut.WorkingDirectory=$target; $shortcut.Save()
        }
    }
    Write-Host "Installed: $target" -ForegroundColor Green
    Write-Host 'Settings/journal preserved. Hardware NOT verified. Configure ZFPLabServer, then run Kasszateszt.cmd.'
    Write-Host 'No receipt printed. No service, firewall rule or cloud polling enabled.'
} catch { Write-Error $_; exit 1 }
