# Konyha (kitchen) — SPEC

## Cél
A konyhai terv ételenként mutatja, mennyi adag van még hátra az aznapi visszaigazolt rendelésekből, és a konyha egy nagy „Kész” gombbal jelöli, ha egy étel elkészült.

## Szabályok
- Egy rendelési tétel kész, ha `order_items.ready = 1`, vagy ha az egész rendelés gyártási állapota `ready`.
- A kártya nagy száma a még elkészítendő adag; mellette „kész / összes”.
- A „Kész” gomb (`POST /api/kitchen/ready`, `{itemIds}`) az étel összes még nem kész tételét jelöli késznek az adott nap visszaigazolt, még nem kész rendeléseiben.
- Ha egy rendelés minden tétele kész, a rendelés `production` állapota `ready` lesz, így csomagolható és kiküldhető. Ha csak egy része, `queued` → `cooking`.
- Jogosultság: tulajdonos, admin, konyha. Ismételt kattintás nem okoz hibát (a már kész tétel nem változik).
- A tételek, a rendelésállapot és a napló (`kitchen_items_ready`) egy tranzakcióban változik.
- Visszavonás egyelőre nincs: tévedés esetén a rendelés részleteinél kezelhető.

## Ellenőrző példák
- 3 rendelésből az egyikben 6 bulgur: „Kész” után a bulgur 0 hátralévő, a rendelés „készül”.
- Ugyanennek a rendelésnek a többi ételét is késznek jelölve a rendelés „kész”.
- Diszpécser, raktár, futár nem jelölhet.
