import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "acorn";
// @ts-ignore Node native type stripping
import { DISPLAY_SCRIPT } from "../src/modules/display/client.ts";
// @ts-ignore Node native type stripping
import { DISPLAY_CSS } from "../src/modules/display/style.ts";
// @ts-ignore Node native type stripping
import { renderList, renderLogin, renderPage, esc, CLIENT_VERSION, pollInterval } from "../src/modules/display/view.ts";
// @ts-ignore Node native type stripping
import { displayMessages } from "../src/modules/display/i18n.ts";

const order = (over: Record<string, unknown> = {}) => ({
  id: "0198aaaa-bbbb-7ccc-8ddd-eeeeff123456",
  date: "2026-10-31",
  time: "11:30",
  customerName: "Atelier Studio",
  note: "",
  status: "confirmed",
  production: "queued",
  fulfillmentMode: "delivery",
  items: [{ id: "i1", hu: "Gulyásleves", ro: "Supă gulaș", allergens: "celery", quantity: 18, ready: 0 }],
  ...over,
});

test("a kliens-script ES5 (IE11): az acorn ECMAScript 5-ként hiba nélkül elemzi", () => {
  assert.doesNotThrow(() => parse(DISPLAY_SCRIPT, { ecmaVersion: 5 }));
  const W = "[^A-Za-z0-9_$]";
  for (const banned of ["(^|" + W + ")fetch[(]", "(^|" + W + ")Promise(" + W + "|$)", "=>", "(^|" + W + ")let ", "(^|" + W + ")const ", "classList", "[`]"])
    assert.equal(new RegExp(banned).test(DISPLAY_SCRIPT), false, banned);
});

test("a teljes oldal minden inline scriptje ES5", () => {
  const page = renderPage({ lang: "hu", orders: [order()], today: "2026-10-31", version: "abc", userName: "Konyha", sound: true, allergenNames: {} });
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  for (const s of scripts) assert.doesNotThrow(() => parse(s, { ecmaVersion: 5 }));
  assert.equal(page.includes('type="module"'), false);
  // Az oldal a saját kliens-változatát kapja, ezzel kérdezi a listát (elavult oldal → újratöltés).
  assert.ok(page.includes('"k":"' + CLIENT_VERSION + '"'));
  assert.match(CLIENT_VERSION, /^[0-9a-f]{8}$/);
  assert.ok(page.includes('content="IE=edge"'));
});

test("a stílusban nincs grid és CSS-változó", () => {
  assert.equal(/display\s*:\s*(-ms-)?grid/.test(DISPLAY_CSS), false);
  assert.equal(/var\(--|--[a-z]+\s*:/.test(DISPLAY_CSS), false);
});

test("a felhasználói adatok kódolva kerülnek a HTML-be", () => {
  const html = renderList([order({ customerName: '<img src=x onerror="alert(1)">', note: "a & b" })], "hu", "2026-10-31");
  assert.equal(html.includes("<img src=x"), false);
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(html.includes("a &amp; b"));
  assert.equal(esc("'"), "&#39;");
  // A beágyazott beállítás sem zárhatja le a script-blokkot.
  const page = renderPage({ lang: "hu", orders: [], today: "2026-10-31", version: "</script><b>", userName: "x", sound: false, allergenNames: {} });
  assert.equal(page.includes("</script><b>"), false);
});

test("lista: nyitott rendelések gombokkal, a kész rendelések külön, gomb nélkül; ételenkénti összesítés", () => {
  const html = renderList(
    [
      order(),
      order({ id: "x-cooking", production: "cooking", items: [{ id: "i2", hu: "Gulyásleves", ro: "Supă", allergens: "", quantity: 12, ready: 0 }] }),
      order({ id: "x-ready", production: "ready" }),
    ],
    "hu",
    "2026-10-31",
    { celery: "Zeller" },
  );
  assert.ok(html.includes("<b>30</b> Gulyásleves"));
  assert.ok(html.includes("Zeller"));
  assert.ok(html.includes("Elkészült ma"));
  const readyCard = html.slice(html.indexOf('data-id="x-ready"'));
  assert.equal(readyCard.includes("data-muvelet"), false);
  const cookingCard = html.slice(html.indexOf('data-id="x-cooking"'), html.indexOf('data-id="x-ready"'));
  // Készülő rendelésen csak az „Elkészült” gomb van.
  assert.deepEqual([...cookingCard.matchAll(/data-muvelet="(\w+)"/g)].map((m) => m[1]), ["ready"]);
});

test("új rendelés: csak a zöld „Elfogadom” gomb; visszaigazolásra váró kérésnél jelölve", () => {
  const html = renderList(
    [order({ id: "x-req", status: "requested" }), order({ id: "x-queued" })],
    "hu",
    "2026-10-31",
  );
  const req = html.slice(html.indexOf('data-id="x-req"'), html.indexOf('data-id="x-queued"'));
  const queued = html.slice(html.indexOf('data-id="x-queued"'));
  for (const card of [req, queued]) assert.deepEqual([...card.matchAll(/data-muvelet="(\w+)"/g)].map((m) => m[1]), ["accept"]);
  assert.ok(req.includes(displayMessages.hu.requested));
  assert.ok(req.includes(displayMessages.hu.acceptHint));
  assert.ok(html.includes('class="kartya all-queued keres" data-id="x-req"'));
  assert.equal(queued.includes(displayMessages.hu.acceptHint), false);
});

test("késésben lévő (tegnapi, még nem kész) rendelés jelölve", () => {
  const html = renderList([order({ date: "2026-10-30" })], "ro", "2026-10-31");
  assert.ok(html.includes("keso"));
  assert.ok(html.includes(displayMessages.ro.late));
});

test("üres lista és belépési űrlap mindkét nyelven", () => {
  assert.ok(renderList([], "hu", "2026-10-31").includes(displayMessages.hu.empty));
  const form = renderLogin("ro", "Eroare <x>", 'a"b@c.ro');
  assert.ok(form.includes('action="/kijelzo/belepes"'));
  assert.ok(form.includes("Eroare &lt;x&gt;"));
  assert.ok(form.includes('value="a&quot;b@c.ro"'));
  for (const l of ["hu", "ro"] as const) assert.deepEqual(Object.keys(displayMessages[l]).sort(), Object.keys(displayMessages.hu).sort());
});

test("frissítési időköz román idő szerint: 07:00–19:00 között 5 mp, egyébként 30 mp", () => {
  // Bukarest télen UTC+2, nyáron UTC+3.
  assert.equal(pollInterval(new Date("2026-11-01T04:59:00Z")), 30000); // 06:59
  assert.equal(pollInterval(new Date("2026-11-01T05:00:00Z")), 5000); // 07:00
  assert.equal(pollInterval(new Date("2026-11-01T16:59:00Z")), 5000); // 18:59
  assert.equal(pollInterval(new Date("2026-11-01T17:00:00Z")), 30000); // 19:00
  assert.equal(pollInterval(new Date("2026-07-01T04:00:00Z")), 5000); // nyáron 07:00
  assert.equal(pollInterval(new Date("2026-07-01T22:30:00Z")), 30000); // nyáron 01:30
});
