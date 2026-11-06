/** Biztonsági mentés (v96) – magyar és román feliratok. */
export const backupMessages = {
  hu: {
    backups: "Biztonsági mentések",
    bookkeepingAbout_backups: "Hetente automatikus adatbázis-mentés, letölthető.",
    backupIntro: "A rendszer minden hétfőn hajnalban automatikusan elmenti a teljes adatbázist a szerverre. Az utolsó 12 mentés marad meg; bármelyik letölthető, és baj esetén visszatölthető.",
    backupNow: "Mentés most",
    backupRunning: "Mentés folyamatban…",
    backupDone: "A mentés elkészült.",
    backupNone: "Még nincs mentés.",
    backupDownload: "Letöltés",
    backupRestoreHint: "Visszatöltés: a letöltött fájlt a fejlesztő tölti vissza a rendszerbe (Cloudflare, wrangler). Ezen felül a Cloudflare az elmúlt napok (csomagtól függően 7–30 nap) bármely pillanatára is vissza tudja állítani az adatbázist.",
    backup_created: "Biztonsági mentés készült",
    backup_downloaded: "Biztonsági mentés letöltve",
  },
  ro: {
    backups: "Copii de siguranță",
    bookkeepingAbout_backups: "Copie automată săptămânală a bazei de date, descărcabilă.",
    backupIntro: "Sistemul salvează automat întreaga bază de date pe server în fiecare luni dimineața. Se păstrează ultimele 12 copii; oricare poate fi descărcată și, la nevoie, restaurată.",
    backupNow: "Salvează acum",
    backupRunning: "Se salvează…",
    backupDone: "Copia de siguranță a fost creată.",
    backupNone: "Nu există încă nicio copie.",
    backupDownload: "Descarcă",
    backupRestoreHint: "Restaurare: fișierul descărcat este reîncărcat în sistem de dezvoltator (Cloudflare, wrangler). În plus, Cloudflare poate readuce baza de date la orice moment din ultimele zile (7–30 de zile, în funcție de plan).",
    backup_created: "Copie de siguranță creată",
    backup_downloaded: "Copie de siguranță descărcată",
  },
} as const;
