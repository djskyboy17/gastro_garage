# Bizonylat-archívum (R2) — KÉSZ (v82)

A feltöltött beszállítói számlák (fotó / PDF) és a rendszer által kiállított bizonylatok változatlan példánya egy **privát
Cloudflare R2 tárolóba** kerül, kereshető metaadattal a D1-ben. Kiindulás: egy külső javaslat (R2 + `invoices` tábla), a
projekt felépítéséhez igazítva.

## Tárolás
- Privát R2 tároló: `gastro-garage-archive`, Worker-kötés: `ARCHIVE`. Nyilvános URL nincs; letöltés csak a Workeren át,
  bejelentkezett irodai szerepkörrel (tulajdonos, admin, diszpécser), naplózva.
- Kulcs: `archive/{ÉÉÉÉ}/{HH}/{PARTNER}/{TÍPUS}_{SZÁM}_{rövid azonosító}.{kiterjesztés}`
  - `PARTNER`: CUI (pl. `RO18547290`); ha nincs, a név egyszerűsítve (ékezet nélkül, csak `A-Z0-9-`, max. 40 karakter);
    saját belső bizonylatnál `GASTRO-GARAGE`.
  - `SZÁM`: a bizonylat száma egyszerűsítve (pl. `NIR-2026-0001`, `MCC-123`).
  - Ügyfélnek kiállított avizon a partner `CLIENT-{rendeléskód}` (az ügyfél adata nem kerül a kulcsba).
  - Újranyitható bizonylatnál (pénztárnap) a második változattól a számhoz `-V{n}` kerül.
  - Példa: `archive/2026/11/RO18547290/SUPPLIER_INVOICE_MCC-123_a8f92b1c.pdf`.
- **Egyszer írható:** azonos kulcsra soha nem ír felül (feltételes feltöltés); törlő végpont nincs. Javítás mindig új bizonylattal
  (sztornó), amely saját archívum-tételt kap.
- [ELLENŐRIZENDŐ] megőrzési idő a könyvelővel (tudomásunk szerint a számviteli bizonylatok jellemzően 10 év); ha kell, R2
  „bucket lock” szabály is beállítható, amely a megőrzési időn belül a törlést is tiltja.

## Adat (D1, új tábla `archive_documents`)
- `id`, `doc_type`, `source_table`, `source_id`, `version`, `number`, `partner_key`, `partner_name`, `issue_date`, `r2_key` (egyedi),
  `mime`, `size_bytes`, `sha256`, `created_by`, `created_at`.
- Egy bizonylathoz típusonként és változatonként egy archívum-tétel (egyedi: `source_table` + `source_id` + `doc_type` +
  `version`). A pénztárnap újranyitás és újbóli lezárás után új változatként kerül be; a régi megmarad.
- A meglévő táblák (beszállítói számla, NIR, BC, aviz, PV, kimenő számla) nem változnak; a külső javaslat `invoices`
  táblája és `schema.sql`-je nálunk nem létezik.

## Típusok
| Típus | Forrás | Formátum |
|---|---|---|
| `SUPPLIER_INVOICE` / `SUPPLIER_RECEIPT` | feltöltött, átvett számla / bon fiscal (Számlák) | eredeti fotó vagy PDF |
| `NIR` (+ sztornó) | bevételezés | HTML (a kiállításkori nyomtatási kép) |
| `BON_CONSUM` (+ sztornó) | gyártási tétel lezárása | HTML |
| `AVIZ` (+ sztornó) | Csomagolás | HTML |
| `PV_CASARE`, `BON_PREDARE` | napi zárás, gyártási tétel | HTML |
| `REGISTRU_CASA` | pénztárnap lezárása | HTML |
| `Z_REPORT` | Tremol A4203 fájl | **később** (még nincs fájlfeltöltés) |
| `SALES_INVOICE`, `E_FACTURA_SPV` | kimenő számla (Oblio) | **később**, a valódi Oblio-kapcsolat után |

- PDF-et a Worker nem állít elő; a saját bizonylatok HTML-ként, pontosan a kiállításkori formában kerülnek archívumba.
- E-Factura XML-t nem mi állítunk elő (az Oblio); kiállítás után az Oblio SPV-archívuma kerül be.

## Működés
- Az archiválás a bizonylatok kiállításától **függetlenül** fut: félóránként időzítve (Worker cron, `*/30 * * * *`, legfeljebb 40
  tétel) és az Archívum lap „Hiányzók archiválása” gombjával (25 tétel). R2-hívás soha nincs adatbázis-tranzakción belül; ha
  nem sikerül, a bizonylat ettől érvényes, és a következő futás újrapróbálja.
- Egy tétel: van-e már sor → ha igen, kész; különben feltöltés (SHA-256 ellenőrzéssel), méret-ellenőrzés, majd a sor beszúrása
  (`ON CONFLICT DO NOTHING`). Duplikátum és felülírás nem keletkezhet.
- **Meglévő anyag átköltöztetése:** ugyanez a folyamat viszi át a már feltöltött számlafájlokat (az adatbázisban base64) és a
  már kiállított bizonylatokat; a számlafájl az adatbázisból csak sikeres R2-feltöltés és ellenőrzőkód-egyezés után ürül ki.
- A Számlák lap a fájlt ezután az R2-ből mutatja (a felhasználó számára változás nélkül).

## Felület
- **Archívum** (iroda): szűrés év, hónap, típus, partner (CUI/név) és szám szerint; letöltés / megnyitás; a hiányzók száma és
  „Hiányzók archiválása” gomb.
- Megnyitás szigorú CSP-vel (a HTML-bizonylat nem futtathat kódot); minden megnyitás/letöltés naplózva (`archive_downloaded`).

## Költség
- Az R2 ingyenes kerete (10 GB tárolás, havi több millió művelet) ennek a mennyiségnek évekig elég.

## Ellenőrző példák
1. NIR kiállítása → az archívumban megjelenik `archive/2026/11/RO…/NIR_NIR-2026-0001_….html`, ugyanazzal a tartalommal, mint a nyomtatási kép.
2. Ismételt archiválás ugyanarra a bizonylatra nem hoz létre második fájlt és nem írja felül az elsőt.
3. Archívum-hiba (R2 nem elérhető) mellett a bizonylat kiállítása sikerül; a „Hiányzók archiválása” utána pótolja.
4. Beszállítói számla fájlja átköltözik: az R2-ben megvan, az ellenőrzőkód egyezik, az adatbázisból kikerül, a Számlák lapon ugyanúgy megnyílik.
5. Jogosultság nélkül (pl. futár, konyha) az archívum nem kereshető és nem tölthető le.
