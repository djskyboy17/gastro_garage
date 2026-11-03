# Átadás egy másik AI-nak / fejlesztőnek (frissítve: 2026-11-04, v74 után)

Gyors eligazítás annak, aki a projektet nagyjából ismeri, de csak a **GitHubot** és a **Cloudflare-t** látja (a fejlesztő gépét nem).

## Hol van minden

| Mi | Hol |
|---|---|
| Forráskód | github.com/djskyboy17/gastro_garage |
| Munkaág | **`import/v14`** – ez a friss. A `main` régi, ne abból dolgozz. |
| Utolsó közzétett változat | **v74** (`5ea5939`, tag `v74-napi-zaras`), ez fut élesben is. Minden változatnak tagje van: `v58-telepulesek` … `v72-nir`, `v74-napi-zaras` (a v73-nak nincs külön tagje, a v74-gyel együtt ment ki). |
| Futó alkalmazás | Cloudflare Worker **`konyha`** (telepített verzió: `732d47e9`) |
| Adatbázis | Cloudflare D1 **`konyha-db`** (az azonosítója a D1 felületén látszik) |
| Címek | konyha.veres.no (konyha / iroda), gastrogarage.veres.no (ügyfélportál), courier.veres.no (futár) |
| Szabályok és leírás | `AGENTS.md`, `README.md`, `TELEPITES.md`, `FEJLESZTESI-TERV.md`, modulonként `src/modules/<modul>/SPEC.md` |

## Mi került ki legutóbb (v73 + v74)

- **v73 – 2. fázis: gyártási tétel + bon de consum** (`src/modules/production/`, migráció `0029`). Ételenként napi egy gyártási tétel receptpillanatképpel; lezáráskor FEFO szerinti anyagkiadás és sorszámozott bon de consum (BC-…), sztornóval. Ha egy ételnek aznap tétele van, rendelésenként nem adható ki rá anyag (`ISSUE_BATCHED`). A címke a tétel adataiból készül.
- **v74 – 3. fázis: napi zárás, maradék, selejt** (migráció `0030`). A konyha a nap végén rögzíti a dolgozói étkezést, a selejtet és az adományt; a maradék (ha még fogyasztható) másnapra a készletben marad. Napi selejt-PV (PVC-…), opcionális bon de predare (BP-…, alapból ki), a korábbi rendelések címkéje a régebbi tétel adatait kapja.
- **Teljesítményjavítás** (egy másik munkamenetből, ugyanebben a commitban): a portál mai + heti menüje egy `GET /api/portal/menu-board` kérésből; `/api/data` csak a szerepkör által látott modulokat tölti be; Intl-formázók újrahasznosítása; sorok egyszeri csoportosítása (`src/modules/shared/format.ts`, `collections.ts`). Mérés: `node --experimental-strip-types scripts/benchmark-cpu.mjs` (helyi szám, nem Cloudflare CPU-mérés).
- Részletek: `src/modules/production/SPEC.md`, `FEJLESZTESI-TERV.md` (0–3. fázis kész).

## Éles állapot (v74)

- Az éles D1-en a **0030-as migrációig** minden lefutott. Új migráció **0031**-gyel kezdődik.
- Utolsó mentés az élesítés előtt: D1 export + time-travel könyvjelző `000000a2-00000000-00005118-316ef30b8867ece3fe3bef4c23dbcc33` (a v72 állapota, a 0029/0030 előtt).
- Titkok a Workerben (értékük csak a Cloudflare-ben van, **soha ne kerüljön chatbe vagy a tárolóba**): `GEMINI_API_KEY`, `GOOGLE_CLIENT_SECRET`, `KITCHEN_OWNER_EMAIL`, `OWNER_SETUP_CODE`.
- Telepítéskor a `BUILD_VERSION / BUILD_COMMIT / BUILD_TIME` változók is átmennek (a Beállításokban látszik a futó változat).
- Az éles adatbázisban van egy próba-AI-számla piszkozatban (GASTRO GARAGE S.R.L., GG 2026-0101) – a tulajdonos elvetheti.
- Az új gyártási és napizárási lapokat élesben bejelentkezett felhasználó még nem próbálta ki.

## Amire figyelni kell

- A `design/` mappa (portálminta) szándékosan nincs a tárolóban.
- **Bizonylat nem törölhető, csak sztornózható** (NIR, BC, PVC, BP). A sorszámot a `documents` modul adja, a bizonylattal egy D1-kötegben.
- Lezárt napra nem vehető fel / zárható le / sztornózható gyártási tétel; előbb az admin visszanyitja a napot (`/api/production/day/reopen`).
- A bon de predare és a selejt-PV formája **[ELLENŐRIZENDŐ]** a könyvelővel; a bon de predare ezért beállítás, alapból ki.

## Munkarend (kötelező)

1. **Élesítés, commit, push csak a tulajdonos kifejezett jóváhagyásával.** Gyakori válasz: „Még ne”.
2. **Migráció vagy éles adatmódosítás előtt mentés:** D1 export SQL-be + time-travel könyvjelző (`wrangler d1 time-travel info konyha-db`). Hiba esetén a könyvjelzőre állunk vissza.
3. Ellenőrzés: `node node_modules/typescript/bin/tsc --noEmit`, `node --experimental-strip-types --test tests/*.test.mts` (145 teszt), `node scripts/run-framework.mjs build`.
4. Parancsok: `npm run cf:migrate` (éles migráció), `npm run cf:deploy` (telepítés), `npm run cf:gemini` (Gemini-kulcs – a tulajdonos maga írja be a terminálba). A szkriptnek kell egy helyi `cloudflare.json` (`workerName`, `databaseName`, `databaseId`) – nincs a tárolóban.
5. Pénz egész baniban, dátum Europe/Bucharest szerint, felületi szöveg magyarul és románul, hivatalos bizonylat (NIR, BC, PV, BP) románul.
6. Commit-üzenet angolul; dokumentáció magyarul.
7. Ha ugyanabban a mappában két munkamenet dolgozik, mindkettő a saját változását külön commitolja, mielőtt a másik hozzányúl – különben a változások összefonódnak.

## Hozzáférés adása (ezt a tulajdonos csinálja)

**GitHub**
- Repository → *Settings* → *Collaborators* → *Add people* → a másik fél GitHub-fiókja, szerep **Write**.
- Vagy, ha csak egy AI-eszköznek kell: fiókod → *Settings* → *Developer settings* → *Fine-grained personal access token*, csak a `gastro_garage` tárolóra, *Contents: Read and write*, rövid lejárattal.

**Cloudflare**
- Ember esetén: *Manage Account* → *Members* → *Invite*, szerepkörök: **Workers Admin** és **D1** (ha a DNS-t is kezelnie kell, a `veres.no` zónához *DNS*).
- AI-eszköz esetén: *My Profile* → *API Tokens* → *Create Token* → egyéni token ezekkel:
  - Account · **Workers Scripts: Edit**
  - Account · **D1: Edit**
  - Account · **Account Settings: Read**
  - Zone (veres.no) · **Workers Routes: Edit** (csak ha útvonalat kell módosítania)
  - rövid lejárat; a tokent közvetlenül az eszköz titoktárába tedd, ne chatbe.
- A hozzáférés munka végén visszavonható: GitHubon a collaborator / token törlése, Cloudflare-ben a tag eltávolítása / token *Roll* vagy *Delete*.

## Mi jön

- A gyártási tételek és a napi zárás kipróbálása élesben (iroda + konyha); a PV aláírói és az ételek fogyaszthatósági ideje beállítandó.
- 4. fázis: aviz (szállítólevél) – `FEJLESZTESI-TERV.md`.
- A könyvelővel egyeztetendő: bon de predare, selejt-PV formája, készletértékelés (FIFO / súlyozott átlag).
- Nyitott: a cégadatok a NIR-en / BC-n / PV-n; e-mailes jelszó-visszaállítás csak a végleges domain után; a teljesítményjavítás felhős (CPU-keret, hidegindulás) ellenőrzése.
