# Konyhai kijelző (display) — v47

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
- Visszaigazolt rendelések: a mai nap összes rendelése, valamint a legfeljebb 2 napos, még nem kész („Késésben”) rendelések.
- Felül ételenként a még elkészítendő adagok összesítése.
- Nyitott rendelések kártyán: idő, kód, kiszállítás / helyszíni átvétel, ügyfél, tételek (darab, név, allergének, kész-jelölés), megjegyzés, két nagy gomb: **Folyamatban** és **Elkészült**.
- Alul a ma elkészült rendelések kisebb kártyán, gomb nélkül.
- A konyha a v41 óta a rendelési adatokat teljes egészében látja; a kijelző ennél kevesebbet mutat (ár, cím, telefon nincs).

## Műveletek
- **Folyamatban**: gyártás megkezdése (queued → cooking), `kitchen.startCooking`. Ugyanaz az állapotszabály (`nextState`) és naplóbejegyzés (`state_changed`), mint a fő alkalmazásban. Ha már készül vagy kész, nem változtat (ismételve is biztonságos).
- **Elkészült**: a rendelés minden még nem kész tétele kész, a rendelés `ready` lesz (`kitchen.markOrderReady` → `markItemsReady`, ugyanaz, mint a fő alkalmazás „Kész” gombja). Ismételve is biztonságos.

## Kliens (IE11)
- Csak ES5: `XMLHttpRequest`, `var`, `function`; nincs `fetch`, Promise, nyílfüggvény, `let`/`const`, modul. CSS: flexbox (`-ms-` előtaggal is), nincs grid és CSS-változó. A teszt az acornnal ES5-ként elemzi a scriptet.
- Frissítés 20 mp-enként, csak a lista rész cseréje; változatlan adatnál a szerver `204`-et ad. A „változott-e?” ellenőrzés ugyanazokat a rendeléseket olvassa indexen (`orders_date_status`), a tételekből csak összesítést (`order_items_order`).
- Gombnyomásra a kártya azonnal átáll (optimista). Kapcsolati hibánál a művelet megmarad, „Nincs kapcsolat” sáv jelenik meg, és helyreálláskor magától elküldi. Végleges hibánál (pl. lemondott rendelés) a valós állapot visszaáll, és üzenet jelenik meg.
- Kapcsolatvesztéskor a frissítés 5 → 10 → 20 → 30 mp-es várakozással próbálkozik újra.
- Új rendelés: villogó keret és „Új rendelés!” sáv (érintésre vagy 15 perc után eltűnik), bekapcsolt hangnál csengő. A hang ki-be kapcsolható (süti: `kijelzo_hang`).

## Adatbázis
- Új indexek (0021): `orders (date, status)`, `order_items (order_id)`. Az utóbbi a fő alkalmazás tétel-lekérdezéseit is gyorsítja.
- Terhelés: 1–2 kijelző, 20 mp-es frissítés mellett kérésenként néhány tucat sor olvasása; kényelmesen belefér a Workers/D1 ingyenes keretébe.

## Eszköz beállítása
A Surface RT beállítását a `scripts/surface-rt/` mappa scriptjei és a `LEIRAS.md` írják le (külön „Konyha” fiók, automatikus bejelentkezés, IE11 kioszk mód).

## Ellenőrző példák
- Kliens-script és az oldal inline scriptjei ES5-ként elemezhetők; a CSS-ben nincs grid és `var()`.
- A felhasználói adatok kódolva kerülnek a HTML-be; a beágyazott beállítás nem zárhatja le a script-blokkot.
- Változatlan adatnál a lista `204`; művelet után új változat.
- `cooking` és `ready` kétszer küldve is `ok`; ismeretlen rendelés → `NOT_FOUND`.
- Belépés Referer/Origin nélkül → 403; művelet `X-Kijelzo` fejléc nélkül → 403; idegen Origin → 403; belépés nélkül → 401.
- Kapcsolat nélkül megnyomott gomb a kapcsolat helyreállása után elküldődik.
