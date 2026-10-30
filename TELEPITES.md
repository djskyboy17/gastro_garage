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
- Elfelejtett jelszó: lásd lent („Elfelejtett jelszó” rész); e-mailes visszaállítás még nincs.

## Google-belépés bekapcsolása (egyszer, kb. 10 perc)

1. Nyisd meg: https://console.cloud.google.com és lépj be a Google-fiókoddal.
2. Fent a projektválasztóban: **New project** → név: `Konyha` → **Create**.
3. Bal menü: **APIs & Services → OAuth consent screen** (vagy **Google Auth Platform**) → **Get started**:
   - App name: `Konyha`, User support email: a te címed;
   - Audience: **External**;
   - Contact information: a te címed → **Create**.
4. **Audience** fülön kattints a **Publish app** gombra (így bárki beléphet, nem csak a tesztfelhasználók). Mivel csak nevet és e-mail-címet kérünk, Google-ellenőrzés nem kell.
5. **Clients → Create client**:
   - Application type: **Web application**, név: `Konyha web`;
   - **Authorized JavaScript origins**:
     - `https://konyha.veres.no`
     - `https://gastrogarage.veres.no`
     - `https://courier.veres.no`
   - **Authorized redirect URIs**:
     - `https://konyha.veres.no/api/auth/google/callback`
     - `https://gastrogarage.veres.no/api/auth/google/callback`
     - `https://courier.veres.no/api/auth/google/callback`
   - **Create**.
6. A felugró ablakban két érték van:
   - **Client ID** (…apps.googleusercontent.com): ez nem titok, írd be a `cloudflare.json` `googleClientId` mezőjébe (vagy küldd el Claude-nak);
   - **Client secret**: ez titok. A projekt mappájában futtasd, és illeszd be, amikor kéri:

     ```
     npm.cmd run cf:google
     ```

7. Feltöltés: `npm.cmd run cf:deploy`. A belépőoldalon megjelenik a **Belépés Google-fiókkal** gomb.

## Elfelejtett jelszó

- Aki Google-lel lép be, annak nincs jelszava, amit elfelejthetne. Ha jelszóval regisztrált, de Gmail-címmel, a Google-gombbal is be tud lépni ugyanabba a fiókba.
- Dolgozónak: **Beállítások → Dolgozói hozzáférés → Ideiglenes jelszó**. Ügyfélnek: **Ügyfélportál → fiókok → Ideiglenes jelszó**. A kapott jelszót add át neki; első belépéskor saját jelszót kell megadnia. A régi jelszava és minden belépése azonnal megszűnik.
- Saját jelszó cseréje: **Beállítások → Jelszó módosítása** (a portálon a fejlécben).
