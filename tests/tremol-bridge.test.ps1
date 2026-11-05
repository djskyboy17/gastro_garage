$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../tools/tremol-bridge/Bridge.ps1"
$root = Join-Path ([IO.Path]::GetTempPath()) ('tremol-test-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$path = Join-Path $root 'demo.gastrobon'
$today = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::Now, 'GTB Standard Time').ToString('yyyy-MM-dd')
$job = @{version=1;orderId='demo-a';paymentId='35cc4042-eec8-45e8-a87e-f8042d72ad72';day=$today;expiresAt=[DateTimeOffset]::UtcNow.AddMinutes(5).ToString('o');method='card';totalBani=4035;lines=@(@{productId='supa';name='Supa';unitBani=2015;quantity=1},@{productId=$null;name='Livrare';unitBani=2020;quantity=1})}
$config = '{"mode":"live","deviceSerial":"S2500001","operatorNumber":1,"operatorPassword":"1234","cash":{"slot":0,"name":"NUMERAR"},"card":{"slot":2,"name":"CARD"},"vatByProduct":{"supa":{"class":"B","rate":11}},"deliveryVat":{"class":"A","rate":21}}' | ConvertFrom-Json
$journal = Join-Path $root 'journal'
$state = @{ calls=[Collections.Generic.List[string]]::new(); counter=10; open=$false; loseClose=$false; subtotal='40.35'; day=[datetime]::Parse($today).ToString('dd-MM-yyyy') + ' 10:00:00' }
$command = {
    param($name,$args1)
    $state.calls.Add($name)
    switch ($name) {
        ReadSerialNum { @{Serial='S2500001'} }
        ReadVATrates { @{VATrateA='21.00%';VATrateB='11.00%'} }
        ReadPayments { @{NamePaym0='NUMERAR';NamePaym2='CARD'} }
        ReadDateTime { @{DateTime=$state.day} }
        ReadStatus { @{Opened_Fiscal_Receipt=[string][int]$state.open;Opened_Non_fiscal_Receipt='0';FM_fiscalized='1';Decimal_point='1';Printer_not_ready_or_no_paper='0'} }
        ReadLastAndTotalReceiptNum { @{TotalReceiptCounter=[string]$state.counter;LastReceiptNum=$state.counter.ToString('D4')} }
        OpenReceipt { $state.open=$true; @{} }
        SellPLUwithSpecifiedVAT {
            if ($args1.NamePLU.Length -ne 36) { throw 'Unit formatting failed.' }
            if ($args1.OptionVATClass -cnotin @('A','B')) { throw 'VAT failed.' }
            @{}
        }
        Subtotal { @{SubtotalValue=$state.subtotal} }
        PayExactSum {
            if ($args1.OptionPaymentType -ne 2) { throw 'Wrong payment slot.' }
            @{}
        }
        CloseReceipt { $state.open=$false; $state.counter++; if ($state.loseClose) { throw 'Connection lost after close.' }; @{} }
        default { throw "Unexpected command: $name" }
    }
}
function Save-Job { $job | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding UTF8 }
function Assert-Fails($Work,$Expected) {
    try { & $Work; throw 'Expected failure was missing.' } catch {
        if ($_.Exception.Message -notlike "*$Expected*") { throw }
    }
}
Save-Job
$no = Invoke-Receipt $path $config $journal $command { $false }
if ($no -or $state.calls.Contains('OpenReceipt')) { throw 'Cancel must avoid printing.' }
$config.mode = 'preview'
Assert-Fails { Invoke-Receipt $path $config $journal $command { $true } } 'live modban'
$config.mode = 'live'
$receipt = Invoke-Receipt $path $config $journal $command { $true }
if ($receipt.receiptNumber -ne '0011' -or $receipt.status -ne 'issued') { throw 'Issue not logged.' }
Assert-Fails { Invoke-Receipt $path $config $journal $command { $true } } 'mar keszult'
$job.orderId = 'demo-b'
Save-Job
$state.loseClose = $true
Assert-Fails { Invoke-Receipt $path $config $journal $command { $true } } 'Ne add ki ujra'
$job.orderId = 'demo-c'
Save-Job
Assert-Fails { Invoke-Receipt $path $config $journal $command { $true } } 'Fuggo kiadas'
$job.expiresAt = [DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o')
Save-Job
Assert-Fails { Get-Job $path } 'lejart'
if (@($state.calls | Where-Object { $_ -eq 'OpenReceipt' }).Count -ne 2) { throw 'Double issue.' }
Get-ChildItem -LiteralPath $root -File | Remove-Item
Get-ChildItem -LiteralPath $journal -File | Remove-Item
Remove-Item -LiteralPath $journal,$root
'PASS confirmed receipt, abort, preview, duplicate guard, lost acknowledgement and stale file on Windows PowerShell'
