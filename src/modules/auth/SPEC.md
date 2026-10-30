# Saját bejelentkezés (auth) — v28

## Cél
A ChatGPT Sites fejléceire épülő bejelentkezés helyett saját e-mail + jelszavas fiókok, hogy az alkalmazás bármilyen Cloudflare-fiókon (és más tárhelyen) fusson.

## Adatok
- `auth_users`: id (UUID, ez a `members.user_id` / `portal_profiles.user_id`), e-mail (kisbetűs, egyedi), név, jelszó-kivonat, létrehozás, utolsó jelszócsere.
- `auth_sessions`: a munkamenet-süti SHA-256 lenyomata, felhasználó, lejárat (30 nap).
- `auth_failures`: sikertelen belépések e-mailenként, a korlátozáshoz.

## Szabályok
- Jelszó: legalább 10, legfeljebb 200 karakter. Tárolás PBKDF2-SHA256-tal, 100 000 iteráció, 16 bájtos véletlen só (`pbkdf2$iter$só$kivonat`).
- Süti: `konyha_session`, HttpOnly, SameSite=Lax, https alatt Secure, 30 nap. Az adatbázisban csak a lenyomata van, így egy adatbázis-mentésből nem lehet belépni.
- Belépés: ismeretlen e-mailnél is lefut a jelszó-ellenőrzés (álkivonattal), és ugyanaz a hibaüzenet jön (`INVALID_LOGIN`), így nem derül ki, létezik-e a fiók.
- Korlátozás: 15 percen belül 8 sikertelen belépés után az adott e-mail 15 percig zárolva (`TOO_MANY_ATTEMPTS`). Óránként legfeljebb 200 új regisztráció.
- Tulajdonos: a `KITCHEN_OWNER_EMAIL` címmel csak az `OWNER_SETUP_CODE` titkos kód megadásával lehet regisztrálni. E-mail-megerősítés nincs, ezért enélkül bárki elfoglalhatná a tulajdonosi címet.
- Regisztráció után a fiók „jóváhagyásra vár”. Dolgozói hozzáférést továbbra is a tulajdonos/admin ad, a portálfiók a portálon jön létre (változatlan folyamat).
- Jelszócsere (`/api/auth/password`): a régi jelszóval, utána minden más eszközről kilép.
- Minden `/api/auth/*` kérés csak azonos eredetű JSON lehet.
- Fejlesztés: a helyi szerveren (`import.meta.env.DEV`) a próbafiókok (Seedy, Teszt Futár) fejlécei is elfogadottak; éles buildben ez az ág nincs benne.

## Nincs még benne
- Elfelejtett jelszó e-mailben (nincs e-mail-küldő). Helyette: Google-belépés vagy ideiglenes jelszó a tulajdonostól (v30).
- E-mail-cím megerősítése.

## Ellenőrző példák
- Regisztráció → `pending` szerepkör; ugyanaz az e-mail nagybetűvel → `EMAIL_TAKEN`; rövid jelszó → `VALIDATION`.
- Kilépés után `/api/session` → 401; rossz jelszó → `INVALID_LOGIN`; jó jelszó → belép.
- 8 rossz jelszó után → 429.
- Tulajdonosi cím kód nélkül → `OWNER_SETUP_CODE`.
- Nem JSON kérés → 415; idegen origin → 403.

## v30: Google-belépés, ideiglenes jelszó, erősebb védelem
- Google (OpenID Connect, kódfolyam PKCE-vel): `/api/auth/google/start` → Google → `/api/auth/google/callback`. Az állapot (state) a sütiben és az adatbázisban (`oauth_states`, 10 perc, egyszer használható) is egyezzen; nonce-ellenőrzés; csak megerősített Google e-mail. Az ID-token közvetlenül a Google tokenvégpontjától jön TLS-en (OIDC Core 3.1.3.7), ezért aláírás-letöltés nélkül ellenőrizzük: kibocsátó, címzett, lejárat, nonce.
- Fiók-összekötés: `auth_identities` (`google:<sub>`). Első belépéskor a Google által megerősített e-mail-címmel meglévő fiókhoz köt, különben jelszó nélküli fiókot hoz létre. Jelszóval ilyen fiókba nem lehet belépni, amíg a felhasználó nem ad meg jelszót.
- Beállítás: `GOOGLE_CLIENT_ID` (cloudflare.json, nyilvános) + `GOOGLE_CLIENT_SECRET` (Cloudflare-titok). Ha bármelyik hiányzik, a gomb nem jelenik meg.
- Ideiglenes jelszó (`/api/auth/admin-reset`): tulajdonos vagy admin ad, a tulajdonosnak és saját magának nem. A jelszó csak a válaszban látszik egyszer; a fiók minden munkamenete megszűnik, és `must_change_password=1`. Amíg nincs új jelszó, csak a `/api/session` és a `/api/auth/*` érhető el (`PASSWORD_CHANGE_REQUIRED`).
- Gyenge jelszó tiltása (`PASSWORD_WEAK`): gyakori jelszó, egy karakter ismétlése, rövid számsor, az e-mail neve benne, 4-nél kevesebb különböző karakter. Új jelszó nem lehet a régi (`PASSWORD_SAME`).
- IP-alapú korlát is: egy címről 15 percen belül 30 sikertelen belépés után zárol (`cf-connecting-ip`).
- Napló: `login` (password/google), `password_reset`, `password_changed`, `account_created`.
- Biztonsági fejlécek minden válaszon: `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, https alatt HSTS (aldomainek nélkül).
