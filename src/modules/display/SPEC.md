# Konyhai kijelző (display) — v47, v48

## Cél
Régi eszközön (első generációs Surface RT, Windows RT 8.1, csak Internet Explorer 11) is használható konyhai nézet. A fő alkalmazás React kliense IE11-ben nem fut (`type="module"`, modern szintaxis), ezért ez egy külön, szerveren renderelt oldal: `/kijelzo`. A fő alkalmazás viselkedése nem változik.

## Útvonalak
| Útvonal | Mit csinál |
|---|---|
| `GET /kijelzo` | Belépve a kijelző oldala; különben belépési űrlap. |
| `POST /kijelzo/belepes` | Űrlapos belépés (e-mail + jelszó), utána 303 → `/kijelzo`. |
| `POST /kijelzo/kilepes` | Kilépés (munkamenet törlése). |
| `GET /kijelzo/lista?v=<változat>` | A lista rész HTML-je. Ha a változat egyezik: `204` (nincs mit cserélni). Az új változat az `X-Kijelzo-Verzio` fejlécben jön. |
| `POST /kijelzo/muvelet` | `id`, `a=cooking|ready` (űrlap-kódolás). JSON választ ad: `{ok:true}` vagy `{error}`. |
| `GET /kijelzo/nyelv?l=hu|ro` | Nyelv választása (süti: `kijelzo_nyelv`, 1 év). |
| `GET /kijelzo/csengo.mp3` | Az új rendelés hangjelzése (MP3, mert az IE11 WAV-ot nem játszik le). |

## Belépés és jogosultság
- Ugyanaz a fiók és ugyanaz a jelszavas belépés, mint a fő alkalmazásban (`auth.passwordLogin`: korlátozás, napló, azonos hibaüzenet). Kiskapu nincs: minden kérésnél a munkamenet-sütiből jön a felhasználó, és a szerepkört a szerver ellenőrzi.
- Használhatja: tulajdonos, admin, konyha (és a régi raktáros szerepkör). Más szerepkörnél üzenet, nincs adat.
- Ideiglenes jelszóval belépett fiók (`must_change_password`) nem használhatja; előbb a fő alkalmazásban kell jelszót cserélnie.
- Süti: `konyha_session`, 30 nap, `Max-Age` mellett `Expires` is (az IE11 csak ezt ismeri; nélküle bezáráskor elveszne).
- Folyamatos használat: a főoldal betöltésekor, ha a munkamenet 20 napon belül lejárna, új munkamenet indul (újabb 30 nap), a régi törlődik (`auth.renewSession`). A kliens 6 óránként újratölti az oldalt, így a kijelző nem lép ki magától.
- Belépési űrlap: csak azonos eredetről (Origin, ennek hiányában Referer). Művelet: `X-Kijelzo: 1` fejléc kell (más oldal CORS nélkül nem küldhet ilyet), és ha van Origin, egyezzen.

## Mit mutat
- Visszaigazolt és visszaigazolásra váró rendelések: a mai nap összes rendelése, valamint a legfeljebb 2 napos, még nem kész („Késésben”) rendelések. A visszaigazolásra váró kártya zöld keretes, „Visszaigazolásra vár” felirattal.
- Felül ételenként a még elkészítendő adagok összesítése.
- Nyitott rendelések kártyán: idő, kód, kiszállítás / helyszíni átvétel, ügyfél, tételek (darab, név, allergének, kész-jelölés), megjegyzés, és egy nagy gomb: még el nem kezdett rendelésen **Elfogadom ✓**, készülő rendelésen **Elkészült**.
- Alul a ma elkészült rendelések kisebb kártyán, gomb nélkül.
- A konyha a v41 óta a rendelési adatokat teljes egészében látja; a kijelző ennél kevesebbet mutat (ár, cím, telefon nincs).

## Műveletek
- **Elfogadom ✓** (v48, zöld gomb a még el nem kezdett rendelésen): `kitchen.acceptOrder`. Ha a rendelés visszaigazolásra vár (portálos kérés), visszaigazolja **és** elindítja a főzést (requested/queued → confirmed/cooking), két `state_changed` naplóbejegyzéssel (`via: kitchen_display`). Ha már visszaigazolt, csak a főzést indítja (queued → cooking, `kitchen.startCooking`). Ugyanazok az állapotszabályok (`nextState`), mint a fő alkalmazásban; ismételve is biztonságos. Lemondott vagy elutasított rendelésnél hibát ad.
  - Jogosultság: a konyha a kijelzőn visszaigazolhat kérést. Elutasítani nem tud, az továbbra is az admin és a diszpécser dolga a fő alkalmazásban.
- A külön „Folyamatban” gomb megszűnt; a `cooking` művelet csak a régi, még újra nem töltött oldalak miatt maradt a szerveren.
- **Elkészült** (csak készülő rendelésen): a rendelés minden még nem kész tétele kész, a rendelés `ready` lesz (`kitchen.markOrderReady` → `markItemsReady`, ugyanaz, mint a fő alkalmazás „Kész” gombja). Ismételve is biztonságos.

## Kliens (IE11)
- Csak ES5: `XMLHttpRequest`, `var`, `function`; nincs `fetch`, Promise, nyílfüggvény, `let`/`const`, modul. CSS: flexbox (`-ms-` előtaggal is), nincs grid és CSS-változó. A teszt az acornnal ES5-ként elemzi a scriptet.
- Elavult oldal (v48): az oldal a saját kliens-változatát (`k`, a script, a stílus és a feliratok lenyomata) küldi a lista kérésekor. Ha a szerveren már újabb van (élesítés után), a lista 403-at ad, és az oldal újratölt. Így nem fordulhat elő, hogy a régi script az új listán egy számára ismeretlen gombot kap, ami nem csinál semmit.
- Frissítés román idő szerint 07:00–19:00 között 5 mp-enként, 19:00–07:00 között 30 mp-enként (v48 óta; előtte mindig 20). Az időközt a szerver adja meg minden lista-válaszban (`X-Kijelzo-Kovetkezo`), így a kijelző órájától független. Csak a lista rész cseréje; változatlan adatnál a szerver `204`-et ad. A „változott-e?” ellenőrzés ugyanazokat a rendeléseket olvassa indexen (`orders_date_status`), a tételekből csak összesítést (`order_items_order`).
- Gombnyomásra a kártya azonnal átáll (optimista). Kapcsolati hibánál a művelet megmarad, „Nincs kapcsolat” sáv jelenik meg, és helyreálláskor magától elküldi. Végleges hibánál (pl. lemondott rendelés) a valós állapot visszaáll, és üzenet jelenik meg.
- Kapcsolatvesztéskor a frissítés 5 → 10 → 20 → 30 mp-es várakozással próbálkozik újra.
- Új rendelés: villogó keret és „Új rendelés!” sáv (érintésre vagy 15 perc után eltűnik), bekapcsolt hangnál csengő. A hang ki-be kapcsolható (süti: `kijelzo_hang`).

## Adatbázis
- Új indexek (0021): `orders (date, status)`, `order_items (order_id)`. Az utóbbi a fő alkalmazás tétel-lekérdezéseit is gyorsítja.
- Terhelés: kijelzőnként napi kb. 10 100 kérés (12 óra × 5 mp = 8 640, plusz 12 óra × 30 mp = 1 440; két kijelzővel kb. 20 000), kérésenként néhány tucat sor olvasása; kényelmesen belefér a Workers (100 000 kérés/nap) és a D1 (5 millió olvasott sor/nap) ingyenes keretébe.

## Eszköz beállítása
A Surface RT beállítását a `scripts/surface-rt/` mappa scriptjei és a `LEIRAS.md` írják le (külön „Konyha” fiók, automatikus bejelentkezés, IE11 kioszk mód).

## Ellenőrző példák
- Kliens-script és az oldal inline scriptjei ES5-ként elemezhetők; a CSS-ben nincs grid és `var()`.
- A felhasználói adatok kódolva kerülnek a HTML-be; a beágyazott beállítás nem zárhatja le a script-blokkot.
- Változatlan adatnál a lista `204`; művelet után új változat.
- `cooking` és `ready` kétszer küldve is `ok`; ismeretlen rendelés → `NOT_FOUND`.
- Belépés Referer/Origin nélkül → 403; művelet `X-Kijelzo` fejléc nélkül → 403; idegen Origin → 403; belépés nélkül → 401.
- Kapcsolat nélkül megnyomott gomb a kapcsolat helyreállása után elküldődik.

## Egyszerűbb fejléc — v52
A fejléc címe „Konyha” (RO: „Bucătărie”), alatta kicsiben a nap dátuma. A bejelentkezett felhasználó neve és a Kilépés gomb nem jelenik meg: a kijelzőn mindig ugyanaz a konyhai fiók van belépve, és a belépés használat közben magától megújul. Belépési űrlap csak akkor jelenik meg, ha a munkamenet mégis megszűnt (pl. a fiókot letiltották vagy új jelszót kapott); a kilépési végpont a szerveren megmaradt, de a felületen nincs rá gomb.
