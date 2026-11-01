import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node native type stripping
import { splitSetPrice, groupSetItems, portionUnit, SET_GROUP } from "../src/modules/shared/domain.ts";
// @ts-ignore Node native type stripping
import { menuSetError } from "../src/modules/menu/domain.ts";

test("menüár szétosztása: a három rész összege mindig pontosan a menüár", () => {
  for (const price of [0, 1, 2, 3500, 3999, 4000, 4001, 123457]) {
    const parts = splitSetPrice(price);
    assert.equal(parts.reduce((a, b) => a + b, 0), price, String(price));
    assert.ok(parts.every((p) => Number.isInteger(p) && p >= 0));
  }
  assert.deepEqual(splitSetPrice(4000), [1334, 1333, 1333]);
});

test("rendelési tételek: a napi menü egy sorba vonva, a menüárral; a többi tétel változatlan", () => {
  const [s, m, d] = splitSetPrice(3500);
  const items = [
    { id: "a", setGroup: SET_GROUP, quantity: 3, price: s },
    { id: "b", setGroup: SET_GROUP, quantity: 3, price: m },
    { id: "c", setGroup: SET_GROUP, quantity: 3, price: d },
    { id: "x", setGroup: "", quantity: 2, price: 1800 },
  ];
  const lines = groupSetItems(items);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]!.kind, "set");
  if (lines[0]!.kind === "set") {
    assert.equal(lines[0].quantity, 3);
    assert.equal(lines[0].total, 3 * 3500);
  }
  assert.deepEqual(lines[1], { kind: "item", item: items[3] });
  // Menü nélkül minden sor külön marad (régi rendelések: setGroup nincs).
  assert.deepEqual(groupSetItems([{ id: "y", quantity: 1, price: 5 }]), [{ kind: "item", item: { id: "y", quantity: 1, price: 5 } }]);
});

test("mértékegység: levesnél ml, minden másnál g", () => {
  assert.equal(portionUnit("soup"), "ml");
  for (const c of ["main", "vegetarian", "dessert"]) assert.equal(portionUnit(c), "g");
});

test("napi menü ellenőrzése: Napi menü rész, megfelelő kategória, aktív, rajta van a nap étlapján", () => {
  const products = [
    { id: "s", category: "soup", section: "daily", active: 1 },
    { id: "m", category: "main", section: "daily", active: 1 },
    { id: "d", category: "dessert", section: "daily", active: 1 },
    { id: "m2", category: "main", section: "alacarte", active: 1 },
    { id: "d0", category: "dessert", section: "daily", active: 0 },
  ];
  const set = { soupId: "s", mainId: "m", dessertId: "d" };
  assert.equal(menuSetError(set, products, ["s", "m", "d"]), null);
  assert.equal(menuSetError({ ...set, mainId: "m2" }, products, ["s", "m2", "d"]), "MENU_SET_PRODUCT");
  assert.equal(menuSetError({ ...set, mainId: "s" }, products, ["s", "d"]), "MENU_SET_PRODUCT");
  assert.equal(menuSetError({ ...set, dessertId: "d0" }, products, ["s", "m", "d0"]), "MENU_SET_PRODUCT");
  assert.equal(menuSetError(set, products, ["s", "m"]), "MENU_SET_NOT_ON_MENU");
});
