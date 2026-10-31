# Konyhai kijelző Surface RT-n

Első generációs Surface RT (Windows RT 8.1) beállítása konyhai kijelzőnek. A gép bekapcsoláskor egy külön **Konyha** fiókkal automatikusan bejelentkezik, és teljes képernyőn (kioszk módban) megnyitja a `https://konyha.veres.no/kijelzo` oldalt.

Windows RT 8.1-en a PowerShell korlátozott módban fut, ezért a beállítás egyszerű `.bat` fájlokkal megy (`reg`, `net`, `powercfg`, `tzutil`).

## Mielőtt elkezded

1. **Dolgozói fiók a kijelzőhöz.** A fő alkalmazásban (Beállítások → Hozzáférés) legyen egy **konyha** szerepkörű dolgozói fiók, amellyel a kijelzőre belépsz. Ajánlott egy külön fiók (például `kijelzo@…`), hogy kilépéskor vagy elvesztéskor csak ezt kelljen letiltani. Ideiglenes jelszóval nem lehet belépni: előbb a fő alkalmazásban adj meg végleges jelszót.
2. **Saját rendszergazdai fiók a Surface-en.** Ezzel futtatod a beállítást, és ezzel lépsz be később karbantartáshoz.
3. **Hálózat.** A Surface legyen a konyhai Wi-Fi-n, és a „Csatlakozás automatikusan” legyen bekapcsolva.
4. **Töltő.** A kijelző folyamatosan be lesz kapcsolva, ezért a Surface maradjon töltőn.

## Telepítés

1. Másold a `scripts/surface-rt` mappa tartalmát pendrive-ra, majd a Surface-en egy mappába, például `C:\Telepites`:
   - `konyha-kijelzo-beallitas.bat`
   - `kijelzo-indito.bat`
   - `kijelzo-indito.vbs`
   - `kijelzo-visszaallitas.bat`
2. Lépj be a saját rendszergazdai fiókoddal.
3. A `konyha-kijelzo-beallitas.bat` fájlon: hosszan nyomva (vagy jobb klikk) → **Futtatás rendszergazdaként**.
4. Kérésre add meg a **Konyha** fiók jelszavát. Csak betűk és számok lehetnek benne, legalább 8 karakter. Ez a Windows-fiók jelszava, nem a konyhai alkalmazásé.
5. Az időzóna Bukarestre állítására `i`-vel válaszolj, ha a gép még nem erre van állítva.
6. Az újraindításra `i`-vel válaszolj.
7. Újraindulás után a gép magától belép, és megnyílik a kijelző belépési oldala. **Egyszer** lépj be a konyhai dolgozói fiókkal (lásd az 1. pontot).
8. Fent válaszd ki a nyelvet (HU/RO), és ha kell, a hangjelzést (Hang: be/ki). Mindkettő megmarad.

Ezután a kijelző magától fut. A belépés 30 napig érvényes, és amíg a kijelző használatban van, magától meghosszabbodik.

## Mit állít be a script

| Beállítás | Hogyan |
|---|---|
| Külön „Konyha” helyi fiók (normál felhasználó, nem rendszergazda) | `net user` |
| Automatikus bejelentkezés | `Winlogon` rendszerleíró kulcsok (`AutoAdminLogon`, `DefaultUserName`, `DefaultPassword`) |
| IE11 kioszk módban, bejelentkezéskor | `HKLM\…\Run` → `C:\Konyha\kijelzo-indito.vbs`; csak a Konyha fiókban fut |
| Az IE újraindítása, ha bezáródik vagy összeomlik | `kijelzo-indito.bat` ciklusa (10 mp-enként ellenőriz) |
| Indításkor megvárja a hálózatot | `ping konyha.veres.no`, legfeljebb kb. 3 percig |
| Képernyő soha ne kapcsoljon ki, a gép ne aludjon el | `powercfg` (hálózatról és akkuról is) |
| Ébredéskor ne kérjen jelszót, ne legyen zárolási képernyő | `CONSOLELOCK 0`, `NoLockScreen` |
| Frissítés után ne induljon újra magától, amíg valaki be van jelentkezve | `NoAutoRebootWithLoggedOnUsers` |
| Ne jelenjenek meg felugró értesítések és Műveletközpont-üzenetek | `ToastEnabled=0`, `HideSCAHealth` |
| IE: első indítási varázsló, jelszómentés, alapértelmezett böngésző és „lapok visszaállítása” kérdések kikapcsolva | IE szabályzat és felhasználói beállítások |
| Képernyőszéli húzások korlátozása | `EdgeUI` szabályzatok és a sarkok kikapcsolása |
| Képernyővédő ki, bejelentkezés után az asztal jön (nem a Start képernyő) | felhasználói beállítás (`kijelzo-indito.bat`) |

## Korlátok (fontos)

- **Képernyőszéli húzások:** Windows RT 8.1-en az érintős széli húzást (jobbról a gombsáv, balról az alkalmazásváltó) nem lehet teljesen letiltani. Ez a lehetőség csak újabb Windowson van meg. A script kikapcsolja, amit lehet (egérsarkok, súgó, gombsáv-tipp). Ha valaki kilép a kijelzőből, legfeljebb 10 másodpercen belül újra elindul.
- **Jelszó a rendszerleíró adatbázisban:** az automatikus bejelentkezéshez a Konyha fiók jelszava olvasható formában a `Winlogon` kulcsba kerül. Csak rendszergazda olvashatja. Ezt a jelszót ne használd máshol. (A Sysinternals Autologon titkosítva tárolná, de ARM-on nem fut.)
- **Fizikai hozzáférés:** aki a kijelzőhöz fér, az a konyhai műveleteket (Folyamatban / Elkészült) el tudja végezni. Ezért a kijelzőn a konyhai dolgozói fiók legyen, ne adminisztrátori.
- **Windows-frissítések:** a Windows RT 8.1 támogatása 2023-ban megszűnt, új biztonsági frissítés nem jön. A Surface csak a konyhai kijelzőt futtassa, mást ne használjatok rajta.

## Napi használat

- **Folyamatban:** elkezdtétek a rendelést. A kártya sárgára vált.
- **Elkészült:** minden tétel kész. A kártya lekerül az alsó „Elkészült ma” részbe, és a rendelés csomagolható.
- **Új rendelés:** villogó keret, felül „Új rendelés!” sáv, bekapcsolt hangnál csengő. Érintésre eltűnik.
- **Nincs kapcsolat:** piros sáv jelenik meg. A gombnyomások nem vesznek el, a kapcsolat helyreállásakor elküldődnek.
- **Késésben:** piros keretes kártya. Előző napi, még el nem készült rendelés (legfeljebb 2 napra visszamenőleg).

## Karbantartás

- **Kilépés a kioszk módból:** karbantartáshoz csatlakoztasd a Touch/Type Cover billentyűzetet. `Ctrl+Alt+Del` → Kijelentkezés, és közben tartsd lenyomva a **Shift** billentyűt, amíg a bejelentkezési képernyő meg nem jelenik. Shift nélkül az automatikus bejelentkezés miatt a gép azonnal visszalép a Konyha fiókba. Utána válaszd a saját fiókodat.
- **Másik konyhai fiók a kijelzőn:** a kijelzőn a „Kilépés” gomb, majd belépés az új fiókkal.
- **Az eredeti állapot visszaállítása:** `kijelzo-visszaallitas.bat` rendszergazdaként. Kikapcsolja az automatikus bejelentkezést, törli a jelszót a rendszerleíró adatbázisból, és visszaállítja az energiagazdálkodást. Kérésre a Konyha fiókot is törli.
- **Elveszett vagy ellopott Surface:** a fő alkalmazásban tiltsd le a kijelző dolgozói fiókját (Hozzáférés → Letiltva), vagy adj neki új jelszót. A régi belépés így azonnal érvénytelen lesz.
