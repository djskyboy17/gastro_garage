# Telepítés Cloudflare-re (ingyenes csomag)

Az alkalmazás Cloudflare Workers + D1 adatbázison fut. Az ingyenes csomag egy konyhának bőven elég (napi kb. 100 000 kérés, 5 GB adatbázis).

## Jelenlegi címek

- Ügyfélrendelés: https://gastrogarage.veres.no (a portálra visz)
- Konyhai munkatér: https://konyha.veres.no
- Futár: https://courier.veres.no (a futároldalra visz)

A címeket a `cloudflare.json` `domains` része adja meg; a `cf:deploy` hozza létre a DNS-rekordot és a tanúsítványt. Meglévő DNS-rekordot nem ír felül.

## Egyszer kell

1. Hozz létre ingyenes fiókot: https://dash.cloudflare.com/sign-up
2. A projekt mappájában (`D:\gastro_garage`) lépj be a Cloudflare-fiókodba. Megnyílik a böngésző, ott hagyd jóvá:

   ```
   npx.cmd wrangler login
   ```

3. Adatbázis létrehozása (a `cloudflare.json` fájlba beíródik az azonosítója):

   ```
   npm.cmd run cf:setup
   ```

4. Táblák létrehozása az éles adatbázisban:

   ```
   npm.cmd run cf:migrate
   ```

5. Feltöltés:

   ```
   npm.cmd run cf:deploy
   ```

   Az első feltöltésnél a Cloudflare kérhet egy `workers.dev` aldomain-nevet. A végén kiírja a címet, például `https://konyha.<neved>.workers.dev`.

6. Titkok beállítása: a tulajdonos e-mail-címe és egy hosszú, véletlen beállítókód. Ezt a kódot csak te ismerd, a regisztrációnál kell majd:

   ```
   npm.cmd run cf:secrets
   ```

7. Nyisd meg a címet, válaszd a **Regisztráció** fület, add meg a tulajdonosi e-mail-címet, pipáld be a **Tulajdonosként regisztrálok** mezőt, és írd be a beállítókódot. Ezután a „Dolgozói hozzáférés” oldalon kattints a tulajdonosi indításra.

## Később, minden módosítás után

```
npm.cmd run cf:migrate
npm.cmd run cf:deploy
```

A `cf:migrate` csak az új adatbázis-változásokat futtatja le; ha nincs új, nem csinál semmit.

## Jó tudni

- Az éles adatbázis üresen indul. A helyi gépen lévő próbaadatok nem kerülnek fel.
- A dolgozók és az ügyfelek a belépőoldalon regisztrálnak, utána a tulajdonos ad nekik szerepkört (Beállítások → Dolgozói hozzáférés).
- Saját domain (például `rendeles.konyha.ro`) a Cloudflare felületén köthető be: Workers & Pages → konyha → Settings → Domains & Routes.
- Mentés az éles adatbázisról: `npx.cmd wrangler d1 export konyha-db --remote --output mentes.sql`
- Elfelejtett jelszó e-mailes visszaállítása még nincs. Ha egy dolgozó elfelejti a jelszavát, regisztráljon új fiókot, és add meg neki újra a szerepkört.
