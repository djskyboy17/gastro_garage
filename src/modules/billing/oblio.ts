import { env } from "cloudflare:workers";

/**
 * Oblio-kapcsolat (v77). Két megvalósítás ugyanazzal a felülettel:
 * - szimulált (alapértelmezés): az `oblio_simulated` táblában tárol, az ismételt idempotencyKey ugyanazt a számlát adja vissza;
 * - valódi: https://www.oblio.eu/api – token (1 óra) a szerver titoktárából (`OBLIO_CLIENT_ID`, `OBLIO_CLIENT_SECRET`).
 * Hívás soha nem adatbázis-tranzakción belül; időkorlát 20 mp. A titok nem kerül naplóba vagy hibaüzenetbe.
 */
export class OblioError extends Error {
  constructor(
    public code: "OBLIO_NOT_CONFIGURED" | "OBLIO_AUTH" | "OBLIO_REJECTED" | "OBLIO_UNAVAILABLE",
    public detail = "",
  ) {
    super(code);
  }
}
export type OblioDoc = { seriesName: string; number: string; link: string };
export type OblioSpv = { code: number; text: string };
export type OblioCollect = { type: string; documentNumber: string; value: number; issueDate: string; seriesName?: string };
export interface OblioClient {
  mode: "simulated" | "live";
  issueInvoice(payload: Record<string, unknown>): Promise<OblioDoc>;
  sendEinvoice(cif: string, seriesName: string, number: string): Promise<OblioSpv>;
  einvoiceStatus(cif: string, seriesName: string, number: string): Promise<OblioSpv | null>;
  collect(cif: string, seriesName: string, number: string, c: OblioCollect): Promise<void>;
  check(cif: string): Promise<{ companies: string[]; series: string[]; vatRates: { name: string; percent: number }[] }>;
}

const BASE = "https://www.oblio.eu";
const TIMEOUT_MS = 20_000;
let token: { value: string; expires: number; clientId: string } | null = null;

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new OblioError("OBLIO_UNAVAILABLE", "network");
  } finally {
    clearTimeout(timer);
  }
}

function liveClient(): OblioClient {
  const secrets = env as unknown as { OBLIO_CLIENT_ID?: string; OBLIO_CLIENT_SECRET?: string };
  const clientId = secrets.OBLIO_CLIENT_ID ?? "",
    clientSecret = secrets.OBLIO_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) throw new OblioError("OBLIO_NOT_CONFIGURED");
  async function bearer() {
    if (token && token.clientId === clientId && token.expires > Date.now() + 60_000) return token.value;
    const r = await fetchWithTimeout(BASE + "/api/authorize/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret }).toString(),
    });
    if (r.status === 401 || r.status === 400) throw new OblioError("OBLIO_AUTH");
    if (!r.ok) throw new OblioError("OBLIO_UNAVAILABLE", "token " + r.status);
    const v = (await r.json()) as { access_token?: string; expires_in?: string | number };
    if (!v.access_token) throw new OblioError("OBLIO_AUTH");
    token = { value: v.access_token, expires: Date.now() + Number(v.expires_in ?? 3600) * 1000, clientId };
    return token.value;
  }
  async function call<T>(method: string, path: string, opts: { json?: unknown; form?: Record<string, string>; query?: Record<string, string> } = {}): Promise<T> {
    const url = BASE + path + (opts.query ? "?" + new URLSearchParams(opts.query).toString() : "");
    const headers: Record<string, string> = { Authorization: "Bearer " + (await bearer()) };
    let body: string | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(opts.form).toString();
    }
    const r = await fetchWithTimeout(url, { method, headers, body });
    const v = (await r.json().catch(() => null)) as { status?: number; statusMessage?: string; data?: T } | null;
    if (r.status === 401) {
      token = null;
      throw new OblioError("OBLIO_AUTH");
    }
    if (r.status >= 500 || !v) throw new OblioError("OBLIO_UNAVAILABLE", String(r.status));
    if (!r.ok || (v.status && v.status !== 200)) throw new OblioError("OBLIO_REJECTED", String(v.statusMessage ?? r.status).slice(0, 300));
    return v.data as T;
  }
  return {
    mode: "live",
    async issueInvoice(payload) {
      const d = await call<{ seriesName: string; number: string; link: string }>("POST", "/api/docs/invoice", { json: payload });
      return { seriesName: d.seriesName, number: String(d.number), link: d.link ?? "" };
    },
    async sendEinvoice(cif, seriesName, number) {
      const d = await call<{ code: number; text: string }>("POST", "/api/docs/einvoice", { json: { cif, seriesName, number } });
      return { code: Number(d.code), text: String(d.text ?? "") };
    },
    async einvoiceStatus(cif, seriesName, number) {
      const d = await call<{ seriesName: string; number: string; einvoiceStatus?: { code: number; text: string } }[]>("GET", "/api/docs/invoice/list", {
        query: { cif, seriesName, number, withEinvoiceStatus: "1" },
      });
      const doc = (d ?? []).find((x) => x.seriesName === seriesName && String(x.number) === String(number));
      return doc?.einvoiceStatus ? { code: Number(doc.einvoiceStatus.code), text: String(doc.einvoiceStatus.text ?? "") } : null;
    },
    async collect(cif, seriesName, number, c) {
      const form: Record<string, string> = { cif, seriesName, number, "collect[type]": c.type, "collect[value]": (c.value / 100).toFixed(2), "collect[issueDate]": c.issueDate };
      if (c.type === "Chitanta") form["collect[seriesName]"] = c.seriesName ?? "";
      else form["collect[documentNumber]"] = c.documentNumber;
      await call("PUT", "/api/docs/invoice/collect", { form });
    },
    async check(cif) {
      const companies = await call<{ cif: string; company: string }[]>("GET", "/api/nomenclature/companies");
      const [series, vat] = cif
        ? await Promise.all([
            call<{ type: string; name: string }[]>("GET", "/api/nomenclature/series", { query: { cif } }),
            call<{ name: string; percent: number }[]>("GET", "/api/nomenclature/vat_rates", { query: { cif } }),
          ])
        : [[], []];
      return {
        companies: (companies ?? []).map((c) => `${c.company} (${c.cif})`),
        series: (series ?? []).filter((s) => !s.type || /factur/i.test(s.type)).map((s) => s.name),
        vatRates: (vat ?? []).map((v) => ({ name: v.name, percent: Number(v.percent) })),
      };
    },
  };
}

/**
 * Szimulált Oblio: ugyanaz a viselkedés, mint a valódi (sorszám a sorozatban, link, SPV-állapot, befizetés), adatbázisban tárolva.
 * Teszteléshez: ha a vevő neve „SPVHIBA”-t tartalmaz, az SPV elutasítja; ha „OBLIOHIBA”-t, a kiállítás hálózati hibával elbukik
 * (de a számla létrejön – mint egy elveszett válasz), így az újrapróbálás és az egyedi kulcs kipróbálható.
 */
function simulatedClient(): OblioClient {
  const DB = env.DB!;
  type Row = { idempotencyKey: string; seriesName: string; number: number; payload: string; spvCode: number | null };
  const byDoc = (seriesName: string, number: string) =>
    DB.prepare("SELECT idempotency_key AS idempotencyKey,series_name AS seriesName,number,payload,spv_code AS spvCode FROM oblio_simulated WHERE series_name=? AND number=?").bind(seriesName, Number(number)).first<Row>();
  const link = (key: string) => "/api/billing/simulated-doc?key=" + encodeURIComponent(key);
  return {
    mode: "simulated",
    async issueInvoice(payload) {
      const key = String(payload.idempotencyKey ?? "");
      const seriesName = String(payload.seriesName || "SIM");
      const existing = await DB.prepare("SELECT series_name AS seriesName,number FROM oblio_simulated WHERE idempotency_key=?").bind(key).first<{ seriesName: string; number: number }>();
      if (existing) return { seriesName: existing.seriesName, number: String(existing.number).padStart(4, "0"), link: link(key) };
      await DB.prepare("INSERT INTO oblio_simulated (idempotency_key,series_name,number,payload,spv_code,collected,cancelled,created_at) VALUES (?,?,(SELECT COALESCE(MAX(number),0)+1 FROM oblio_simulated WHERE series_name=?),?,NULL,0,0,?)")
        .bind(key, seriesName, seriesName, JSON.stringify(payload), new Date().toISOString())
        .run();
      const name = String((payload.client as { name?: string } | undefined)?.name ?? "");
      if (/OBLIOHIBA/i.test(name)) throw new OblioError("OBLIO_UNAVAILABLE", "simulated lost response");
      const row = await DB.prepare("SELECT series_name AS seriesName,number FROM oblio_simulated WHERE idempotency_key=?").bind(key).first<{ seriesName: string; number: number }>();
      return { seriesName: row!.seriesName, number: String(row!.number).padStart(4, "0"), link: link(key) };
    },
    async sendEinvoice(_cif, seriesName, number) {
      const row = await byDoc(seriesName, number);
      if (!row) throw new OblioError("OBLIO_REJECTED", "Documentul nu exista");
      const rejected = /SPVHIBA/i.test(row.payload);
      await DB.prepare("UPDATE oblio_simulated SET spv_code=? WHERE idempotency_key=?").bind(rejected ? 2 : 0, row.idempotencyKey).run();
      return rejected ? { code: 2, text: "e-Factura are erori: CIF cumparator invalid (simulat)" } : { code: 0, text: "e-Factura trimisa in SPV, in curs de procesare (simulat)" };
    },
    async einvoiceStatus(_cif, seriesName, number) {
      const row = await byDoc(seriesName, number);
      if (!row || row.spvCode === null) return null;
      // A szimulált SPV a második lekérdezésre elfogadja a számlát.
      if (row.spvCode === 0) {
        await DB.prepare("UPDATE oblio_simulated SET spv_code=1 WHERE idempotency_key=?").bind(row.idempotencyKey).run();
        return { code: 1, text: "Factura validata de SPV (simulat)" };
      }
      return row.spvCode === 1 ? { code: 1, text: "Factura validata de SPV (simulat)" } : { code: 2, text: "e-Factura are erori: CIF cumparator invalid (simulat)" };
    },
    async collect(_cif, seriesName, number) {
      const row = await byDoc(seriesName, number);
      if (!row) throw new OblioError("OBLIO_REJECTED", "Documentul nu exista");
      await DB.prepare("UPDATE oblio_simulated SET collected=collected+1 WHERE idempotency_key=?").bind(row.idempotencyKey).run();
    },
    async check() {
      return { companies: ["Gastro Garage (simulat)"], series: ["SIM"], vatRates: [{ name: "Normala", percent: 21 }, { name: "Redusa", percent: 11 }] };
    },
  };
}

export function oblioClient(mode: "simulated" | "live"): OblioClient {
  return mode === "live" ? liveClient() : simulatedClient();
}
