import { displayMessages, type DisplayLang } from "./i18n.ts";
import { DISPLAY_SCRIPT, clientVersion } from "./client.ts";
import { DISPLAY_CSS } from "./style.ts";

/**
 * Frissítési időköz (ms) román idő szerint: nyitvatartás alatt (07:00–19:00) 5 mp, éjjel 30 mp.
 * A szerver minden lista-válaszban elküldi (`X-Kijelzo-Kovetkezo`), így a kijelző órájától független.
 */
export const DAY_POLL_MS = 5000;
export const NIGHT_POLL_MS = 30000;
export function pollInterval(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour >= 7 && hour < 19 ? DAY_POLL_MS : NIGHT_POLL_MS;
}

/** A kliens (script + stílus + feliratok) változata; ha eltér a futó oldalétól, az oldal újratölt. */
export const CLIENT_VERSION = clientVersion(DISPLAY_SCRIPT, DISPLAY_CSS, JSON.stringify(displayMessages));

/** Allergénkód → név (a közös fordításból; a szerver adja át, így ez a fájl tiszta marad és tesztelhető). */
export type AllergenNames = Record<string, string>;

/** A kijelzőn mutatott rendelés: csak a konyhának szükséges mezők. */
export type DisplayOrder = {
  id: string;
  date: string;
  time: string;
  customerName: string;
  note: string;
  /** "requested" (visszaigazolásra vár) vagy "confirmed". */
  status: string;
  production: string;
  fulfillmentMode: string;
  items: { id: string; hu: string; ro: string; allergens: string; quantity: number; ready: number }[];
};

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v: string) => String(v).replace(/[&<>"']/g, (c) => ESC[c]!);
const code = (id: string) => id.slice(-6).toUpperCase();

/** Oldalváz: régi Internet Explorerre is (IE=edge, ES5 script, grid és CSS-változók nélkül). */
function shell(lang: DisplayLang, title: string, body: string, extraHead = "") {
  return (
    "<!DOCTYPE html>\n<html lang=\"" + lang + "\"><head><meta charset=\"utf-8\">" +
    "<meta http-equiv=\"X-UA-Compatible\" content=\"IE=edge\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, user-scalable=no\">" +
    "<meta name=\"msapplication-tap-highlight\" content=\"no\">" +
    "<title>" + esc(title) + "</title><link rel=\"icon\" href=\"/favicon-32.png\"><style>" + DISPLAY_CSS + "</style>" + extraHead +
    "</head><body>" + body + "</body></html>"
  );
}

function langLinks(lang: DisplayLang) {
  return (
    "<span class=\"nyelv\">" +
    (["hu", "ro"] as const)
      .map((l) => "<a class=\"gomb kicsi" + (l === lang ? " valasztott" : "") + "\" href=\"/kijelzo/nyelv?l=" + l + "\">" + l.toUpperCase() + "</a>")
      .join("") +
    "</span>"
  );
}

export function renderLogin(lang: DisplayLang, error: string, email: string) {
  const t = displayMessages[lang];
  return shell(
    lang,
    t.loginTitle,
    "<div class=\"belepes\"><div class=\"belepes-fej\"><img src=\"/logo-192.png\" alt=\"Gastro-Garage\" width=\"96\" height=\"96\">" + langLinks(lang) + "</div>" +
      "<h1>" + esc(t.loginTitle) + "</h1><p>" + esc(t.loginIntro) + "</p>" +
      (error ? "<p class=\"uzenet hiba-uzenet\" role=\"alert\">" + esc(error) + "</p>" : "") +
      "<form method=\"post\" action=\"/kijelzo/belepes\">" +
      "<label>" + esc(t.email) + "<input type=\"email\" name=\"email\" autocomplete=\"username\" required maxlength=\"254\" value=\"" + esc(email) + "\"></label>" +
      "<label>" + esc(t.password) + "<input type=\"password\" name=\"password\" autocomplete=\"current-password\" required maxlength=\"200\"></label>" +
      "<button class=\"gomb nagy elsodleges\" type=\"submit\">" + esc(t.login) + "</button></form></div>",
  );
}

export function renderMessage(lang: DisplayLang, message: string) {
  const t = displayMessages[lang];
  return shell(
    lang,
    t.title,
    "<div class=\"belepes\"><div class=\"belepes-fej\"><img src=\"/logo-192.png\" alt=\"Gastro-Garage\" width=\"96\" height=\"96\">" + langLinks(lang) + "</div>" +
      "<p class=\"uzenet\">" + esc(message) + "</p>" + logoutForm(t.logout, "") + "</div>",
  );
}

function logoutForm(label: string, confirm: string) {
  return (
    "<form method=\"post\" action=\"/kijelzo/kilepes\" class=\"kilepes\"" +
    (confirm ? " onsubmit=\"return confirm(this.getAttribute('data-k'))\" data-k=\"" + esc(confirm) + "\"" : "") +
    "><button class=\"gomb kicsi\" type=\"submit\">" + esc(label) + "</button></form>"
  );
}

function card(o: DisplayOrder, lang: DisplayLang, today: string, compact: boolean, allergenNames: AllergenNames) {
  const t = displayMessages[lang];
  const late = o.date < today && o.production !== "ready";
  const items = o.items
    .map((i) => {
      const done = i.ready === 1 || o.production === "ready";
      const allergens = i.allergens
        .split(",")
        .filter(Boolean)
        .map((a) => allergenNames[a] ?? a)
        .join(", ");
      return (
        "<tr" + (done ? " class=\"kesz\"" : "") + "><td class=\"db\">" + i.quantity + "×</td><td class=\"etel\">" + esc(i[lang] || i.ro) +
        (allergens && !compact ? "<small>" + esc(allergens) + "</small>" : "") + "</td><td class=\"pipa\">" + (done ? "✓" : "") + "</td></tr>"
      );
    })
    .join("");
  // Még el nem kezdett (vagy visszaigazolásra váró) rendelés: egy zöld „Elfogadom” gomb, ami visszaigazol és a főzést is elindítja.
  // Készülő rendelés: csak „Elkészült”. Kész rendelés: nincs gomb.
  const requested = o.status === "requested";
  const buttons =
    o.production === "ready"
      ? ""
      : o.production === "queued"
        ? "<div class=\"gombok\"><button type=\"button\" class=\"gomb nagy elfogad\" data-muvelet=\"accept\">" + esc(t.accept) +
          "<small>" + esc(requested ? t.acceptHint : t.acceptStart) + "</small></button></div>"
        : "<div class=\"gombok\"><button type=\"button\" class=\"gomb nagy elkeszult\" data-muvelet=\"ready\">" + esc(t.markReady) + "</button></div>";
  const stateLabel = requested ? t.requested : t[o.production as "queued" | "cooking" | "ready"] ?? o.production;
  return (
    "<div class=\"kartya all-" + o.production + (requested ? " keres" : "") + (late ? " keso" : "") + "\" data-id=\"" + esc(o.id) + "\">" +
    "<div class=\"kfej\"><span class=\"ido\">" + esc(o.time) + "</span><span class=\"kod\">#" + esc(code(o.id)) + "</span>" +
    "<span class=\"cimke\">" + esc(o.fulfillmentMode === "pickup" ? t.pickup : t.delivery) + "</span>" +
    (late ? "<span class=\"cimke piros\">" + esc(t.late + " · " + o.date.slice(5).replace("-", ".")) + "</span>" : "") +
    "<span class=\"allapot\">" + esc(stateLabel) + "</span></div>" +
    "<div class=\"nev\">" + esc(o.customerName) + "</div><table class=\"tetelek\">" + items + "</table>" +
    (o.note && !compact ? "<div class=\"megj\">" + esc(o.note) + "</div>" : "") + buttons + "</div>"
  );
}

/** A lista rész (ezt cseréli a kliens XHR-rel): összesítés, nyitott rendelések, ma elkészültek. */
export function renderList(orders: DisplayOrder[], lang: DisplayLang, today: string, allergenNames: AllergenNames = {}) {
  const t = displayMessages[lang];
  const open = orders.filter((o) => o.production !== "ready");
  const done = orders.filter((o) => o.production === "ready").reverse();
  // Ételenként a még el nem készült adagok a nyitott rendelésekből.
  const totals = new Map<string, { name: string; qty: number }>();
  for (const o of open)
    for (const i of o.items) {
      if (i.ready === 1) continue;
      const key = i[lang] || i.ro;
      const row = totals.get(key) ?? { name: key, qty: 0 };
      row.qty += i.quantity;
      totals.set(key, row);
    }
  const summary = [...totals.values()].sort((a, b) => b.qty - a.qty);
  return (
    (summary.length
      ? "<div class=\"osszesites\"><span class=\"ossz-cim\">" + esc(t.summary) + ":</span>" +
        summary.map((s) => "<span class=\"ossz-tetel\"><b>" + s.qty + "</b> " + esc(s.name) + "</span>").join("") + "</div>"
      : "") +
    "<h2>" + esc(t.open) + " <span class=\"szam\">" + open.length + "</span></h2>" +
    (open.length ? "<div class=\"kartyak\">" + open.map((o) => card(o, lang, today, false, allergenNames)).join("") + "</div>" : "<p class=\"ures\">" + esc(t.empty) + "</p>") +
    (done.length
      ? "<h2>" + esc(t.doneToday) + " <span class=\"szam\">" + done.length + "</span></h2><div class=\"kartyak kesz-lista\">" +
        done.map((o) => card(o, lang, today, true, allergenNames)).join("") + "</div>"
      : "")
  );
}

export function renderPage(o: { lang: DisplayLang; orders: DisplayOrder[]; today: string; version: string; userName: string; sound: boolean; allergenNames: AllergenNames }) {
  const t = displayMessages[o.lang];
  // A kliens a feliratokat és a kezdő változatot innen kapja; a < jelet kódoljuk, hogy a script-blokkot ne zárhassa le adat.
  const config = JSON.stringify({ v: o.version, k: CLIENT_VERSION, p: pollInterval(), t, sound: o.sound }).replace(/</g, "\\u003c");
  return shell(
    o.lang,
    t.title,
    "<div id=\"fejlec\"><img src=\"/logo-192.png\" alt=\"Gastro-Garage\" width=\"56\" height=\"56\"><div class=\"cim\"><h1>" + esc(t.title) + "</h1>" +
      "<span class=\"alcim\">" + esc(o.today.replace(/-/g, ".")) + " · " + esc(o.userName) + "</span></div>" +
      "<span id=\"ora\"></span><span id=\"kapcsolat\" class=\"elo\">● " + esc(t.live) + "</span>" +
      "<button type=\"button\" id=\"hang\" class=\"gomb kicsi\">" + esc(o.sound ? t.soundOn : t.soundOff) + "</button>" + langLinks(o.lang) +
      logoutForm(t.logout, t.logoutConfirm) + "</div>" +
      "<div id=\"sav\" class=\"rejtett\"></div><div id=\"uj-jelzes\" class=\"rejtett\">" + esc(t.newOrder) + "</div>" +
      "<div id=\"lista\">" + renderList(o.orders, o.lang, o.today, o.allergenNames) + "</div>" +
      "<audio id=\"csengo\" preload=\"auto\" src=\"/kijelzo/csengo.mp3\"></audio>" +
      "<script>var KIJELZO=" + config + ";</script><script>" + DISPLAY_SCRIPT + "</script>",
  );
}
