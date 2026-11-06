# Konyhai fiskális nyugta · Tremol S25

Egyetlen konyhai kassza, egy Windows-gépen és Windows-fiók alatt. A modul a nyugtakiadást követi; a pénz átvétele a finance modul külön művelete. Alapmód simulation, valódi készüléket nem ér el.

## Határok és adatok

- `orders.expected_payment_method`: üres / cash / card. A régi és ismétlődő rendelések értéke üres; az iroda kiválasztja. Új telefonos és portálos rendelés felületén választani kell. Régi API-hívásnál az elhagyott mező üres marad, nem lesz feltételezett készpénz.
- A portál előnézeti ujjlenyomata a fizetési tervet is tartalmazza; megváltoztatása új előnézetet igényel. Az ügyfél és az árak meglévő pillanatképezése megmarad.
- `fiscal_settings`: simulation / live, egy eszköz sorozatszáma, revision. Éles módot csak admin állíthat, kasszateszttel ellenőrzött sorozatszámmal. A kezelő jelszava és a TVA-/fizetésihely-beállítás a Windows-híd helyi fájljában marad. Sem a cég nem-áfafizető státuszából, sem egy terméknévből nem találunk ki kasszabeli TVA-betűt.
- `fiscal_receipts`: változatlan román tételnév/ár/mennyiség/szállításidíj-pillanatkép, napi fizetési mód, teljes összeg, eszköz, állapot és eredmény. Nincs ügyfélnév, cím vagy telefon a nyugtafájlban. Pénz egész bani; nap Europe/Bucharest.
- A korrelációs token futásadat. Nem kerül auditba, felületi listába vagy Gitbe. A `.gastrobon`, `.gastroresult`, `.gastroresolution` fájlokat a kasszás munkafájlként kezeli. A token egyezése a feladatot azonosítja; nem kriptográfiai igazolás a fizikai készüléktől. Az importot bejelentkezett kezelő ellenőrzi és hagyja jóvá.

## Végpontok és jogosultság

Tulajdonos/admin/diszpécser: GET `/api/fiscal/order?id=`, `/day?date=`, `/job?id=`; POST `/method`, `/prepare`, `/result`, `/simulate`. Admin: POST `/settings`, `/resolve`, GET `/resolution?id=`. Futár, konyhai és raktári szerepkör nem állíthat ki nyugtát. Same-origin JSON, szerverellenőrzés és atomikus naplózás minden írásnál kötelező. A nyomtatás a rendelés részleteiben, a beállítás és a napi egyeztetés a Pénztár oldalon van.

A prepare kliensgenerált UUID-t kap. Azonos feladat megismétlése ugyanazt az azonosítót adja vissza; más rendeléshez az azonosító nem használható. Az order revision és settings revision a mentéskor is ellenőrződik. A feladat csak visszaigazolt, mai rendeléshez készülhet, ismert készpénz/kártya móddal, pozitív árú, legfeljebb 50 kasszasorral és legfeljebb 1 000 000 lejes összeggel. Az eltérő móddal már rögzített nettó befizetést előbb egyeztetni kell.

## Nyomtatás és visszaigazolás

1. Előkészítés: `prepared`; élő módban a sorozatszámra egyszerre egy függő feladat engedélyezett.
2. A `.gastrobon` tíz percig tölthető le és indítható a meglévő Windows-kiegészítőben. A híd helyi naplót ír a nyitó parancs előtt. Az SDK-kezelés, a kassza/TVA/fizetésihely/részösszeg ellenőrzése a meglévő illesztésre épül.
3. A híd sikeres zárás és visszaolvasás után `issued` eredményt ír nyugtaszámmal és összesített számlálóval. Válaszkiesésnél `uncertain` eredmény készül. Nincs automatikus újranyomtatás.
4. A kezelő visszaolvassa a `.gastroresult` fájlt, átnézi és menti. A szerver egyezteti az azonosítót, tokent, rendelést, napot, összeget, fizetési módot és eszközt. Teljesen azonos sikeres eredmény ismétlése nem készít új auditot vagy bizonylatot.
5. A nyugta lezárása nem ír a payments/cash_entries táblákba és nem változtatja az order.payment állapotát.

A letöltés vagy az időtúllépés önmagában nem igazolja a sikert és nem oldja fel a feladatot. Az `uncertain` feladatból nem tölthető le új nyugtafájl. A feloldás adminisztrátori kasszanapló-ellenőrzést és legalább 10 karakteres indokot igényel. `issued` esetben a valódi szám és számláló kötelező. `not_issued` csak a fájl tíz perce és még egy perc után választható élő módban.

Az admin letölti az egyeztetési fájlt, és a kasszás az `Egyeztetes.cmd` segítségével a helyi függő naplóhoz is alkalmazza. A már helyben visszaigazolt nyugtát nem lehet nem-kiadottnak átírni. Ellenőrzött nem-kiadás után új feladatazonosítóval, kifejezett kezelői indítással lehet próbálkozni. A korábbi fájl és napló megmarad. A már kiadott élő nyugta végleges; kasszás sztornó/visszatérítési továbbfejlesztés külön fázis.

## Védelmek és napi egyeztetés

Részleges egyedi index tiltja ugyanahhoz a rendeléshez a második élő kiadást, illetve egy eszközön a párhuzamos függő kiadásokat. A nyugtaszám eszközönként és naponként egyedi. Triggerek tiltják a nyugtázott vagy függő élő rendelés tétel-, dátum-, díj-, fizetésiterv- és lemondási változtatását; a főzési/kézbesítési állapot továbbra is haladhat. A nyugta pillanatképe nem írható át.

A szimuláció feltűnően megjelölt, nem exportálható kasszafájlba, és nem kerül a valódi nyugta- és Z-összegekbe. Az előzmények legutóbbi 20 sora látszik, az élő bejegyzések elsőbbséget kapnak. Nyugtával vagy tesztelőzménnyel rendelkező rendelés végleges törlés helyett megőrzött lemondott állapotba kerülhet; élő kiadásnál előbb kasszaegyeztetés kell.

A napi panel a visszaigazolt élő nyugták készpénz/kártya összegét veti össze a mentett Z-jelentéssel. A tényleges beszedések meglévő egyeztetése külön szerepel, mert a konyhai előnyomtatás és a pénz átvétele eltérhet. A Z eredeti fájlja a meglévő Tremol-importból vagy kézi ellenőrzött felvitelből érkezik; a modul nem indít automatikus kasszazárást és nem kezel POS-tranzakciót.

## Elfogadási példák

- Kártyára tervezett, fizetetlen 36 lejes rendelés szimulált nyugtázása után az egyenleg 36 lej marad, a valódi nyugtaösszeg nulla.
- Ugyanahhoz a rendeléshez két egyidejű élő előkészítésből egy sikerül. Második élő rendelés előkészítése ugyanazon függő eszközön is visszautasítást kap.
- A kassza lezár, de elveszik a válasz: a helyi napló és az alkalmazás egyeztetést kér. Újabb kiadás nem indul automatikusan.
- Másik feladat tokenjével vagy más összeggel érkező eredmény nem menthető.
- Egyetlen visszaigazolt eredmény újraimportálása nem dupláz. Az admin által nem-kiadottnak ellenőrzött régi feladat csak lejárat után oldható fel, a helyi naplóval együtt.
- Nyugtázás után a tényleges befizetés külön rögzül, és csak ez állítja fizetettre a rendelést.

Ellenőrzés: domain- és valós migrációs SQLite-tesztek, PowerShell 5.1 mock SDK-tesztek, elkülönített helyi böngésző → API → D1 → újratöltés. A saját S25-tel végzett fizikai próba és a helyes TVA-betű/fizetésihely/sorozatszám beállítása továbbra is szükséges.

## Havi gyűjtőszámlás rendelés – 2026-11-05

A havi ügyfél rendelésében nem készítünk új fiskális nyugtát és nem választunk készpénz/kártya módot. GET /api/fiscal/order jelzi a collectionDeferred szabályt. Előzmény nélkül a nyugtapanel rejtett; meglévő előzménynél a figyelmeztetések, egyeztetés és eredményimport megmarad, az új készítés/fizetésimód-választás rejtett.

Az új előkészítés és nem üres tervezett mód mentése szerveroldalon is tiltott, atomikus profilvizsgálattal. A korábban előkészített élő nyugta job exportja havi módnál tiltott; a már nyomtatott vagy bizonytalan eredményt továbbra is rendezni kell és lehet. A havi számlára később érkező fizetést a számlázás kezeli, nem ez a nyugtafolyamat. Receipt/per_order készítés változatlan.

## Rendelési ablak és színjelzés – 2026-11-06

A fejléc a mentett vevőnév; cím/idő/telefon alatta. A folyamat szöveges lépéssorral látszik, az üres vevői megjegyzés rejtett. A pénzátvételi műveletek lenyitható előzményrészben maradnak; nyugta nem egyenlő pénzátvétellel.

A narancs/sárga jelzés csak visszaigazolt, elkészült, még nem úton lévő rendelésnél jelenik meg. Élő issued nyugta vagy szerver által meghatározott havi halasztás ad sárgát; simulation/prepared nem. Uncertain esetén nincs sárga. Hiányzó adat vagy sikertelen kiszállítás semleges; úton kék, kézbesítve zöld. Ez megjelenítési állapot, nem új adatbázis-státusz, és nem kerüli meg az indulás szerveroldali ellenőrzéseit. Sárga esetén is ellenőrizni kell az Avizt.

Az Aviz-panel rendelésazonosítóra szűrve a részletekben is elérhető; a már létező hitelesített kiállítás/nyomtatás végpontokat használja. Nincs új D1-trigger vagy automatikus elindulás. A céges státusz önmagában nem jelent automatikus fiskális mentességet: a meglévő számlázási profil szabálya marad érvényben. A helyi kasszahíd továbbra is fájlos; nincs közvetlen egykattintásos hardvernyomtatás.

## Kompakt konyhai rendelési ablak – 2026-11-06

A rendelési részletekben nincs duplikált státuszrács, tájékoztató státuszmondat, pénzátvételi harmonika, kiszállítási szerkesztő és számlázási panel. A hozzájuk tartozó backend és külön munkafelületek megmaradnak. A vevői megjegyzés csak nem üresen jelenik meg. A lépéssor szöveges jelzést is ad; hosszú rendelések továbbra is görgethetők, tételek nem veszhetnek el.

Az Aviz rendelésre szűrt kompakt panelje a meglévő kiállítási végpontot használja. A gép helyi preferenciája csak a legutóbb sikeresen használt rendszámot tárolja; ha az kikerült az engedélyezett listából, az első konfigurált autó lesz kiválasztva. A meglévő aktív Aviz megnyitható; ugyanahhoz nem ajánl új kiállítást. Az átadás csak elkészült, még átadható rendelésnél, megfelelő szerepkörrel és ismert nyugta/havi számlázási állapot mellett engedélyezett; a szükséges Aviz hiánya tiltja. Szerveroldali ellenőrzések, revision és naplózás változatlanok.

A havi vevőnél rövid számlázási jelzés van. Más esetben látható a tervezett fizetési mód és a meglévő nyugta-előkészítés/letöltés. A közvetlen hardvernyomtatás továbbra sem implementált: a gomb nem állítja magáról, hogy nyomtatott. Élő issued nyugta száma megjelenik, a bizonytalan eredmény egyeztetése és eredményimport elérhető marad.
