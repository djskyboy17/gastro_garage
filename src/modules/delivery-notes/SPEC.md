# Aviz de însoțire a mărfii (v75, 4. fázis; v84: csak céges kiszállításhoz)

## v84 – érvényes szabályok (2026-11-05, a tulajdonos döntése)
- **Kinek:** céges ügyfél (számlázási adat: `customer_billing.kind = company`) **kiszállított** rendeléséhez mindig kell aviz; magánszemélynek nem. Helyszíni átvételnél csak kérésre. Az iroda egyedi rendelésnél kérheti; a „minden kiszállításhoz” beállítás (alapból ki) a magánszemélyekre is kiterjeszti. A havi számlás magánszemély már nem kap automatikusan avizt.
- **Átadás a futárnak:** amíg a céges kiszállításhoz nincs kiállított aviz, a rendelés nem indulhat el (adatbázis-trigger `aviz_departure`, `AVIZ_REQUIRED`; a futár és az iroda indítására is). Aviz csak teljes adatokkal állítható ki: saját cégadat (név, CUI, Reg. Com., székhely – `COMPANY_PROFILE_REQUIRED`) és a céges vevő számlázási adatai (név, CUI, cím – `NOTE_BUYER_DATA`). Így hiányos cégadattal a rendelés nem adható át a futárnak.
- **Hol:** Beállítások → **Avizok** (tulajdonos, admin, diszpécser, konyha): cégadatok (csak admin szerkeszti), aviz-szabály és lábjegyzet, a kiválasztott nap avizjai. A korábbi Csomagolás fül neve **Termékcímkék**, és csak a címkéket mutatja.
- **Cégadatok** (`company_profile`, v87: külön Beállítások → Cégadatok fül; v88: egy helyen, `documents/server.loadCompanyProfile`, és automatikusan használja az aviz, a NIR, a pénztárkönyv, a könyvelési csomag fejléce, a címke gyártói sora, ha a címkebeállításban üres, és az Oblio-CIF, ha a számlázásban üres): név, CUI, Reg. Com., székhely, munkapont, telefon. Az avizon „Furnizor”: név, CUI/CIF, Reg. Com., Sediu, Punct de lucru (ha más, mint a székhely).
- **Vevő** céges ügyfélnél: a számlázási név, CUI/CIF, Reg. Com., Sediu, valamint a szállítási cím és telefon.
- **Szállítás (v86):** a beállításban két autó rendszáma adható meg; kiállításkor választható (egy autónál automatikus), és a rendszám az avizra kerül. A „Șofer / delegat” sorba a beállított szöveg kerül (alapból „angajat”). [ELLENŐRIZENDŐ] a könyvelővel, hogy a delegat neve nélkül elég-e. Rendszám nélkül üres sor marad kézi kitöltésre.
- **Lábjegyzet** (`delivery_note_settings.legal_footer`): ha ki van töltve, az aláírás-sorok helyett ez és a rendszerazonosító („ID audit sistem”) kerül az avizra. A tulajdonos döntése: már most a lábjegyzet („Document generat electronic, valabil fără semnătură și ștampilă…”). [ELLENŐRIZENDŐ] a könyvelővel, mert a Codul fiscal art. 319 alin. (29) a számlára vonatkozik; ha az avizra nem érvényes, a lábjegyzet törlésével visszajönnek az aláírás-sorok.
- Pillanatkép: a cégadat, a vevőadat és a lábjegyzet kiállításkor rögzül; későbbi változás a kiállított avizt nem írja át.
- A könyvelési profil többé nem kapcsolja be és nem teszi kötelezővé a „minden kiszállításhoz” szabályt.
- Archívum: céges vevő avizja a vevő CUI-ja szerinti mappába kerül.

Az alábbi, korábbi szakaszok történeti leírások; ahol ellentmondanak, a fenti v84-szabály érvényes.


Egyeztetés (2026-11-04):
- kiknek kell: **még nem tudni** → rendelésenként kérhető, és egy beállítással minden kiszállításhoz bekapcsolható (alapból ki). [ELLENŐRIZENDŐ] a könyvelővel;
- mikor: **csomagoláskor** – a Csomagolás fülön, a címkék mellett készül és nyomtatható, így a futár már viszi;
- **ár nélkül** (tételek, mennyiség, gyártási tétel); az ár a későbbi számlán lesz;
- az átvételt **nem kell rögzíteni** (a kézbesítés rögzítése elég, mint most).

## Adatok és végpontok
- `delivery_notes`: kiállított avizok és sztornó-avizok; részleges egyedi index: rendelésenként legfeljebb egy kiállított, nem sztornózott aviz. `invoice_id` az 5. fázisnak.
- `delivery_note_settings`: „minden kiszállításhoz” kapcsoló; `orders.delivery_note_required`: az iroda jelölése.
- `GET /api/delivery-notes?date=`, `POST /issue`, `GET /print?id=` vagy `?date=`: csomagoló szerepkörök (tulajdonos, admin, konyha, diszpécser).
- `POST /reverse` (indokkal), `POST /require`: iroda (tulajdonos, admin, diszpécser). `POST /settings`: admin.

## Ami változik

### Aviz (`delivery_notes`, sorozat `delivery_note`, előtag AVZ)
- Rendelésenként legfeljebb egy érvényes aviz. Sorszámozott (AVZ-2026-0001), a `documents` modullal, hézag nélkül.
- **Pillanatkép:**
  - szállító (a címkeadatok gyártói neve és címe; a teljes cégadat az 5. fázisban jön);
  - vevő (a rendelésre mentett név, cím, telefon);
  - kiszállítás napja és ideje;
  - tételek: román név, mennyiség (adag), allergének, **gyártási tételkód** és fogyaszthatóság (a címkével azonos módon: a korábbi rendelés a régebbi tételt kapja; ha egy tétel két gyártási tételből jön, két sor).
- Román nyomtatási kép („AVIZ DE ÎNSOȚIRE A MĂRFII”), aláírási helyekkel (kiállító, delegat / futár, primitor), ár nélkül.

### Mikor készül
- **Csomagolás fül:** rendelésenként „Aviz” gomb, ha a rendelés kér avizt. Az első megnyomás kiállítja és megnyitja nyomtatásra; az ismételt megnyomás ugyanazt nyitja meg (dupla kattintásból nem lesz két aviz). „A nap összes avizja” gomb egyben nyomtatja.
- **Kinek:**
  - a rendelés részleteinél az iroda bejelölheti: „Aviz kell”;
  - beállítás: „Aviz minden kiszállításhoz” (alapból ki) – bekapcsolva minden kiszállításos rendelés kér avizt.
- Feltétel: visszaigazolt, még nem kézbesített rendelés.

### Lemondás aviz után
- A rendelés **lemondásakor** (ugyanazok a feltételek, mint eddig: főzés és kiszállítás előtt) avizos rendelésnél végleges törlés helyett a rendelés **„lemondott”** állapotba kerül, és az aviz ugyanabban a kötegben **sztornózódik** (sztornó-aviz negatív mennyiségekkel, saját sorszámmal).
- A végleges törlés (`hardDeleteOrder`, a portálos lemondás is) avizos rendelésnél soha nem fut le – a bizonylat megmarad.
- A rendelés tételei most sem módosíthatók (nincs ilyen funkció); ha később lesz, aviz után csak a sztornó után engedhető.
- Kézi sztornó: iroda, indokkal; utána új aviz állítható ki.

### Kapcsolat a számlához
- Az aviz megjegyzi, hogy számlázva van-e (az 5. fázis tölti ki; egy számla több avizt összevonhat). Most csak a mező kerül be.

## Ami NEM része
- Átvétel rögzítése (aláírás, átvevő neve) – nem kell.
- Részszállítás: ha nem minden ment ki, az avizt sztornózni kell, és újat kiállítani a ténylegesen kivitt tételekkel. [FELTÉTELEZÉS]
- Céges vevőadatok (CUI, Reg. Com.) – 5. fázis (partnertörzs).
- Átvételes (nem kiszállításos) rendeléshez is kérhető kézzel, automatikusan nem kap.

## Ellenőrző példák (tests/delivery-notes.test.mts; a kiállítás, a lemondás és a sztornó helyben, a futó alkalmazásban kipróbálva)
1. Bekapcsolt „minden kiszállításhoz”: a kiszállításos rendelés Aviz gombja kiállítja az AVZ-2026-0001-et; ismételt megnyomás ugyanazt adja.
2. A sorokon a gyártási tételkód: két rendelés közül a korábbi kapja a tegnapi maradék tételt (mint a címkén).
3. Avizos rendelés lemondása: sztornó-aviz készül, az eredeti „sztornózva”; végleges törlés nem megy.
4. Kézi sztornó után új aviz állítható ki (új sorszámmal); a már sztornózott aviz nem sztornózható újra. Párhuzamos dupla kattintás egy avizt ad.
5. A nyomtatás román, ár nélkül, a szállító és a vevő adataival.

## Havi számlás ügyfél — v77
- Havi gyűjtőszámlás ügyfél kiszállításos rendeléséhez automatikusan kell aviz; a havi számla az avizok számaira hivatkozik, kiállításkor az avizok `invoice_id`-t kapnak (sztornókor törlődik).

## Könyvelési profil és futárnézet

A könyvelési profil alkalmazása bekapcsolja és kötelezővé teszi a minden kiszállításhoz szükséges avizt. A futárfelület Aviz gombja a meglévő dokumentumot nyitja meg, a kiszolgálás feltételeit a courier modul ellenőrzi. A staff nyomtatási végpontok jogosultsága megmarad.

## Közös avizszabály helye – 2026-11-05

Beállítások → Aviz beállítások alatt szerkeszthető a minden kiszállításhoz szükséges aviz szabálya. Adminjogosultság, a meglévő settings végpont, revision és audit megmaradt. A Csomagolás csak a napi kiállítási/nyomtatási munkafolyamatot mutatja, nem a közös beállítást. A fő rendelésrészletben sem kérünk külön avizjelölést minden rendeléshez. A kiszállításos rendelések mind szükségesként jelennek meg bekapcsolt közös szabálynál; személyes átvételre nem terjesztjük ki. A normál helyi tesztkörnyezetben a közös szabály alkalmazáson keresztül bekapcsolva.
