# Tesztek

## Domain-tesztek (mindig futnak)

```
node --experimental-strip-types --test tests/*.test.mts
```

Adatbázis és szerver nélkül futnak; minden változtatás előtt és után zöldnek kell lenniük.

## API-tesztek (kézzel, a helyi fejlesztői szerver ellen)

A `tests/*-api.mjs` szkriptek a futó helyi szervert (`npm run dev`, http://127.0.0.1:5173) hívják, és **írnak a helyi adatbázisba** (tesztadatok, szerepkörök). Előtte mentsd a `.wrangler/state` mappát, utána állítsd vissza. A legtöbbnek kell a Python is a helyi szerepkör-beállításhoz:

```
KITCHEN_TEST_PYTHON=<python.exe útvonala> node tests/inventory-api.mjs
```

### Állapot (2026-11-03, v71)

| Szkript | Állapot | Megjegyzés |
|---|---|---|
| `inventory-api.mjs` | ✅ átmegy | |
| `purchasing-api.mjs` | ✅ átmegy | |
| `safety-api.mjs` | ✅ átmegy | |
| `fulfillment-api.mjs` | ⚠️ elavult | Idősávokat, irányítószámot és rendelésszám-korlátot vár (megszűnt: v50, v58). Az új szabályokra át kell írni. |
| `portal-api.mjs` | ⚠️ elavult | A régi átvételi bemenetet (`slotId`, `postalCode`) küldi; ma `zoneId` + kívánt időpont. |
| `workflow-api.mjs` | ⚠️ elavult | A régi szabályszerkezetet menti (idősávok); a futár-összekapcsolásra is épít. |
| `menu-api.mjs` | ⚠️ elavult | A napi menü régi szerkezetét (desszert, adagszám) várja (v49–v54). |
| `delivery-api.mjs` | ⚠️ elavult | Futárválasztást és csomagellenőrzést vár (megszűnt: v52–v53). |
| `access-api.mjs` | ⚠️ ellenőrizendő | A jogosultsági lista azóta bővült (pl. számlák); az elvárt értékek frissítendők. |
| `stocktake-api.mjs` | ⚠️ ellenőrizendő | A helyi adatok állapotától is függ. |
| `recurring-api.mjs` | ⚠️ ellenőrizendő | A helyi napi menü adagszámától függ (`MENU_CAPACITY`). |
| `api-smoke.mjs` | ⚠️ ellenőrizendő | Ütközik a helyi adatokkal (409). |

Törölve (megszűnt funkciók): `courier-api.mjs` (futárnyilvántartás és -összekapcsolás, v52), `packing-api.mjs` (csomagellenőrzés, v53).

Az elavult szkripteket az érintett modul következő fejlesztésekor kell az aktuális szabályokra átírni (lásd `FEJLESZTESI-TERV.md`).
