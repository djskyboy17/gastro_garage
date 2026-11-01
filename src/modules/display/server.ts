import { env } from "cloudflare:workers";
import { currentUser, passwordLogin, endSession, renewSession, AuthError } from "../auth/server";
import { sessionCookie } from "../auth/domain";
import { sessionFor } from "../access/server";
import { isAdmin, isKitchenStaff, type Session } from "../access/domain";
import { acceptOrder, markOrderReady, startCooking, KitchenError } from "../kitchen/server";
import { today } from "../shared/domain";
import { messages } from "../shared/i18n";
import { displayMessages, type DisplayLang } from "./i18n";
import { CLIENT_VERSION, pollInterval, renderList, renderLogin, renderMessage, renderPage, type DisplayOrder } from "./view";
import { DISPLAY_SOUND_MP3 } from "./sound";

/** Késésben lévő (régebbi, még nem kész) rendelést ennyi napra visszamenőleg mutat. */
const LATE_DAYS = 2;
const LANG_COOKIE = "kijelzo_nyelv";

const html = (body: string, status = 200, cookies: string[] = []) => {
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-UA-Compatible": "IE=edge" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(body, { status, headers });
};
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  // 303: az űrlapküldés után GET-tel töltse be (frissítéskor ne küldje újra a jelszót).
  return new Response(null, { status: 303, headers });
};
function cookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}
const langOf = (req: Request): DisplayLang => (cookie(req, LANG_COOKIE) === "ro" ? "ro" : "hu");
/** Konyhai kijelzőt a konyha és az adminisztrátor használhat (ugyanők jelölhetnek a konyhán késznek). */
export const canUseDisplay = (s: Session) => isAdmin(s.role) || isKitchenStaff(s.role);

/**
 * Űrlap csak a saját oldalról jöhet. Az IE11 azonos eredetű űrlapnál nem mindig küld Origin fejlécet,
 * ezért ilyenkor a Referer dönt; ha egyik sincs, elutasítjuk.
 */
export function sameOriginForm(req: Request) {
  const origin = new URL(req.url).origin;
  const o = req.headers.get("origin");
  if (o) return o === origin;
  const r = req.headers.get("referer");
  return !!r && (r === origin || r.startsWith(origin + "/"));
}
/**
 * XHR-művelet: egyedi fejléc kell (más oldal CORS-engedély nélkül nem tud ilyet küldeni), és ha van Origin, egyezzen.
 */
export function sameOriginXhr(req: Request) {
  if (req.headers.get("x-kijelzo") !== "1") return false;
  const o = req.headers.get("origin");
  return !o || o === new URL(req.url).origin;
}

function daysBefore(day: string, n: number) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
/**
 * A kijelző rendelései: visszaigazolt vagy visszaigazolásra váró, mai (bármilyen gyártási állapot)
 * vagy legfeljebb 2 napos, még nem kész.
 */
const ORDER_FILTER =
  "o.date BETWEEN ?1 AND ?2 AND o.status IN ('requested','confirmed') AND (o.date=?2 OR o.production IN ('queued','cooking'))";

export async function loadDisplayOrders(day: string): Promise<DisplayOrder[]> {
  const from = daysBefore(day, LATE_DAYS);
  const [orders, items] = await env.DB!.batch([
    env.DB!.prepare(
      `SELECT o.id,o.date,o.time,o.customer_name AS customerName,o.note,o.status,o.production,o.fulfillment_mode AS fulfillmentMode FROM orders o WHERE ${ORDER_FILTER} ORDER BY o.date,o.time,o.created_at`,
    ).bind(from, day),
    env.DB!.prepare(
      `SELECT i.id,i.order_id AS orderId,i.hu,i.ro,i.allergens,i.quantity,i.ready FROM order_items i WHERE i.order_id IN (SELECT o.id FROM orders o WHERE ${ORDER_FILTER}) ORDER BY i.rowid`,
    ).bind(from, day),
  ]);
  const byOrder = new Map<string, DisplayOrder["items"]>();
  for (const i of items!.results as (DisplayOrder["items"][number] & { orderId: string })[]) {
    const list = byOrder.get(i.orderId) ?? [];
    list.push({ id: i.id, hu: i.hu, ro: i.ro, allergens: i.allergens, quantity: i.quantity, ready: i.ready });
    byOrder.set(i.orderId, list);
  }
  return (orders!.results as Omit<DisplayOrder, "items">[]).map((o) => ({ ...o, items: byOrder.get(o.id) ?? [] }));
}

/**
 * Olcsó „változott-e?” ellenőrzés: ugyanazokat a rendeléseket olvassa (indexen), a tételekből csak összesítést,
 * és ebből egy rövid lenyomatot számol. A rendelés változata (revision) minden állapotváltáskor nő; a tétel kész-jelzése
 * külön számít, mert az egyes tételek késznek jelölése nem mindig emeli a rendelés változatát.
 */
export async function displayVersion(day: string, lang: DisplayLang) {
  const row = await env.DB!.prepare(
    `SELECT group_concat(o.id||':'||o.revision||':'||o.production||':'||(SELECT COUNT(*)||'.'||TOTAL(i.ready)||'.'||TOTAL(i.quantity) FROM order_items i WHERE i.order_id=o.id),',') AS sig FROM (SELECT o.id,o.revision,o.production FROM orders o WHERE ${ORDER_FILTER} ORDER BY o.id) o`,
  )
    .bind(daysBefore(day, LATE_DAYS), day)
    .first<{ sig: string | null }>();
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(day + "|" + lang + "|" + (row?.sig ?? "")));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function who(req: Request) {
  const user = await currentUser(req);
  if (!user) return null;
  return { user, session: await sessionFor({ userId: user.userId, email: user.email, name: user.name }) };
}

/** A /kijelzo útvonalai. `action` üres a főoldalnál. */
export async function handleDisplay(req: Request, action: string): Promise<Response> {
  const method = req.method.toUpperCase();
  const lang = langOf(req);
  const t = displayMessages[lang];
  const secure = new URL(req.url).protocol === "https:";

  if (action === "csengo.mp3" && method === "GET")
    return new Response(DISPLAY_SOUND_MP3, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=604800" } });

  if (action === "nyelv" && method === "GET") {
    const l = new URL(req.url).searchParams.get("l") === "ro" ? "ro" : "hu";
    const expires = new Date(Date.now() + 365 * 86400_000).toUTCString();
    return redirect("/kijelzo", [`${LANG_COOKIE}=${l}; Path=/kijelzo; SameSite=Lax; Max-Age=31536000; Expires=${expires}${secure ? "; Secure" : ""}`]);
  }

  if (action === "belepes" && method === "POST") {
    if (!sameOriginForm(req)) return html(renderLogin(lang, t.sameOrigin, ""), 403);
    const raw = await req.text();
    if (raw.length > 2000) return html(renderLogin(lang, t.sameOrigin, ""), 413);
    const form = new URLSearchParams(raw);
    const email = (form.get("email") ?? "").trim().slice(0, 254);
    try {
      const login = await passwordLogin(email, form.get("password") ?? "", req);
      return redirect("/kijelzo", [sessionCookie(login.token, secure)]);
    } catch (e) {
      if (!(e instanceof AuthError)) console.error(e);
      const code = e instanceof AuthError ? e.code : "SERVER_ERROR";
      const text = messages[lang][code] ?? messages[lang].INVALID_LOGIN ?? code;
      return html(renderLogin(lang, text, email), e instanceof AuthError ? e.status : 500);
    }
  }

  if (action === "kilepes" && method === "POST") {
    if (!sameOriginForm(req)) return redirect("/kijelzo");
    return redirect("/kijelzo", [await endSession(req)]);
  }

  if (action === "" && method === "GET") {
    const w = await who(req);
    if (!w) return html(renderLogin(lang, "", ""));
    if (w.user.mustChangePassword) return html(renderMessage(lang, t.mustChange));
    if (!canUseDisplay(w.session)) return html(renderMessage(lang, t.noAccess), 403);
    const day = today();
    const [orders, version, renewed] = await Promise.all([loadDisplayOrders(day), displayVersion(day, lang), renewSession(req)]);
    return html(
      renderPage({ lang, orders, today: day, version, sound: cookie(req, "kijelzo_hang") !== "0", allergenNames: messages[lang] }),
      200,
      renewed ? [renewed] : [],
    );
  }

  if (action === "lista" && method === "GET") {
    const w = await who(req);
    if (!w || w.user.mustChangePassword) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
    if (!canUseDisplay(w.session)) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
    // Elavult oldal (élesítés előtt betöltött script): a régi és az új kliens is 403-ra újratölti az oldalt.
    if (new URL(req.url).searchParams.get("k") !== CLIENT_VERSION)
      return new Response(null, { status: 403, headers: { "Cache-Control": "no-store", "X-Kijelzo-Ok": "uj-verzio" } });
    const day = today();
    const version = await displayVersion(day, lang);
    // Nem változott: üres válasz, a kliens nem cserél semmit.
    // A következő lekérdezés ideje (nappal 5 mp, éjjel 30 mp) minden válaszban.
    const next = String(pollInterval());
    if (new URL(req.url).searchParams.get("v") === version)
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "X-Kijelzo-Kovetkezo": next } });
    const body = renderList(await loadDisplayOrders(day), lang, day, messages[lang]);
    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Kijelzo-Verzio": version, "X-Kijelzo-Kovetkezo": next },
    });
  }

  if (action === "muvelet" && method === "POST") {
    if (!sameOriginXhr(req)) return json({ error: "INVALID_ORIGIN" }, 403);
    const w = await who(req);
    if (!w || w.user.mustChangePassword) return json({ error: "AUTH_REQUIRED" }, 401);
    if (!canUseDisplay(w.session)) return json({ error: "FORBIDDEN" }, 403);
    const raw = await req.text();
    if (raw.length > 1000) return json({ error: "TOO_LARGE" }, 413);
    const form = new URLSearchParams(raw);
    const id = form.get("id") ?? "",
      a = form.get("a");
    // A "cooking" csak a régi, még újra nem töltött oldalak miatt maradt; az új oldal "accept"-et küld.
    if (!id || id.length > 200 || (a !== "accept" && a !== "cooking" && a !== "ready")) return json({ error: "VALIDATION" }, 400);
    try {
      if (a === "accept") await acceptOrder(id, w.session);
      else if (a === "cooking") await startCooking(id, w.session);
      else await markOrderReady(id, w.session);
      return json({ ok: true });
    } catch (e) {
      if (e instanceof KitchenError) return json({ error: e.code }, e.status);
      console.error(e);
      return json({ error: "SERVER_ERROR" }, 500);
    }
  }

  return html(renderMessage(lang, messages[lang].NOT_FOUND ?? "404"), 404);
}
