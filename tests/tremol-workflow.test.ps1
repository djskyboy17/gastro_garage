$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../tools/tremol-bridge/Bridge.ps1"
$root = Join-Path ([IO.Path]::GetTempPath()) ('gastro-fiscal-test-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$journal = Join-Path $root 'journal'
$path = Join-Path $root 'receipt.gastrobon'
$today = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::Now, 'GTB Standard Time').ToString('yyyy-MM-dd')
$job = @{version=2;jobId=[guid]::NewGuid().ToString();orderId='recurring:demo:2026-11-05';token=('a'*64);deviceSerial='S25DEMO';day=$today;expiresAt=[DateTimeOffset]::UtcNow.AddMinutes(5).ToString('o');method='cash';totalBani=2000;lines=@(@{productId='soup';name='Supa';unitBani=2000;quantity=1})}
$config = '{"mode":"live","deviceSerial":"S25DEMO","operatorNumber":1,"operatorPassword":"1234","cash":{"slot":0,"name":"NUMERAR"},"card":{"slot":2,"name":"CARD"},"vatByProduct":{"soup":{"class":"A","rate":0}},"deliveryVat":null}' | ConvertFrom-Json
$state = @{count=10;open=$false;lost=$false;opens=0}
$command = {
 param($name,$arguments)
 switch ($name) {
  ReadSerialNum { @{Serial='S25DEMO'} }
  ReadVATrates { @{VATrateA='0.00%'} }
  ReadPayments { @{NamePaym0='NUMERAR';NamePaym2='CARD'} }
  ReadDateTime { @{DateTime=[datetime]::Parse($today).ToString('dd-MM-yyyy')+' 12:00:00'} }
  ReadStatus { @{Opened_Fiscal_Receipt=[string][int]$state.open;Opened_Non_fiscal_Receipt='0';FM_fiscalized='1';Decimal_point='1';Printer_not_ready_or_no_paper='0'} }
  ReadLastAndTotalReceiptNum { @{TotalReceiptCounter=[string]$state.count;LastReceiptNum=$state.count.ToString('D4')} }
  OpenReceipt { $state.open=$true; $state.opens++; @{} }
  SellPLUwithSpecifiedVAT { @{} }
  Subtotal { @{SubtotalValue='20.00'} }
  PayExactSum { if ($arguments.OptionPaymentType -ne 0) {throw 'Wrong payment'}; @{} }
  CloseReceipt { $state.open=$false; $state.count++; if ($state.lost) {throw 'Lost acknowledgement'}; @{} }
  default { throw "Unexpected: $name" }
 }
}
function Fail($action,$message) { try { & $action; throw 'Expected failure' } catch { if ($_.Exception.Message -notlike "*$message*") { throw } } }
try {
 $job | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $path -Encoding UTF8
 $receipt=Invoke-Receipt $path $config $journal $command {$true}
 $result=Read-JsonFile ($path+'.gastroresult') 8192
 if ($result.status -ne 'issued' -or $result.jobId -ne $job.jobId -or $result.receiptCounter -ne 11 -or $result.token -ne $job.token) {throw 'Missing app result'}
 Fail {Invoke-Receipt $path $config $journal $command {$true}} 'mar keszult'
 $job.orderId='demo-lost'; $job.jobId=[guid]::NewGuid().ToString(); $path=Join-Path $root 'lost.gastrobon'
 $job | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $path -Encoding UTF8
 $state.lost=$true
 Fail {Invoke-Receipt $path $config $journal $command {$true}} 'Ne add ki ujra'
 $result=Read-JsonFile ($path+'.gastroresult') 8192
 if ($result.status -ne 'uncertain' -or $result.receiptNumber -ne '') {throw 'False success after lost acknowledgement'}
 $proof=@{version=2;jobId=$job.jobId;orderId=$job.orderId;token=$job.token;deviceSerial='S25DEMO';state='issued';receiptNumber='0012';receiptCounter=12;resolution='Demo electronic journal checked';completedAt=[DateTimeOffset]::UtcNow.ToString('o')}
 $proofPath=Join-Path $root 'checked.gastroresolution';$proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding UTF8
 Apply-BridgeResolution $proofPath $journal
 $pending=Get-ChildItem -LiteralPath $journal -Filter '*.pending.json' | Where-Object { (Read-JsonFile $_.FullName 8192).orderId -eq 'demo-lost' }
 $confirmed=Read-JsonFile ($pending.FullName+'.issued') 8192
 if ($confirmed.receiptNumber -ne '0012') {throw 'Local resolution failed'}
 $proof.state='not_issued';$proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding UTF8
 Fail {Apply-BridgeResolution $proofPath $journal} 'ervenyes lehet'
 if ($state.opens -ne 2) {throw 'Unexpected extra issue'}
 $oldId=[guid]::NewGuid().ToString()
 $old=@{version=2;jobId=$oldId;orderId='not-issued-demo';paymentId=$oldId;token=('b'*64);deviceSerial='S25DEMO';state='pending';status='pending';day=$today;totalBani=2000;method='cash';before=12;expiresAt=[DateTimeOffset]::UtcNow.AddMinutes(-2).ToString('o')}
 $oldPath=Join-Path $journal 'order-old.pending.json';Write-ReceiptJournal $oldPath $old
 $proof.jobId=$oldId;$proof.orderId=$old.orderId;$proof.token=$old.token;$proof.state='not_issued'
 $proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding UTF8
 Apply-BridgeResolution $proofPath $journal
 if (!(Test-Path -LiteralPath ($oldPath+'.not-issued'))) {throw 'Unissued resolution missing'}
 $job.orderId=$old.orderId;$job.jobId=[guid]::NewGuid().ToString();$job.token=$old.token;$path=Join-Path $root 'retry.gastrobon';$state.lost=$false
 $job | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $path -Encoding UTF8
 $retry=Invoke-Receipt $path $config $journal $command {$true}
 if ($retry.receiptNumber -ne '0013' -or $state.opens -ne 3) {throw 'Explicit retry after verified non-issue failed'}
 'PASS v2 unpaid-order snapshot, recurrent ID, zero-rate configuration, correlated result, no retry after lost response, local admin resolution'
} finally {
 # Remove only the direct files of this freshly created, named test directory.
 if ([IO.Path]::GetFullPath($root).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()))) {
  if (Test-Path -LiteralPath $journal) { Get-ChildItem -LiteralPath $journal -File | Remove-Item; Remove-Item -LiteralPath $journal }
  Get-ChildItem -LiteralPath $root -File | Remove-Item; Remove-Item -LiteralPath $root
 }
}
