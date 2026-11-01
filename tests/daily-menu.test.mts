import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node native type stripping
import { splitSetPrice, groupSetItems, portionUnit, SET_GROUP, DAILY_CATEGORIES } from "../src/modules/shared/domain.ts";
// @ts-ignore Node native type stripping
import { menuSetError, remaining, isUnlimited, UNLIMITED } from "../src/modules/menu/domain.ts";

test("menüár szétosztása (v54, leves + főétel): a két rész összege mindig pontosan a menüár", () => {
  for (const price of [0, 1, 2, 3, 3500, 3999, 4001, 123457]) {
    const parts = splitSetPrice(price);
    assert.equal(parts.length, 2);
    assert.equal(parts.reduce((a, b) => a + b, 0), price, String(price));
    assert.ok(parts.every((p) => Number.isInteger(p) && p >= 0));
  }
  assert.deepEqual(splitSetPrice(3501), [1751, 1750]);
});

test("rendelési tételek: a napi menü egy sorba vonva, a menüárral; a többi tétel változatlan", () => {
  const [s, m] = splitSetPrice(3500);
  const items = [
    { id: "a", setGroup: SET_GROUP, quantity: 3, price: s },
    { id: "b", setGroup: SET_GROUP, quantity: 3, price: m },
    { id: "x", setGroup: "", quantity: 2, price: 1800 },
  ];
  const lines = groupSetItems(items);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]!.kind, "set");
  if (lines[0]!.kind === "set") {
    assert.equal(lines[0].quantity, 3);
    assert.equal(lines[0].total, 3 * 3500);
  }
  assert.deepEqual(lines[1], { kind: "item", item: items[2] });
  // Menü nélkül minden sor külön marad (régi rendelések: setGroup nincs).
  assert.deepEqual(groupSetItems([{ id: "y", quantity: 1, price: 5 }]), [{ kind: "item", item: { id: "y", quantity: 1, price: 5 } }]);
});

test("mértékegység: levesnél ml, minden másnál g", () => {
  assert.equal(portionUnit("soup"), "ml");
  for (const c of ["main", "vegetarian", "dessert"]) assert.equal(portionUnit(c), "g");
});

test("napi menü ellenőrzése (v54): csak leves + főétel, Napi menü rész, aktív, rajta van a nap étlapján", () => {
  assert.deepEqual([...DAILY_CATEGORIES], ["soup", "main"]);
  const products = [
    { id: "s", category: "soup", section: "daily", active: 1 },
    { id: "m", category: "main", section: "daily", active: 1 },
    { id: "m2", category: "main", section: "alacarte", active: 1 },
    { id: "m0", category: "main", section: "daily", active: 0 },
  ];
  const set = { soupId: "s", mainId: "m" };
  assert.equal(menuSetError(set, products, ["s", "m"]), null);
  assert.equal(menuSetError({ ...set, mainId: "m2" }, products, ["s", "m2"]), "MENU_SET_PRODUCT");
  assert.equal(menuSetError({ ...set, mainId: "s" }, products, ["s"]), "MENU_SET_PRODUCT");
  assert.equal(menuSetError({ ...set, mainId: "m0" }, products, ["s", "m0"]), "MENU_SET_PRODUCT");
  assert.equal(menuSetError(set, products, ["s"]), "MENU_SET_NOT_ON_MENU");
});

test("korlátlan adag (v54): a maradék korlátlan marad, a korlátozott a foglalással csökken", () => {
  assert.equal(isUnlimited(UNLIMITED), true);
  assert.equal(isUnlimited(UNLIMITED - 1), false);
  assert.equal(remaining(UNLIMITED, 40), UNLIMITED);
  assert.equal(remaining(30, 4), 26);
  assert.equal(remaining(3, 5), 0);
});
