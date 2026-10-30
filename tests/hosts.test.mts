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
