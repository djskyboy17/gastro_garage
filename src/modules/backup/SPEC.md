# Biztonsági mentés (v96)

- Hétfőnként 02:00 UTC-kor (cron `0 2 * * 1`) és a „Mentés most” gombbal a teljes D1-adatbázis SQL-fájlként a privát R2-tárolóba kerül (`backups/ÉÉÉÉ/backup-….sql`). Az utolsó 12 marad meg.
- Hozzáférés: Könyvelés → Biztonsági mentések, csak tulajdonos és admin. Letöltés naplózva (`backup_downloaded`), készítés: `backup_created`.
- A fájl tartalma: `PRAGMA defer_foreign_keys`, a triggerek eltávolítása, táblánként `DELETE` + `INSERT`, végül a triggerek visszaállítása. A fejlécben az utolsó migráció neve.
- Visszatöltés (fejlesztő): ugyanazon a migráción álló adatbázisba `wrangler d1 execute <db> --remote --file=<fájl>`. Előtte friss mentés és time-travel könyvjelző. Az alkalmazásban nincs visszatöltő gomb (véletlen felülírás ellen).
