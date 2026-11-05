param([string]$JobPath, [switch]$Check, [switch]$ExportResult, [switch]$ApplyResolution)

. "$PSScriptRoot/Bridge.ps1"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Net.Http
$root = Join-Path $env:LOCALAPPDATA 'GastroGarage/Tremol'
$settingsPath = Join-Path $root 'settings.json'

function Show-Message($Text, $Icon = 'Information') {
    [void][Windows.Forms.MessageBox]::Show($Text, 'Gastro Garage - Tremol', 'OK', $Icon)
}

function Show-Confirmation($Job, $Lines, $PaymentName) {
    $details = @($Lines | ForEach-Object { "$($_.Quantity) $($_.Unit) x $($_.Price) lei - $($_.Name) (TVA $($_.VatRate)%)" }) -join "`n"
    $text = "$details`n`nTotal: $(Format-Lei $Job.totalBani) lei / $PaymentName`n`nEllenorizd a fizetesi modot. A rendeleshez meg nem keszulhetett fiscalis nyugta. A nyugta kiadasa nem rogzit befizetest a programban.`n`nBon fiscal kiadasa?"
    [Windows.Forms.MessageBox]::Show($text, 'Gastro Garage - Tremol', 'YesNo', 'Warning', 'Button2') -eq 'Yes'
}

try {
    [void][IO.Directory]::CreateDirectory($root)
    if ($ApplyResolution) {
        $dialog = [Windows.Forms.OpenFileDialog]::new()
        try {
            $dialog.Filter='Gastro Garage egyeztetes (*.gastroresolution)|*.gastroresolution'
            if ($dialog.ShowDialog() -ne 'OK') { return }
            if ([Windows.Forms.MessageBox]::Show('Ellenorizted a kassza elektronikus naplojat es a programban rogzitett adminisztratori egyeztetest?', 'Kasszaegyeztetes', 'YesNo', 'Warning', 'Button2') -ne 'Yes') { return }
            Apply-BridgeResolution $dialog.FileName (Join-Path $root 'journal')
            Show-Message 'A helyi naplo egyeztetese elmentve. A korabbi fajlokat orizd meg.'
            return
        } finally { $dialog.Dispose() }
    }
    if ($ExportResult) {
        $dialog = [Windows.Forms.OpenFileDialog]::new()
        $save = [Windows.Forms.SaveFileDialog]::new()
        try {
            $dialog.InitialDirectory = Join-Path $root 'journal'
            $dialog.Filter = 'Gastro Garage naplo (*.issued;*.json)|*.issued;*.json'
            if ($dialog.ShowDialog() -ne 'OK') { return }
            $entry = Read-JsonFile $dialog.FileName 8192
            $result = Get-BridgeResult $entry
            $save.Filter = 'Gastro Garage eredmeny (*.gastroresult)|*.gastroresult'
            $save.FileName = $result.jobId + '.gastroresult'
            if ($save.ShowDialog() -ne 'OK') { return }
            Write-BridgeResult $save.FileName $entry
            Show-Message 'Eredmeny exportalva. A rendeles Konyhai kassza reszebe olvasd vissza.'
            return
        } finally { $dialog.Dispose(); $save.Dispose() }
    }
    if (-not (Test-Path -LiteralPath $settingsPath)) { Copy-Item -LiteralPath "$PSScriptRoot/settings.example.json" -Destination $settingsPath }
    $settings = Read-JsonFile $settingsPath 131072
    if ($settings.mode -cnotin @('preview', 'live') -or $settings.zfpPort -isnot [ValueType] -or
        $settings.zfpPort -ne [int]$settings.zfpPort -or $settings.zfpPort -lt 1024 -or $settings.zfpPort -gt 65535) {
        throw "Ervenytelen Tremol beallitas. $settingsPath"
    }
    if (-not $Check) {
        if (-not $JobPath) {
            $dialog = [Windows.Forms.OpenFileDialog]::new()
            try {
                $dialog.Filter = 'Gastro Garage bon fiscal (*.gastrobon)|*.gastrobon'
                $dialog.InitialDirectory = Join-Path $env:USERPROFILE 'Downloads'
                if ($dialog.ShowDialog() -ne 'OK') { return }
                $JobPath = $dialog.FileName
            } finally { $dialog.Dispose() }
        }
        if ($settings.mode -ceq 'preview') {
            $job = Get-Job $JobPath
            $lines = @($job.lines | ForEach-Object { "$($_.quantity) x $(Format-Lei $_.unitBani) lei - $($_.name) (azonosito: $($_.productId))" }) -join "`n"
            Show-Message "Probamod`n`n$lines`n`nTotal: $(Format-Lei $job.totalBani) lei / $($job.method)`n`nBeallitasok: $settingsPath"
            return
        }
    }
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseProxy = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(20)
    $client.MaxResponseContentBufferSize = 65536
    try {
        $command = { param($Name, $Arguments = @{}) Invoke-Zfp $client $settings.zfpPort $Name $Arguments }
        if ($Check) {
            $version = Get-ZfpSingleValue (& $command 'ReadVersion')
            $serial = Get-ZfpSingleValue (& $command 'ReadSerialNum')
            $rates = (& $command 'ReadVATrates').GetEnumerator() | Sort-Object Key | ForEach-Object { "$($_.Key): $($_.Value)" }
            $payments = (& $command 'ReadPayments').GetEnumerator() | Where-Object Key -Like 'NamePaym*' | Sort-Object Key | ForEach-Object { "$($_.Key): $($_.Value)" }
            Show-Message "Kasszakapcsolat OK`n$version`nSorozatszam: $serial`n`n$($rates -join "`n")`n`n$($payments -join "`n")`n`nBeallitasok: $settingsPath"
            return
        }
        $receipt = Invoke-Receipt $JobPath $settings (Join-Path $root 'journal') $command ${function:Show-Confirmation}
        if ($receipt) { Show-Message "Bon fiscal visszaigazolva.`nSorszam: $($receipt.receiptNumber)`nKassza: $($receipt.deviceSerial)`n`nAz eredmenyfajlt olvasd vissza a rendelesbe: $JobPath.gastroresult" }
    } finally { $client.Dispose() }
} catch {
    Show-Message $_.Exception.Message 'Error'
    exit 1
}
