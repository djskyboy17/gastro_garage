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
- Elfelejtett jelszó e-mailben (nincs e-mail-küldő). Addig a tulajdonos új fiókot kérhet a dolgozótól.
- E-mail-cím megerősítése.

## Ellenőrző példák
- Regisztráció → `pending` szerepkör; ugyanaz az e-mail nagybetűvel → `EMAIL_TAKEN`; rövid jelszó → `VALIDATION`.
- Kilépés után `/api/session` → 401; rossz jelszó → `INVALID_LOGIN`; jó jelszó → belép.
- 8 rossz jelszó után → 429.
- Tulajdonosi cím kód nélkül → `OWNER_SETUP_CODE`.
- Nem JSON kérés → 415; idegen origin → 403.
