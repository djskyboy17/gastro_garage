# Fejlesztési terv – román előkönyvelés és bizonylatok

Készült: 2026. november 3. Alap: az „App-állapot és előkönyvelési teendők” áttekintés (commit `42f8fd4`, v68), kiegészítve a jelenlegi éles változattal (`c575f14`, v70) és a kód ellenőrzésével.

## Kiindulás

A napi konyhai működés megvan: rendelés, étlap, recept, beszerzés, raktár, leltár, konyha, futár, címke, HACCP és a beszállítói számlák AI-beolvasása bevételezéssel. Ami hiányzik, az a **román bizonylati lánc** (NIR, bon de consum, gyártás, készétel, aviz, számla, pénztár) és a **könyvelői átadás**.

Ellenőrzött hiányosságok a meglévő részekben:
- A konyhai „Elkészült” nem kapcsolódik a raktári anyagkiadáshoz: az étel elkészültnek jelölhető alapanyag-fogyás nélkül.
- Nincs közös bizonylat-sorszámozás; minden későbbi bizonylat (NIR, bon de consum, aviz, számla, chitanță) erre épül.
- Ugyanaz a beszállítói számla új feltöltésként újra bekerülhet (csak a kérésazonosító ismétlése ellen van védelem).
- A számla pénzneme lehet nem RON, de az érték RON-ként kerül a raktárba; az összegeltérés csak figyelmeztetés.
- A főzés előtt lemondott rendelés nyom nélkül törlődik. Ez most rendben van, de amint egy rendeléshez bizonylat (aviz, számla) tartozik, törlés helyett sztornó kell.

## Alapelvek (minden fázisra)

1. **Végleges bizonylat nem módosítható és nem törölhető**, csak sztornózható / korrigálható; az eredeti és a javítás is megmarad.
2. **Sorszám bizonylattípusonként és sorozatonként**, hézag nélkül, évente újrakezdve (a pontos szabály a könyvelővel egyeztetve).
3. **Pillanatkép**: minden bizonylat a kiállításkori adatokat őrzi (partner, ár, TVA, mennyiség, recept, tétel).
4. **Hivatalos bizonylat románul**, nyomtatható (A4, böngészőből PDF); a felület HU/RO.
5. **Külső rendszer (ANAF, e-Factura, pénztárgép) csak háttérfeladatból**, hibája nem állítja meg a konyhát.
6. Minden fázis kis, végig működő szelet: séma + migráció, logika, felület, tesztek, SPEC, élesítés mentéssel.

## Fázisok

### 0. Rendbetétel (kicsi, 1 munkamenet) — ✅ kész (v71)
- **Verzió a felületen:** a Beállításokban és `/api/version`-ön a futó commit és verzió, hogy mindig egyértelmű legyen, mi van élesben.
- **SPEC- és tesztkarbantartás:** a megszűnt szabályok (futár-összekapcsolás, csomagellenőrzés, idősávok, irányítószám) kivezetése a leírásokból; az elavult `tests/*-api.mjs` API-tesztek frissítése vagy törlése.
- **Közös sorszámozás** (`numbering`): sorozat, következő szám, éves újrakezdés, tranzakcióban kiosztva. Ez minden további bizonylat alapja.

### 1. Beszállítói számla megerősítése + NIR (közepes, 2–3 munkamenet) — ✅ kész (v72), a beszerzési rendeléshez párosítás nélkül
- **Üzleti duplikáció:** szállító CUI + széria + szám alapján figyelmeztetés feltöltéskor, tiltás a második bevételezésnél.
- **Pénznem:** egyelőre csak RON bevételezhető. Más pénznem esetén tiltás, később dátumozott árfolyam.
- **Bevételezés feltételei:** szállító, adószám, szám, dátum és végösszeg kötelező. Tűrés feletti összegeltérésnél csak indoklással lehessen bevételezni.
- **Szállítótörzs:** a számla a beszállítóhoz kötődik CUI szerint; ismeretlen CUI esetén egy kattintással felvehető. Fizetési határidő rögzítése (a pénzügyi fázishoz).
- **NIR (Notă de intrare-recepție):** sorszámozott, a bevételezéskor keletkezik. Tartalma: számlázott és ténylegesen átvett mennyiség, eltérés, a bizottság nevei. Román nyomtatási kép, sztornó-NIR. A NIR a számlához és a raktártételekhez kapcsolódik.
- **(Opcionális) beszerzési rendelés párosítása:** a számlasorok a rendelés soraihoz köthetők, részátvétellel.
- *Elfogadás:* ugyanaz a számla két feltöltéssel sem kerül be kétszer; a NIR száma folytonos; a NIR sztornója a készletet is visszaveszi; nem RON-os számla nem bevételezhető.

### 2. Gyártási tétel + bon de consum (nagy, 3–4 munkamenet) — ✅ kész (v73), részletek: src/modules/production/SPEC.md
- **Gyártási tétel** (`production_batches`): nap, étel, receptverzió-pillanatkép, tervezett és tényleges adagszám, tételszám, gyártási idő, fogyaszthatóság.
- **Anyagkiadás a tételhez** (FEFO szerint), egyszer: a rendelésenkénti mostani kiadás helyett vagy mellett a tétel fogyaszt, kettős levonás nélkül.
- **Bon de consum:** sorszámozott, a tétel anyagkiadásából keletkezik, nyomtatható, sztornózható.
- **Konyhai „Elkészült”:** gyártási tételhez kötött. Döntés (2026-11-03): nem kötelező, jól látható figyelmeztetésként jelenik meg.
- **Címke:** a tényleges tétel adataiból (gyártási dátum, összetétel-pillanatkép, tömeg, eltarthatóság).
- *Elfogadás:* 1 tétel több rendelést kiszolgál; az alapanyag egyszer fogy; a címke a tétel adatait mutatja.

### 3. Készételkészlet, maradék, selejt (közepes, 2–3 munkamenet) — ✅ kész (v74), részletek: src/modules/production/SPEC.md; a bon de predare beállítható, alapból ki (könyvelővel egyeztetendő)
- **Késztermék-bevételezés** (bon de predare / termelési jelentés, a könyvelővel egyeztetett modell szerint) a gyártási tételből.
- **Készétel-készlet** tételenként; kiadás a rendelésekre és a kiszállításra.
- **Kiadási jogcímek:** eladás, maradék (következő napra, ha szabályos), selejt (proces-verbal de casare: indok, jóváhagyás), dolgozói étkezés, adomány.
- **Napi egyeztetés:** gyártott = eladott + készleten + selejt + egyéb kiadás.
- *Elfogadás:* 100 adag gyártva, 80 eladva, 15 készleten, 5 selejt → az egyenleg egyezik, az alapanyag nem fogy újra.

### 4. Aviz (közepes, 2 munkamenet) — ✅ kész (v75), részletek: src/modules/delivery-notes/SPEC.md; kinek kell: beállítható, a könyvelővel egyeztetendő
- **Aviz de însoțire a mărfii:** sorszámozott, kiszállításonként és ügyfelenként, tételekkel és gyártási tétellel. Átadás rögzítése, részszállítás, nyomtatás.
- A rendelés lemondása aviz után már sztornó, nem törlés.
- Kapcsolat a későbbi számlához (egy számla több avizt összevonhat).

### 5. Kimenő számlázás + RO e-Factura (nagy, 4–5 munkamenet)
- **Cégadatok és partnertörzs:** CUI, Reg. Com., cím, bank. Az ügyfél és a számlázási partner szétválik.
- **Számla:** sorozat, tételek TVA-kulccsal (dátum szerint), előleg, végszámla, sztornó, PDF.
- **RO e-Factura:** UBL 2.1 / CIUS-RO XML generálása, beküldés az ANAF SPV-be (OAuth), az állapot lekérdezése és a válaszok archiválása háttérfeladatból. A bejövő e-Facturák letöltése az SPV-ből, mint pontos adatforrás a beszállítói számlákhoz (az AI-beolvasás mellett).
- *Előfeltétel:* ANAF-hozzáférés (tokenes digitális tanúsítvány) a céghez.

### 6. Pénzügy és pénztár (közepes, 2–3 munkamenet)
- **Fizetések:** készpénz, kártya, utalás; részfizetés; nyitott vevő- és szállítóegyenleg; esedékesség.
- **Registru de casă és chitanță:** pénztáranként nyitó és záró egyenleg, bevétel és kiadás bizonylattal.
- **Pénztárgép:** első lépésben a Z-jelentés kézi rögzítése és egyeztetése. Eszközintegráció csak a típus ismeretében.

### 7. Könyvelői export, zárás, archívum (közepes, 2 munkamenet)
- **Export** a könyvelő programjához (SAGA vagy WinMENTOR) az ő formátumában, közös próbaimporttal.
- **Időszaki lezárás:** a lezárt hónap bizonylatai nem módosíthatók, csak korrekció lehetséges.
- **Bizonylatarchívum:** keresés, letöltés és megőrzés.

## Javasolt sorrend és indoklás

0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Ez megegyezik az áttekintés javaslatával, egy kiegészítéssel: a sorszámozás és a „végleges bizonylat nem törölhető” elv a 0. fázisba kerül, mert minden későbbi bizonylat erre épül.

A 2. és a 3. fázis a legnagyobb változás a konyhai munkában (gyártási tétel, maradék). Előtte érdemes egy rövid bejárás: hogyan főztök ténylegesen (adagonként vagy nagy tételben), mi történik a maradékkal.

## Előbb el kell dönteni (a könyvelővel / a konyhával)

| Kérdés | Mire hat |
|---|---|
| A cég ÁFA-fizető (plătitor de TVA)? Milyen TVA-kulcsok kellenek? | Bekerülési érték (nettó/bruttó), számla, e-Factura |
| Készletértékelési módszer (FIFO / súlyozott átlag)? | Bon de consum értéke, önköltség |
| A könyvelő programja és importformátuma (SAGA / WinMENTOR / egyéb)? | 7. fázis |
| Kell-e NIR minden beszerzéshez, ki a recepciós bizottság? | 1. fázis |
| Hogyan modellezzük a késztermék-bevételezést (bon de predare)? | 3. fázis |
| Adtok-e bon fiscalt a kiszállított ételhez, milyen pénztárgép van? | 6. fázis |
| Van-e ANAF SPV-hozzáférés és digitális tanúsítvány? | 5. fázis |
| Sorozatok és sorszámtartományok (pl. NIR-2026-0001)? | 0. fázis |
| Gyártás valósága: egy étel = egy napi tétel? Mi lesz a maradékkal (másnap, selejt, dolgozói)? | 2–3. fázis |

## Ami nem része a tervnek
- Bérszámfejtés, tárgyieszköz-nyilvántartás, főkönyv: ezek a könyvelő programjában maradnak.
- Automatikus könyvelés: a rendszer bizonylatokat és exportot ad, a könyvelést a könyvelő végzi.
