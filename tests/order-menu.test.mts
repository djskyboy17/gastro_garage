import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Native Node type stripping
import { expandOrderMenu } from "../src/modules/menu/order-menu.ts";
// @ts-ignore Native Node type stripping
import { SET_CART_ID, SET_GROUP, type Product } from "../src/modules/shared/domain.ts";
const product = (id: string, category: string, section = "daily", price = 9000): Product => ({ id, hu: id, ro: id, category, section, price, portion: 300, active: 1, descriptionHu: "", descriptionRo: "", allergens: "" });
const catalog = [product("soup", "soup"), product("main", "main"), product("cake", "dessert", "alacarte", 750)];
const menu = { soupId: "soup", mainId: "main", price: 3501, lineIds: ["soup", "main"] };

test("Staff daily menu uses its server-side price and expands into two recipe-bearing items", () => {
  const lines = expandOrderMenu([{ productId: SET_CART_ID, quantity: 2 }, { productId: "cake", quantity: 1 }], catalog, menu);
  assert.deepEqual(lines, [{ productId: "soup", quantity: 2, price: 1751, setGroup: SET_GROUP }, { productId: "main", quantity: 2, price: 1750, setGroup: SET_GROUP }, { productId: "cake", quantity: 1, price: 750, setGroup: "" }]);
  assert.equal(lines.reduce((sum, line) => sum + line.price * line.quantity, 0), 7752);
  assert.equal(catalog[0].price, 9000);
});
test("Existing individual-item ordering keeps catalog prices without needing menu data", () => {
  assert.deepEqual(expandOrderMenu([{ productId: "soup", quantity: 3 }], catalog, null), [{ productId: "soup", quantity: 3, price: 9000, setGroup: "" }]);
});
test("Missing or invalid menu definitions cannot create a substituted daily menu", () => {
  assert.throws(() => expandOrderMenu([{ productId: SET_CART_ID, quantity: 1 }], catalog, null), /MENU_SET_UNAVAILABLE/);
  assert.throws(() => expandOrderMenu([{ productId: SET_CART_ID, quantity: 1 }], catalog, { ...menu, lineIds: ["main"] }), /MENU_SET_UNAVAILABLE/);
  assert.throws(() => expandOrderMenu([{ productId: SET_CART_ID, quantity: 1 }], catalog, { ...menu, mainId: "cake" }), /MENU_SET_UNAVAILABLE/);
});
test("A menu and its component cannot be charged twice; quantities and expanded size are bounded", () => {
  assert.throws(() => expandOrderMenu([{ productId: SET_CART_ID, quantity: 1 }, { productId: "soup", quantity: 1 }], catalog, menu), /INVALID_ITEM/);
  assert.throws(() => expandOrderMenu([{ productId: SET_CART_ID, quantity: 0 }], catalog, menu), /INVALID_ITEM/);
  const extras = Array.from({ length: 49 }, (_, index) => product("extra" + index, "dessert", "alacarte"));
  assert.throws(() => expandOrderMenu([{ productId: SET_CART_ID, quantity: 1 }, ...extras.map((product) => ({ productId: product.id, quantity: 1 }))], [...catalog, ...extras], menu), /INVALID_ITEM/);
});
