import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node native type stripping
import { startRedirect } from "../src/modules/shared/hosts.ts";
const hosts = { portal: "gastrogarage.veres.no", courier: "courier.veres.no" };
test("Each subdomain opens its own start page", () => {
  assert.equal(startRedirect("gastrogarage.veres.no", "/", hosts), "/portal");
  assert.equal(startRedirect("Courier.Veres.no", "/", hosts), "/courier");
  assert.equal(startRedirect("konyha.veres.no", "/", hosts), null);
  // Csak a gyökér irányít át; a többi útvonal (API, belépés) változatlan.
  assert.equal(startRedirect("gastrogarage.veres.no", "/signin", hosts), null);
  assert.equal(startRedirect("gastrogarage.veres.no", "/api/session", hosts), null);
  // Helyi fejlesztés: nincs beállított cím, nincs átirányítás.
  assert.equal(startRedirect("localhost:5173", "/", {}), null);
});

// @ts-ignore Node native type stripping
import { hostRedirect, parseRedirects } from "../src/modules/shared/hosts.ts";
test("v81: old and www addresses move to the final domain, keeping path and query", () => {
  const map = parseRedirects(JSON.stringify({ "www.gastrogarage.ro": "gastrogarage.ro", "Konyha.Veres.no": "konyha.gastrogarage.ro" }));
  assert.deepEqual(hostRedirect(new URL("https://www.gastrogarage.ro/portal?x=1#a"), "GET", map), { location: "https://gastrogarage.ro/portal?x=1", status: 301 });
  assert.deepEqual(hostRedirect(new URL("https://konyha.veres.no/api/orders"), "POST", map), { location: "https://konyha.gastrogarage.ro/api/orders", status: 308 });
  assert.equal(hostRedirect(new URL("https://gastrogarage.ro/"), "GET", map), null);
  assert.equal(hostRedirect(new URL("http://localhost:5173/"), "GET", map), null);
  assert.deepEqual(parseRedirects("nem json"), {});
  assert.deepEqual(parseRedirects(JSON.stringify({ "a.ro": "https://evil.example/x" })), {}, "only bare host names are accepted as targets");
});
