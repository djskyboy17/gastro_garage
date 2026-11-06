# Biztonsági mentés (v96, v97)

- v97 (a tulajdonos döntése): **nincs automatikus mentés.** Könyvelés → Biztonsági mentések → „Mentés letöltése most”: a teljes D1-adatbázis azonnal SQL-fájlként letöltődik (`/api/backups/download`), a szerveren nem tárolódik. Csak tulajdonos és admin; naplózva (`backup_downloaded`).
- A korábban (v96) a szerveren tárolt mentések listája megmarad és letölthető (`/api/backups/file`); ezek 10 évig maradnak meg.
- A számviteli bizonylatok ettől függetlenül az Archívumban vannak (R2, egyszer írható, törlés nélkül), legalább 10 évig.
- A fájl tartalma: `PRAGMA defer_foreign_keys`, a triggerek eltávolítása, táblánként `DELETE` + `INSERT`, végül a triggerek visszaállítása; a fejlécben az utolsó migráció neve.
- Visszatöltés (fejlesztő): ugyanazon a migráción álló adatbázisba `wrangler d1 execute <db> --remote --file=<fájl>`, előtte friss mentés és time-travel könyvjelző. Az alkalmazásban nincs visszatöltő gomb.
