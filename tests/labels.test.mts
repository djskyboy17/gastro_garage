import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node native type stripping
import { lotCode, addDays, displayDate, decimal, ingredientParts, labelNodes, consumerLabel, toPublicLabel, parseLabelSettings, emptyLabelSettings } from "../src/modules/labels/domain.ts";

const settings = { ...emptyLabelSettings, producerName: "Gastro Garage SRL", producerAddress: "Str. Exemplu 1, Cluj" };
const item = { id: "item-1", productId: "prod-1", hu: "Gulyásleves", ro: "Supă gulaș", allergens: "celery", quantity: 3 };
const info = {
  ingredients: [
    { name: { hu: "Marhahús", ro: "Carne de vită" }, grams: 300, frozen: true, allergens: [] },
    { name: { hu: "Galuska", ro: "Găluște" }, grams: 100, frozen: false, children: [
      { name: { hu: "Liszt", ro: "Făină" }, grams: 60, frozen: false, allergens: ["gluten"] },
      { name: { hu: "Tojás", ro: "Ou" }, grams: 40, frozen: false, allergens: ["egg"] },
    ] },
    { name: { hu: "Zeller", ro: "Țelină" }, grams: 50, frozen: false, allergens: ["celery"] },
  ],
  allergens: ["celery", "egg", "gluten"],
  nutritionPer100g: { energyKj: 25000, energyKcal: 6000, fat: 250, saturates: 100, carbs: 520, sugars: 80, protein: 410, salt: 95 },
};
const base = { item, orderCode: "AB12CD", date: "2026-11-03", netGrams: 450, info, settings, baseUrl: "https://gastrogarage.veres.no" };

test("Lot code is per production day and dish, stable and short", () => {
  const a = lotCode("2026-11-03", "prod-1");
  assert.match(a, /^L261103-[0-9A-Z]{4}$/);
  assert.equal(a, lotCode("2026-11-03", "prod-1"));
  assert.notEqual(a, lotCode("2026-11-04", "prod-1"));
  assert.notEqual(a.slice(-4), lotCode("2026-11-03", "prod-2").slice(-4));
});
test("Dates and numbers are written the Romanian way", () => {
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(displayDate("2026-11-03"), "03.11.2026");
  assert.equal(decimal(250), "2,5");
  assert.equal(decimal(95), "1");
  assert.equal(decimal(1200), "12");
  assert.equal(decimal(1234), "12,3");
});
test("Ingredients with allergens are emphasised, frozen ones marked, preparations bracketed", () => {
  const parts = ingredientParts(labelNodes(info.ingredients), "ro");
  assert.equal(parts.map((p: { text: string }) => p.text).join(""), "Carne de vită*, Găluște (Făină, Ou), Țelină");
  assert.deepEqual(parts.filter((p: { bold: boolean }) => p.bold).map((p: { text: string }) => p.text), ["Făină", "Ou", "Țelină"]);
});
test("Complete label: use-by from shelf life, one copy per portion, QR to the public page", () => {
  const l = consumerLabel({ ...base, label: { shelfLifeDays: 2, storageRo: "", storageHu: "" } });
  assert.equal(l.useBy, "2026-11-05");
  assert.equal(l.copies, 3);
  assert.equal(l.frozen, true);
  assert.equal(l.storage.ro, emptyLabelSettings.defaultStorageRo);
  assert.equal(l.url, "https://gastrogarage.veres.no/label?id=item-1");
  assert.deepEqual(l.missing, []);
  assert.deepEqual(l.allergens, ["celery", "egg", "gluten"]);
});
test("Missing data is reported, never silently filled in", () => {
  const l = consumerLabel({ ...base, info: null, label: null, settings: { ...emptyLabelSettings, defaultStorageRo: "" } });
  assert.deepEqual(l.missing, ["recipe", "shelfLife", "storage", "producer"]);
  assert.equal(l.useBy, null);
  // A rendeléskor mentett allergén recept nélkül is rajta marad.
  assert.deepEqual(l.allergens, ["celery"]);
  const noNutrition = consumerLabel({ ...base, info: { ...info, nutritionPer100g: null }, label: { shelfLifeDays: 0, storageRo: "x", storageHu: "" } });
  assert.deepEqual(noNutrition.missing, ["nutrition"]);
  assert.equal(noNutrition.useBy, "2026-11-03");
});
test("The public label has no order code, copies or internal data", () => {
  const p = toPublicLabel(consumerLabel({ ...base, label: { shelfLifeDays: 1, storageRo: "", storageHu: "" } }));
  for (const key of ["orderCode", "copies", "missing", "url"]) assert.equal(key in p, false, key);
  assert.equal(JSON.stringify(p).includes("AB12CD"), false);
});
test("Settings fall back to defaults on broken content", () => {
  assert.deepEqual(parseLabelSettings("nem json"), emptyLabelSettings);
  assert.equal(parseLabelSettings(JSON.stringify({ producerName: "X", producerAddress: 5 })).producerAddress, "");
});
