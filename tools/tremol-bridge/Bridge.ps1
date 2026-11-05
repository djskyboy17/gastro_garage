Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$invariant = [Globalization.CultureInfo]::InvariantCulture

function Read-JsonFile($Path, $MaxBytes) {
    $file = Get-Item -LiteralPath $Path
    if ($file.Length -gt $MaxBytes) { throw 'A fajl tul nagy.' }
    Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Format-Lei([long]$Bani) {
    ([decimal]$Bani / 100).ToString('0.00', $invariant)
}

function Read-Decimal([string]$Value) {
    if ($Value -notmatch '^\d{1,9}(\.\d{1,2})?$') { throw 'A kasza ervenytelen szamot adott vissza.' }
    [decimal]::Parse($Value, $invariant)
}

function Assert-JobCurrent($Job) {
    $today = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::Now, 'GTB Standard Time').ToString('yyyy-MM-dd', $invariant)
    $expires = [DateTimeOffset]::Parse($Job.expiresAt, $invariant)
    if ($Job.day -cne $today -or $expires -le [DateTimeOffset]::UtcNow -or $expires -gt [DateTimeOffset]::UtcNow.AddMinutes(11)) {
        throw 'A nyugtafajl lejart. Tolts le friss fajlt a Gastro Garage rendelesebol.'
    }
}

function Get-Job($Path) {
    $job = Read-JsonFile $Path 32768
    if ($job.version -notin @(1,2) -or $job.orderId -isnot [string] -or $job.orderId -notmatch '^[a-zA-Z0-9_:@.-]{1,200}$' -or
        $job.method -cnotin @('cash', 'card') -or
        $job.lines -isnot [array] -or $job.lines.Count -lt 1 -or $job.lines.Count -gt 50 -or
        $job.totalBani -isnot [ValueType] -or $job.totalBani -ne [long]$job.totalBani -or $job.totalBani -lt 1 -or $job.totalBani -gt 100000000) {
        throw 'Ervenytelen Gastro Garage nyugtafajl.'
    }
    if ($job.version -eq 1) {
        if ($job.paymentId -notmatch '^[a-f0-9-]{36}$') { throw 'Ervenytelen fizetesazonosito.' }
    } elseif ($job.jobId -notmatch '^[a-f0-9-]{36}$' -or $job.token -notmatch '^[a-f0-9]{64}$' -or $job.deviceSerial -notmatch '^[a-zA-Z0-9]{4,20}$') {
        throw 'Ervenytelen nyomtatasazonosito vagy kassza.'
    }
    Assert-JobCurrent $job
    [long]$total = 0
    foreach ($line in $job.lines) {
        if (($null -ne $line.productId -and ($line.productId -isnot [string] -or $line.productId -notmatch '^[a-zA-Z0-9_:@.-]{1,200}$')) -or
            $line.name -isnot [string] -or [string]::IsNullOrWhiteSpace($line.name) -or $line.name.Length -gt 200 -or
            $line.unitBani -isnot [ValueType] -or $line.unitBani -ne [long]$line.unitBani -or $line.unitBani -lt 1 -or $line.unitBani -gt 100000000 -or
            $line.quantity -isnot [ValueType] -or $line.quantity -ne [long]$line.quantity -or $line.quantity -lt 1 -or $line.quantity -gt 9999) {
            throw 'Ervenytelen tetel a nyugtafajlban.'
        }
        $total += [long]$line.unitBani * [long]$line.quantity
    }
    if ($total -ne $job.totalBani) { throw 'A tetelsorok osszege nem egyezik a fizetessel.' }
    $job
}

function Invoke-Zfp($Client, [int]$Port, [string]$Name, [hashtable]$Arguments = @{}) {
    $request = [xml]'<Command><Args/></Command>'
    $request.DocumentElement.SetAttribute('Name', $Name)
    if (!$Arguments.Count) { [void]$request.DocumentElement.RemoveChild($request.DocumentElement.FirstChild) }
    foreach ($key in $Arguments.Keys) {
        $argument = $request.CreateElement('Arg')
        $argument.SetAttribute('Name', $key)
        $argument.SetAttribute('Value', [string]$Arguments[$key])
        [void]$request.DocumentElement.FirstChild.AppendChild($argument)
    }
    $content = [Net.Http.StringContent]::new($request.OuterXml, [Text.Encoding]::UTF8, 'text/plain')
    try {
        $response = $Client.PostAsync("http://127.0.0.1:$Port/", $content).GetAwaiter().GetResult()
        try {
            if (-not $response.IsSuccessStatusCode) { throw "ZFPLab HTTP $([int]$response.StatusCode)" }
            $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        } finally { $response.Dispose() }
    } finally { $content.Dispose() }
    $xmlSettings = [Xml.XmlReaderSettings]::new()
    $xmlSettings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $xmlSettings.MaxCharactersInDocument = 65536
    $reader = [Xml.XmlReader]::Create([IO.StringReader]::new($raw), $xmlSettings)
    $xml = [Xml.XmlDocument]::new()
    try { $xml.Load($reader) } finally { $reader.Dispose() }
    if ($xml.DocumentElement.Name -cne 'Res' -or $xml.DocumentElement.GetAttribute('Code') -cne '0') {
        throw "A ZFPLab nem igazolta vissza a parancsot: $Name. Kod: $($xml.DocumentElement.GetAttribute('Code'))."
    }
    $values = @{}
    foreach ($field in $xml.DocumentElement.SelectNodes('.//Res')) {
        $key = $field.GetAttribute('Name')
        if ($key -eq 'Reserve') { continue }
        if (-not $key -or $values.ContainsKey($key)) { throw "Ismeretlen ZFPLab valasz: $Name." }
        $values[$key] = $field.GetAttribute('Value')
    }
    $values
}

function Get-ZfpSingleValue($Values) {
    if ($Values.Count -ne 1) { throw 'A ZFPLab valaszaban nem egyetlen ertek erkezett.' }
    [string]($Values.Values | Select-Object -First 1)
}

function Get-PrintLines($Job, $Config, $Rates) {
    foreach ($line in $Job.lines) {
        $mapping = if ($null -eq $line.productId) { $Config.deliveryVat } else {
            $property = $Config.vatByProduct.PSObject.Properties[$line.productId]
            if ($property) { $property.Value }
        }
        if (-not $mapping) { throw "Hianyzo TVA-beallitas: $($line.name) ($($line.productId))." }
        $class = [string]$mapping.class
        $rate = Read-Decimal ([string]$mapping.rate)
        $deviceRate = ([string]$Rates["VATrate$class"]).Trim().TrimEnd('%')
        if ($class -cnotmatch '^[A-E]$' -or (Read-Decimal $deviceRate) -ne $rate) {
            throw "A programozott TVA-kulcs elter: $($line.name)."
        }
        $name = if ($mapping.PSObject.Properties['name'] -and $mapping.name) { $mapping.name } else { $line.name }
        if ($name -cnotmatch '^[A-Za-z0-9 .&()/+\-\u0102\u0103\u00C2\u00E2\u00CE\u00EE\u015E-\u0163\u0218-\u021B]{1,30}$' -or [string]::IsNullOrWhiteSpace($name)) {
            throw "A tetelhez legfeljebb 30 karakteres kasszanevet kell beallitani: $($line.name)."
        }
        $unit = if ($null -eq $line.productId) { 'srv' } else { 'buc' }
        [pscustomobject]@{ Name = $name; Unit = $unit; VatClass = $class; VatRate = $rate; Price = (Format-Lei $line.unitBani); Quantity = [long]$line.quantity }
    }
}

function Write-ReceiptJournal($Path, $Entry) {
    $data = [Text.Encoding]::UTF8.GetBytes(($Entry | ConvertTo-Json -Compress))
    $stream = [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough)
    try { $stream.Write($data, 0, $data.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}

function Get-BridgeResult($Entry) {
    if (-not $Entry.PSObject.Properties['version'] -or $Entry.version -ne 2) { throw 'Ez nem uj tipusu Gastro Garage naplobejegyzes.' }
    $issued = $Entry.status -ceq 'issued'
    [pscustomobject]@{ version=2; jobId=$Entry.jobId; orderId=$Entry.orderId; token=$Entry.token; day=$Entry.day;
        status=$(if ($issued) {'issued'} else {'uncertain'}); method=$Entry.method; totalBani=$Entry.totalBani; deviceSerial=$Entry.deviceSerial;
        receiptNumber=$(if ($issued) {$Entry.receiptNumber} else {''}); receiptCounter=$(if ($issued) {$Entry.before + 1} else {$null});
        closedAt=$(if ($issued) {$Entry.closedAt} else {''}) }
}

function Write-BridgeResult($Path, $Entry) {
    $result = Get-BridgeResult ([pscustomobject]$Entry)
    if (Test-Path -LiteralPath $Path) {
        $old = Read-JsonFile $Path 8192
        if ($old.jobId -cne $result.jobId -or $old.token -cne $result.token) { throw 'Masik nyomtatas eredmenyfajlja van ezen a helyen.' }
        # A saved issued result must never be downgraded to uncertain.
        if ($old.status -ceq 'issued') { return }
        $Path = $Path + '.updated.gastroresult'
    }
    Write-ReceiptJournal $Path $result
}

function Apply-BridgeResolution($Path, $Journal) {
    $proof = Read-JsonFile $Path 8192
    if ($proof.version -ne 2 -or $proof.jobId -notmatch '^[a-f0-9-]{36}$' -or $proof.token -notmatch '^[a-f0-9]{64}$' -or
        $proof.state -cnotin @('issued','not_issued') -or $proof.resolution.Length -lt 10) { throw 'Ervenytelen egyeztetesi fajl.' }
    $lock = [IO.File]::Open((Join-Path $Journal 'bridge.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $Journal -Filter 'order-*.pending.json') {
            $entry = Read-JsonFile $file.FullName 8192
            if (-not $entry.PSObject.Properties['jobId'] -or $entry.jobId -cne $proof.jobId) { continue }
            if ($entry.token -cne $proof.token -or $entry.orderId -cne $proof.orderId -or $entry.deviceSerial -cne $proof.deviceSerial) { throw 'Masik kassza vagy rendeles egyeztetese.' }
            if ($proof.state -ceq 'not_issued') {
                if ([DateTimeOffset]::Parse($entry.expiresAt).AddMinutes(1) -gt [DateTimeOffset]::UtcNow) { throw 'Az elozo nyugtafajl meg ervenyes lehet.' }
                if (Test-Path -LiteralPath ($file.FullName + '.issued')) { throw 'A helyi naplo mar igazolta a kiadast. Egyeztesd ujra a kasszanaplot.' }
                $target = $file.FullName + '.not-issued'
                if (!(Test-Path -LiteralPath $target)) { Write-ReceiptJournal $target $proof }
            } else {
                if ($proof.receiptNumber -notmatch '^\d{1,4}$' -or [int]$proof.receiptNumber -lt 1 -or [int]$proof.receiptCounter -lt 1) { throw 'Hianyzo nyugtaszam.' }
                $entry.status='issued'; $entry | Add-Member -NotePropertyName receiptNumber -NotePropertyValue $proof.receiptNumber -Force
                $entry | Add-Member -NotePropertyName closedAt -NotePropertyValue $proof.completedAt -Force
                $entry.before=[int]$proof.receiptCounter - 1
                if (!(Test-Path -LiteralPath ($file.FullName + '.issued'))) { Write-ReceiptJournal ($file.FullName + '.issued') $entry }
            }
            return
        }
        throw 'Ehhez a nyomtatashoz nincs helyi naplobejegyzes ezen a gepen.'
    } finally { $lock.Dispose() }
}

function Invoke-Receipt($Path, $Config, $Journal, [scriptblock]$Command, [scriptblock]$Confirm) {
    $job = Get-Job $Path
    if ($job.version -eq 2 -and $job.deviceSerial -cne $Config.deviceSerial) { throw 'A nyugtafajl masik kasszahoz tartozik.' }
    if ($Config.mode -cne 'live') { throw 'A tenyleges kiadas csak live modban erheto el.' }
    if ($Config.deviceSerial -notmatch '^[a-zA-Z0-9]{4,20}$' -or $Config.operatorNumber -notin (1..20) -or $Config.operatorPassword -notmatch '^\d{1,4}$') {
        throw 'A kassza sorozatszama vagy a kezelo beallitasa hianyzik.'
    }
    $payment = if ($job.method -ceq 'cash') { $Config.cash } else { $Config.card }
    if ($payment.slot -notin (0..8) -or $Config.cash.slot -eq $Config.card.slot -or [string]::IsNullOrWhiteSpace($payment.name)) {
        throw 'Ellenorizd a fizetesi modok beallitasat.'
    }
    [void][IO.Directory]::CreateDirectory($Journal)
    $lock = [IO.File]::Open((Join-Path $Journal 'bridge.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $orderKey = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($job.orderId)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
        $jobSuffix = if ($job.version -eq 2) { '-' + $job.jobId } else { '' }
        $entryPath = Join-Path $Journal ("order-" + $orderKey + $jobSuffix + '.pending.json')
        foreach ($file in Get-ChildItem -LiteralPath $Journal -Filter 'order-*.pending.json') {
            $pending = Read-JsonFile $file.FullName 8192
            if (Test-Path -LiteralPath ($file.FullName + '.not-issued')) {
                $resolved = Read-JsonFile ($file.FullName + '.not-issued') 8192
                if ($resolved.state -cne 'not_issued' -or $resolved.jobId -cne $pending.jobId -or $resolved.token -cne $pending.token) { throw 'Ervenytelen helyi egyeztetes.' }
                continue
            }
            $issuedPath = $file.FullName + '.issued'
            if (!(Test-Path -LiteralPath $issuedPath)) { throw "Fuggo kiadas: $($pending.orderId). Egyeztesd a kassza elektronikus naplojaval." }
            $previous = Read-JsonFile $issuedPath 8192
            if ($previous.status -cne 'issued' -or $previous.orderId -cne $pending.orderId -or $previous.paymentId -cne $pending.paymentId) {
                throw "Fuggo kiadas: $($pending.orderId). Egyeztesd a kassza elektronikus naplojaval."
            }
            if ($pending.orderId -ceq $job.orderId) { throw "A rendeleshez mar keszult bon fiscal: $($previous.receiptNumber)." }
        }
        $serial = Get-ZfpSingleValue (& $Command 'ReadSerialNum')
        if ($serial.Trim() -cne $Config.deviceSerial) { throw 'Masik kassza csatlakozik a ZFPLabhoz.' }
        $rates = & $Command 'ReadVATrates'
        $printLines = @(Get-PrintLines $job $Config $rates)
        $payments = & $Command 'ReadPayments'
        if (([string]$payments["NamePaym$($payment.slot)"]).Trim() -cne $payment.name) { throw 'A kasszan mas fizetesi mod van programozva erre a helyre.' }
        if (-not (& $Confirm $job $printLines $payment.name)) { return }
        Assert-JobCurrent $job
        $deviceDay = Get-ZfpSingleValue (& $Command 'ReadDateTime')
        if ($deviceDay -notmatch '^\d{2}-\d{2}-\d{4} ' -or [datetime]::ParseExact($deviceDay.Substring(0, 10), 'dd-MM-yyyy', $invariant).ToString('yyyy-MM-dd', $invariant) -ne $job.day) {
            throw 'A kassza datuma elter a fizetes napjatol.'
        }
        $status = & $Command 'ReadStatus'
        if ($status['Opened_Fiscal_Receipt'] -cne '0' -or $status['Opened_Non_fiscal_Receipt'] -cne '0' -or
            $status['FM_fiscalized'] -cne '1' -or $status['Decimal_point'] -cne '1' -or $status['Printer_not_ready_or_no_paper'] -cne '0') {
            throw 'A kassza nem all keszen. Ellenorizd a papirt, az uzemmodot es a nyitott bizonylatokat.'
        }
        $before = & $Command 'ReadLastAndTotalReceiptNum'
        if ($before['TotalReceiptCounter'] -notmatch '^\d{1,7}$') { throw 'A kasza nyugtaszamlaloja nem olvashato.' }
        $paymentId = if ($job.version -eq 2) { $job.jobId } else { $job.paymentId }
        $entry = @{ status = 'pending'; orderId = $job.orderId; paymentId = $paymentId; day = $job.day; totalBani = $job.totalBani; method = $job.method;
            deviceSerial = $serial; before = [int]$before['TotalReceiptCounter']; startedAt = [DateTimeOffset]::UtcNow.ToString('o') }
        if ($job.version -eq 2) { $entry.version=2; $entry.jobId=$job.jobId; $entry.token=$job.token; $entry.expiresAt=$job.expiresAt }
        Write-ReceiptJournal $entryPath $entry
        try {
            [void](& $Command 'OpenReceipt' @{ OperNum = $Config.operatorNumber; OperPass = $Config.operatorPassword; OptionFiscalReceiptPrintType = '2' })
            foreach ($line in $printLines) {
                $nameWithUnit = $line.Name.PadRight(30) + [char]0x60 + $line.Unit + '  '
                [void](& $Command 'SellPLUwithSpecifiedVAT' @{ NamePLU = $nameWithUnit; OptionVATClass = $line.VatClass; Price = $line.Price; Quantity = $line.Quantity })
            }
            $subtotal = Read-Decimal (Get-ZfpSingleValue (& $Command 'Subtotal' @{ OptionPrinting = '0'; OptionDisplay = '0' }))
            if ($subtotal * 100 -ne $job.totalBani) { throw 'A kassza reszosszege elter.' }
            [void](& $Command 'PayExactSum' @{ OptionPaymentType = $payment.slot })
            [void](& $Command 'CloseReceipt')
            $after = & $Command 'ReadLastAndTotalReceiptNum'
            $closed = & $Command 'ReadStatus'
            if ($after['LastReceiptNum'] -notmatch '^\d{1,4}$' -or [int]$after['LastReceiptNum'] -lt 1 -or
                $after['TotalReceiptCounter'] -notmatch '^\d{1,7}$' -or [int]$after['TotalReceiptCounter'] -ne $entry.before + 1 -or $closed['Opened_Fiscal_Receipt'] -cne '0') {
                throw 'A nyugtaszamot nem sikerult megerositeni.'
            }
            $entry.status = 'issued'
            $entry.receiptNumber = $after['LastReceiptNum']
            $entry.closedAt = [DateTimeOffset]::UtcNow.ToString('o')
            Write-ReceiptJournal ($entryPath + '.issued') $entry
            if ($job.version -eq 2) { Write-BridgeResult ($Path + '.gastroresult') $entry }
            [pscustomobject]$entry
        } catch {
            if ($job.version -eq 2) {
                try { Write-BridgeResult ($Path + '.gastroresult') $entry } catch { Write-Warning 'Az eredmenyfajl nem mentheto; exportald a helyi naplobol.' }
            }
            throw "A kiadas fuggo allapotban van. Ne add ki ujra. Egyeztesd a kassza elektronikus naplojaval. $($_.Exception.Message)"
        }
    } finally { $lock.Dispose() }
}
