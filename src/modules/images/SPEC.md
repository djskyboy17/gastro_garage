# Ételképek (images) — v23

## Cél
Az ételkatalógusban minden ételhez egy kép tölthető fel; a kép a katalógus kártyáján és az ügyfélportál étlapján is megjelenik.

## Szabályok
- Feltöltés, csere és törlés: tulajdonos, admin, diszpécser (`/api/products/image`, `/api/products/image/remove`).
- A böngésző feltöltés előtt legfeljebb 1200 px-re kicsinyíti a képet és WebP-be (ha nem megy, JPG-be) menti; a szerver legfeljebb 600 000 bájtot fogad el.
- A szerver a fájl tartalma alapján ellenőriz: csak JPG, PNG vagy WebP mehet át (SVG/HTML nem).
- A kép a D1 adatbázisban van (`product_images`, base64), külön tárhely (R2) nélkül. Ha sok vagy nagy kép lesz, R2-re érdemes átköltöztetni.
- `products.image_revision` minden feltöltésnél és törlésnél nő, soha nem csökken; ez a kép URL-jének verziója (`?v=`), így új kép sosem jön régi gyorsítótárból. `products.has_image` mutatja, van-e kép.
- Revízióellenőrzés: elavult revízióval érkező kérés `CONFLICT`. Kép, termék és napló (`product_image_saved` / `product_image_removed`) egy tranzakcióban.
- Kiszolgálás (`GET /api/products/image?id=&v=`): aktív étel képe bejelentkezés nélkül is elérhető (v27 óta a portálon minden étlapra tett aktív étel látszik), egy évig gyorsítótárazható; a többi csak dolgozónak, rövid privát gyorsítótárral. `nosniff` és `default-src 'none'` fejléc.
- A rendelésekben nincs kép-pillanatkép: a kép csak a katalógus és az étlap része.

## Ellenőrző példák
- 2400×1600-as PNG feltöltése → 1200×800-as WebP, megjelenik a katalógusban és a portálon.
- Képnek álcázott SVG → `IMAGE_FORMAT`; túl nagy fájl → `IMAGE_TOO_LARGE`.
- Konyha, raktár, futár nem tölthet fel.
- Törlés után a régi URL 404, a kártyán újra a díszítés látszik.
