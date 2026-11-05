import { env } from "cloudflare:workers";
import { z } from "zod";
import type { Session } from "../access/domain";
import { isAdmin } from "../access/domain";
import { orderCode, today } from "../shared/domain";
import { DOCUMENT_TYPES, formatDocumentNumber } from "../documents/domain";
import { normalizeTaxId } from "../invoices/domain";
import {
  CASH_COLLECT_TYPES,
  buildSnapshot,
  collectTypeFor,
  defaultBillingSettings,
  invoiceOpen,
  monthRange,
  oblioInvoicePayload,
  profileError,
  spvState,
  type BillingProfile,
  type BillingSettings,
  type InvoiceSnapshot,
  type SnapshotOrder,
} from "./domain";
import { OblioError, oblioClient } from "./oblio";
import { orderCollectionAllowedSql } from "./order-collection";

/**
 * Számlázás az Oblióval (v77). Iroda (tulajdonos, admin, diszpécser): előnézet, jóváhagyás és kiállítás, újrapróbálás, SPV,
 * befizetés, ügyfél számlázási adatai. Admin: sztornó, beállítások, kapcsolatpróba.
 * A jóváhagyás egy D1-kötegben menti a kérést (egyedi kulccsal) és a rendelések foglalását; az Oblio-hívás utána, tranzakción kívül.
 */
export class BillingError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const officeRoles = ["owner", "admin", "dispatcher"];

type InvoiceRow = {
  id: string;
  kind: "order" | "monthly" | "storno";
  customerId: string;
  period: string;
  idempotencyKey: string;
  status: "pending" | "failed" | "issued" | "stornoed";
  content: string;
  total: number;
  issueDate: string;
  dueDate: string;
  oblioSeries: string;
  oblioNumber: string;
  oblioLink: string;
  spvCode: number | null;
  spvText: string;
  lastError: string;
  attempts: number;
  stornoOf: string | null;
  stornoedBy: string | null;
  createdAt: string;
  issuedAt: string | null;
  revision: number;
};
const invoiceColumns =
  "id,kind,customer_id AS customerId,period,idempotency_key AS idempotencyKey,status,content,total,issue_date AS issueDate,due_date AS dueDate,oblio_series AS oblioSeries,oblio_number AS oblioNumber,oblio_link AS oblioLink,spv_code AS spvCode,spv_text AS spvText,last_error AS lastError,attempts,storno_of AS stornoOf,stornoed_by AS stornoedBy,created_at AS createdAt,issued_at AS issuedAt,revision";
const profileColumns =
  "customer_id AS customerId,kind,mode,name,cif,reg_com AS regCom,address,city,county,country,email,payment_days AS paymentDays,revision";

export async function loadBillingSettings(): Promise<BillingSettings> {
  const row = await env.DB!.prepare(
    "SELECT mode,company_cif AS companyCif,series_name AS seriesName,storno_series_name AS stornoSeriesName,vat_food_bps AS vatFoodBps,vat_delivery_bps AS vatDeliveryBps,cash_collect_type AS cashCollectType,receipt_series AS receiptSeries,auto_spv AS autoSpv,revision FROM billing_settings WHERE id=1",
  ).first<BillingSettings>();
  return row ?? defaultBillingSettings;
}
async function loadProfile(customerId: string) {
  return env.DB!.prepare(`SELECT ${profileColumns} FROM customer_billing WHERE customer_id=?`).bind(customerId).first<BillingProfile>();
}
async function loadInvoice(id: string) {
  const row = await env.DB!.prepare(`SELECT ${invoiceColumns} FROM sales_invoices WHERE id=?`).bind(id).first<InvoiceRow>();
  if (!row) throw new BillingError("NOT_FOUND", 404);
  return row;
}
/** Reads current policy; write batches also check the same SQL atomically. */
export async function orderCollectionDeferred(orderId: string) {
  const row = await env.DB!.prepare(`SELECT ${orderCollectionAllowedSql} AS allowed`).bind(orderId).first<{ allowed: number }>();
  return row?.allowed !== 1;
}
/** Ügyfél számlázási módja (a futár és az aviz is használja): hiányzó sor = bon fiscal. */
export async function billingModes(customerIds: string[]) {
  if (!customerIds.length) return new Map<string, string>();
  const rows = await env.DB!.prepare("SELECT customer_id AS id,mode FROM customer_billing WHERE customer_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify([...new Set(customerIds)])).all<{ id: string; mode: string }>();
  return new Map(rows.results.map((r) => [r.id, r.mode]));
}

/** A számlázható rendelések adatai a pillanatképhez (mentett tételárak, szállítási díj) és az avizok számai. */
async function snapshotOrders(orderIds: string[]) {
  const DB = env.DB!;
  const ids = JSON.stringify(orderIds);
  const [orders, items, notes, prefixes] = await Promise.all([
    DB.prepare("SELECT id,date,delivery_fee AS deliveryFee FROM orders WHERE id IN (SELECT value FROM json_each(?)) ORDER BY date,time,id").bind(ids).all<{ id: string; date: string; deliveryFee: number }>(),
    DB.prepare("SELECT order_id AS orderId,ro,price,quantity FROM order_items WHERE order_id IN (SELECT value FROM json_each(?)) ORDER BY id").bind(ids).all<{ orderId: string; ro: string; price: number; quantity: number }>(),
    DB.prepare("SELECT order_id AS orderId,year,number FROM delivery_notes WHERE order_id IN (SELECT value FROM json_each(?)) AND kind='issue' AND status='issued' ORDER BY created_at").bind(ids).all<{ orderId: string; year: number; number: number }>(),
    DB.prepare("SELECT year,prefix FROM document_series WHERE doc_type='delivery_note'").all<{ year: number; prefix: string }>(),
  ]);
  const list: SnapshotOrder[] = orders.results.map((o) => ({ id: o.id, code: orderCode(o.id), date: o.date, deliveryFee: o.deliveryFee, items: items.results.filter((i) => i.orderId === o.id) }));
  const noteNumbers = notes.results.map((n) => formatDocumentNumber(prefixes.results.find((p) => p.year === n.year)?.prefix ?? DOCUMENT_TYPES.delivery_note, n.year, n.number));
  return { list, noteNumbers };
}

/** Előnézet: ki, mely rendelések, milyen pillanatkép. Hibakóddal, ha nem számlázható. */
async function prepare(input: { kind: "order"; orderId: string } | { kind: "monthly"; customerId: string; period: string }) {
  const DB = env.DB!;
  const settings = await loadBillingSettings();
  let customerId: string, orderIds: string[], period: string;
  if (input.kind === "order") {
    const o = await DB.prepare("SELECT id,customer_id AS customerId,status,date FROM orders WHERE id=?").bind(input.orderId).first<{ id: string; customerId: string; status: string; date: string }>();
    if (!o) throw new BillingError("NOT_FOUND", 404);
    if (o.status !== "confirmed") throw new BillingError("BILLING_ORDER_STATE");
    if (await DB.prepare("SELECT 1 FROM sales_invoice_orders WHERE order_id=? AND active=1").bind(o.id).first()) throw new BillingError("BILLING_ALREADY_INVOICED", 409);
    customerId = o.customerId;
    orderIds = [o.id];
    period = o.date.slice(0, 7);
  } else {
    const { from, to } = monthRange(input.period);
    customerId = input.customerId;
    period = input.period;
    orderIds = (
      await DB.prepare(
        "SELECT id FROM orders WHERE customer_id=? AND date>=? AND date<=? AND status='confirmed' AND delivery='delivered' AND NOT EXISTS (SELECT 1 FROM sales_invoice_orders s WHERE s.order_id=orders.id AND s.active=1) ORDER BY date,time,id",
      )
        .bind(customerId, from, to)
        .all<{ id: string }>()
    ).results.map((r) => r.id);
    if (!orderIds.length) throw new BillingError("BILLING_NOTHING_TO_INVOICE");
  }
  const profile = await loadProfile(customerId);
  if (!profile || profile.mode === "receipt") throw new BillingError("BILLING_PROFILE_REQUIRED");
  if (input.kind === "monthly" && profile.mode !== "monthly") throw new BillingError("BILLING_NOT_MONTHLY");
  const error = profileError(profile);
  if (error) throw new BillingError(error);
  const { list, noteNumbers } = await snapshotOrders(orderIds);
  const snapshot = buildSnapshot({ kind: input.kind, period, issueDate: today(), profile, orders: list, notes: noteNumbers, settings });
  if (snapshot.total <= 0) throw new BillingError("BILLING_NOTHING_TO_INVOICE");
  return { customerId, orderIds, period, snapshot, settings };
}

/** Befizetések: a számla rendelésein rögzített (nem sztornózott) befizetések és a számlára érkezett befizetések. */
async function invoicePaid(invoiceId: string) {
  const row = await env.DB!.prepare(
    "SELECT COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales_invoice_orders s ON s.order_id=p.order_id WHERE s.invoice_id=?),0) AS orderPaid,COALESCE((SELECT SUM(amount) FROM sales_invoice_payments WHERE invoice_id=?),0) AS invoicePaid",
  )
    .bind(invoiceId, invoiceId)
    .first<{ orderPaid: number; invoicePaid: number }>();
  return { orderPaid: row?.orderPaid ?? 0, invoicePaid: row?.invoicePaid ?? 0 };
}

/**
 * A rendelések befizetéseinek és a számla-befizetéseknek az átadása az Obliónak (forrásonként egyszer). A sztornózott befizetés
 * nem megy át; ha egy már átadott befizetést utólag sztornóztak, azt az Oblióban kézzel kell törölni (az API erre nem ad végpontot).
 */
async function syncCollects(inv: InvoiceRow, settings: BillingSettings) {
  if (inv.status !== "issued" || inv.kind === "storno") return { sent: 0, failed: 0 };
  const DB = env.DB!;
  const now = new Date().toISOString();
  const [orderPays, invoicePays] = await Promise.all([
    DB.prepare("SELECT p.id,p.method,p.amount,p.day FROM payments p JOIN sales_invoice_orders s ON s.order_id=p.order_id WHERE s.invoice_id=? AND p.reversal_of IS NULL AND p.reversed_by IS NULL").bind(inv.id).all<{ id: string; method: "cash" | "card"; amount: number; day: string }>(),
    DB.prepare("SELECT id,amount,day,reference FROM sales_invoice_payments WHERE invoice_id=? AND reversal_of IS NULL AND NOT EXISTS (SELECT 1 FROM sales_invoice_payments r WHERE r.reversal_of=sales_invoice_payments.id)").bind(inv.id).all<{ id: string; amount: number; day: string; reference: string }>(),
  ]);
  const sources = [
    ...orderPays.results.map((p) => ({ id: p.id, source: "order_payment", amount: p.amount, type: collectTypeFor(p.method, settings), day: p.day, doc: "GG-" + p.id.slice(0, 8) })),
    ...invoicePays.results.map((p) => ({ id: p.id, source: "invoice_payment", amount: p.amount, type: collectTypeFor("bank", settings), day: p.day, doc: p.reference || "GG-" + p.id.slice(0, 8) })),
  ];
  if (sources.length)
    await DB.batch(
      sources.map((s) =>
        DB.prepare("INSERT INTO sales_invoice_collects (source_id,invoice_id,source,amount,collect_type,status,last_error,created_at,sent_at) VALUES (?,?,?,?,?,'pending','',?,NULL) ON CONFLICT(source_id) DO NOTHING").bind(s.id, inv.id, s.source, s.amount, s.type, now),
      ),
    );
  const pending = (await DB.prepare("SELECT source_id AS sourceId FROM sales_invoice_collects WHERE invoice_id=? AND status IN ('pending','failed')").bind(inv.id).all<{ sourceId: string }>()).results;
  const client = oblioClient(settings.mode);
  let sent = 0,
    failed = 0;
  for (const { sourceId } of pending) {
    const s = sources.find((x) => x.id === sourceId);
    if (!s) {
      await DB.prepare("UPDATE sales_invoice_collects SET status='skipped' WHERE source_id=?").bind(sourceId).run();
      continue;
    }
    try {
      await client.collect(settings.companyCif, inv.oblioSeries, inv.oblioNumber, { type: s.type, documentNumber: s.doc, value: s.amount, issueDate: s.day, seriesName: settings.receiptSeries });
      await DB.prepare("UPDATE sales_invoice_collects SET status='sent',last_error='',sent_at=? WHERE source_id=?").bind(new Date().toISOString(), sourceId).run();
      sent++;
    } catch (e) {
      await DB.prepare("UPDATE sales_invoice_collects SET status='failed',last_error=? WHERE source_id=?").bind(e instanceof OblioError ? (e.code + " " + e.detail).trim() : "ERROR", sourceId).run();
      failed++;
    }
  }
  return { sent, failed };
}

/**
 * Kiállítás (vagy újrapróbálás) az Oblióban ugyanazzal az egyedi kulccsal. Elveszett válasz → „pending” marad, újrapróbálható;
 * elutasítás → „failed” az Oblio üzenetével. Siker után: SPV-be küldés (ha be van kapcsolva) és a befizetések átadása.
 */
async function send(id: string, actor: string) {
  const DB = env.DB!;
  const inv = await loadInvoice(id);
  if (inv.status === "issued" || inv.status === "stornoed") return inv;
  const settings = await loadBillingSettings();
  await DB.prepare("UPDATE sales_invoices SET attempts=attempts+1 WHERE id=?").bind(id).run();
  const now = new Date().toISOString();
  try {
    if (settings.mode === "live" && (!settings.companyCif || !settings.seriesName)) throw new OblioError("OBLIO_NOT_CONFIGURED");
    const client = oblioClient(settings.mode);
    const content = JSON.parse(inv.content) as InvoiceSnapshot & { oblioPayload?: Record<string, unknown> };
    const payload = inv.kind === "storno" ? { ...content.oblioPayload!, cif: settings.companyCif } : oblioInvoicePayload(content, settings, inv.idempotencyKey, inv.kind === "monthly" ? `${inv.period}/${orderCode(inv.customerId)}` : content.orders[0]?.code ?? "");
    const doc = await client.issueInvoice(payload);
    const statements: D1PreparedStatement[] = [
      DB.prepare("UPDATE sales_invoices SET status='issued',oblio_series=?,oblio_number=?,oblio_link=?,last_error='',issued_at=?,revision=revision+1 WHERE id=? AND status IN ('pending','failed')").bind(doc.seriesName, doc.number, doc.link, now, id),
      DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,'sales_invoice_issued',?,?,?)").bind(crypto.randomUUID(), actor, id, JSON.stringify({ series: doc.seriesName, number: doc.number, mode: client.mode }), now),
    ];
    if (inv.kind === "storno" && inv.stornoOf) {
      // Sztornó: az eredeti számla „sztornózva”, a rendelései újra számlázhatók, az avizok számla-hivatkozása törlődik.
      statements.push(
        DB.prepare("UPDATE sales_invoices SET status='stornoed',stornoed_by=?,revision=revision+1 WHERE id=? AND status='issued'").bind(id, inv.stornoOf),
        DB.prepare("UPDATE delivery_notes SET invoice_id=NULL WHERE invoice_id=?").bind(inv.stornoOf),
        DB.prepare("UPDATE sales_invoice_orders SET active=0 WHERE invoice_id=?").bind(inv.stornoOf),
      );
    } else {
      statements.push(DB.prepare("UPDATE delivery_notes SET invoice_id=? WHERE kind='issue' AND status='issued' AND order_id IN (SELECT order_id FROM sales_invoice_orders WHERE invoice_id=?)").bind(id, id));
    }
    await DB.batch(statements);
  } catch (e) {
    const code = e instanceof OblioError ? e.code : "OBLIO_UNAVAILABLE";
    const detail = e instanceof OblioError ? e.detail : "";
    // Bizonytalan (hálózat, időtúllépés) → pending: ugyanazzal a kulccsal újrapróbálható. Elutasítás / beállítás → failed.
    const status = code === "OBLIO_UNAVAILABLE" ? "pending" : "failed";
    await DB.prepare("UPDATE sales_invoices SET status=?,last_error=?,revision=revision+1 WHERE id=? AND status IN ('pending','failed')").bind(status, (code + (detail ? ": " + detail : "")).slice(0, 400), id).run();
    return loadInvoice(id);
  }
  const issued = await loadInvoice(id);
  if (issued.kind !== "storno") {
    if (settings.autoSpv) await spv(issued, settings).catch(() => null);
    await syncCollects(issued, settings).catch(() => null);
  }
  return loadInvoice(id);
}

/** SPV: még nem küldött számlát beküld, a beküldöttnek frissíti az állapotát. */
async function spv(inv: InvoiceRow, settings: BillingSettings) {
  if (inv.status !== "issued" && inv.status !== "stornoed") throw new BillingError("BILLING_NOT_ISSUED");
  const client = oblioClient(settings.mode);
  const result = inv.spvCode === null || inv.spvCode === -1 ? await client.sendEinvoice(settings.companyCif, inv.oblioSeries, inv.oblioNumber) : await client.einvoiceStatus(settings.companyCif, inv.oblioSeries, inv.oblioNumber);
  if (result)
    await env.DB!.prepare("UPDATE sales_invoices SET spv_code=?,spv_text=?,spv_checked_at=? WHERE id=?").bind(result.code, result.text.slice(0, 400), new Date().toISOString(), inv.id).run();
}

function summary(inv: InvoiceRow, paid: { orderPaid: number; invoicePaid: number }, customerName: string) {
  const c = JSON.parse(inv.content) as InvoiceSnapshot;
  const balance = inv.kind === "storno" ? { paid: 0, open: 0 } : invoiceOpen(inv.total, paid.orderPaid, paid.invoicePaid);
  return {
    id: inv.id,
    kind: inv.kind,
    customerId: inv.customerId,
    customerName: c.buyer?.name || customerName,
    period: inv.period,
    status: inv.status,
    total: inv.total,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    series: inv.oblioSeries,
    number: inv.oblioNumber,
    link: inv.oblioLink,
    spv: spvState(inv.spvCode),
    spvText: inv.spvText,
    lastError: inv.lastError,
    attempts: inv.attempts,
    stornoOf: inv.stornoOf,
    stornoedBy: inv.stornoedBy,
    orders: c.orders ?? [],
    notes: c.notes ?? [],
    ...balance,
    overdue: inv.status === "issued" && balance.open > 0 && !!inv.dueDate && inv.dueDate < today(),
  };
}

export async function handleBilling(path: string, body: unknown, session: Session, write: boolean, req: Request): Promise<Response> {
  if (!officeRoles.includes(session.role)) throw new BillingError("FORBIDDEN", 403);
  const DB = env.DB!;
  const params = new URL(req.url).searchParams;
  const actor = session.userId;
  const admin = isAdmin(session.role);

  if (!write && path === "/api/billing/customer-mode") {
    const customerId = z.string().min(1).max(200).parse(params.get("customerId"));
    const modes = await billingModes([customerId]);
    return json({ mode: modes.get(customerId) ?? "receipt" });
  }

  if (!write && path === "/api/billing") {
    const period = params.get("period") ?? today().slice(0, 7);
    const { from, to } = monthRange(period);
    const [settings, profiles, customers, invoices, candidates] = await Promise.all([
      loadBillingSettings(),
      DB.prepare(`SELECT ${profileColumns} FROM customer_billing`).all<BillingProfile>(),
      DB.prepare("SELECT id,name FROM customers ORDER BY name").all<{ id: string; name: string }>(),
      DB.prepare(`SELECT ${invoiceColumns} FROM sales_invoices WHERE (issue_date>=? AND issue_date<=?) OR status IN ('pending','failed') OR (status='issued' AND kind<>'storno') ORDER BY created_at DESC LIMIT 300`).bind(from, to).all<InvoiceRow>(),
      DB.prepare(
        "SELECT o.customer_id AS customerId,COUNT(*) AS orders,SUM(o.delivery_fee+COALESCE((SELECT SUM(price*quantity) FROM order_items i WHERE i.order_id=o.id),0)) AS total FROM orders o JOIN customer_billing b ON b.customer_id=o.customer_id AND b.mode='monthly' WHERE o.date>=? AND o.date<=? AND o.status='confirmed' AND o.delivery='delivered' AND NOT EXISTS (SELECT 1 FROM sales_invoice_orders s WHERE s.order_id=o.id AND s.active=1) GROUP BY o.customer_id",
      )
        .bind(from, to)
        .all<{ customerId: string; orders: number; total: number }>(),
    ]);
    const name = (id: string) => customers.results.find((c) => c.id === id)?.name ?? "";
    const list = await Promise.all(invoices.results.map(async (i) => summary(i, await invoicePaid(i.id), name(i.customerId))));
    const env2 = env as unknown as { OBLIO_CLIENT_ID?: string; OBLIO_CLIENT_SECRET?: string };
    return json({
      period,
      isAdmin: admin,
      settings,
      liveConfigured: !!env2.OBLIO_CLIENT_ID && !!env2.OBLIO_CLIENT_SECRET,
      cashCollectTypes: CASH_COLLECT_TYPES,
      customers: customers.results,
      profiles: profiles.results.map((p) => ({ ...p, error: p.mode === "receipt" ? null : profileError(p) })),
      candidates: candidates.results.map((c) => {
        const p = profiles.results.find((x) => x.customerId === c.customerId);
        return { ...c, name: p?.name || name(c.customerId), error: p ? profileError(p) : "BILLING_PROFILE_REQUIRED" };
      }),
      invoices: list.filter((i) => i.issueDate >= from && i.issueDate <= to || i.status === "pending" || i.status === "failed"),
      receivables: list.filter((i) => i.status === "issued" && i.kind !== "storno" && i.open > 0),
    });
  }
  if (!write && path === "/api/billing/preview") {
    const kind = params.get("kind");
    const p = kind === "monthly" ? await prepare({ kind: "monthly", customerId: z.string().min(1).parse(params.get("customerId")), period: z.string().parse(params.get("period")) }) : await prepare({ kind: "order", orderId: z.string().min(1).parse(params.get("orderId")) });
    return json({ snapshot: p.snapshot, orders: p.orderIds.length });
  }
  if (!write && path === "/api/billing/order") {
    const id = z.string().min(1).max(200).parse(params.get("id"));
    const o = await DB.prepare("SELECT customer_id AS customerId FROM orders WHERE id=?").bind(id).first<{ customerId: string }>();
    if (!o) throw new BillingError("NOT_FOUND", 404);
    const [profile, inv] = await Promise.all([
      loadProfile(o.customerId),
      DB.prepare(`SELECT ${invoiceColumns.split(",").map((c) => "i." + c.trim()).join(",")} FROM sales_invoices i JOIN sales_invoice_orders s ON s.invoice_id=i.id WHERE s.order_id=? AND s.active=1`).bind(id).first<InvoiceRow>(),
    ]);
    return json({
      mode: profile?.mode ?? "receipt",
      profileError: profile && profile.mode !== "receipt" ? profileError(profile) : null,
      invoice: inv ? summary(inv, await invoicePaid(inv.id), "") : null,
    });
  }
  if (!write && path === "/api/billing/simulated-doc") {
    const key = z.string().min(1).max(200).parse(params.get("key"));
    const row = await DB.prepare("SELECT series_name AS seriesName,number,payload FROM oblio_simulated WHERE idempotency_key=?").bind(key).first<{ seriesName: string; number: number; payload: string }>();
    if (!row) throw new BillingError("NOT_FOUND", 404);
    return new Response(simulatedHtml(row.seriesName, row.number, JSON.parse(row.payload)), {
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Cache-Control": "private, no-store" },
    });
  }
  if (!write) return json({ error: "NOT_FOUND" }, 404);
  const now = new Date().toISOString();

  if (path === "/api/billing/approve") {
    // A kliens kattintásonként egy kulcsot küld: dupla kattintás és újraküldés ugyanazt a számlakérést találja meg.
    const d = z
      .union([
        z.object({ kind: z.literal("order"), orderId: z.string().min(1).max(200), clientKey: z.string().uuid() }).strict(),
        z.object({ kind: z.literal("monthly"), customerId: z.string().min(1).max(200), period: z.string().regex(/^\d{4}-\d{2}$/), clientKey: z.string().uuid() }).strict(),
      ])
      .parse(body);
    const existing = await DB.prepare("SELECT id FROM sales_invoices WHERE idempotency_key=?").bind(d.clientKey).first<{ id: string }>();
    if (existing) return json({ ok: true, invoice: summary(await send(existing.id, actor), await invoicePaid(existing.id), "") });
    const p = await prepare(d.kind === "order" ? { kind: "order", orderId: d.orderId } : { kind: "monthly", customerId: d.customerId, period: d.period });
    const id = crypto.randomUUID();
    try {
      await DB.batch([
        DB.prepare("INSERT INTO sales_invoices (id,kind,customer_id,period,idempotency_key,status,content,total,issue_date,due_date,created_by,created_at) VALUES (?,?,?,?,?,'pending',?,?,?,?,?,?)").bind(
          id,
          d.kind,
          p.customerId,
          d.kind === "monthly" ? p.period : "",
          d.clientKey,
          JSON.stringify(p.snapshot),
          p.snapshot.total,
          p.snapshot.issueDate,
          p.snapshot.dueDate,
          actor,
          now,
        ),
        ...p.orderIds.map((orderId) => DB.prepare("INSERT INTO sales_invoice_orders (invoice_id,order_id,active) VALUES (?,?,1)").bind(id, orderId)),
        DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,'sales_invoice_approved',?,?,?)").bind(crypto.randomUUID(), actor, id, JSON.stringify({ kind: d.kind, orders: p.orderIds.length, total: p.snapshot.total }), now),
      ]);
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e;
      const again = await DB.prepare("SELECT id FROM sales_invoices WHERE idempotency_key=?").bind(d.clientKey).first<{ id: string }>();
      if (again) return json({ ok: true, invoice: summary(await send(again.id, actor), await invoicePaid(again.id), "") });
      throw new BillingError("BILLING_ALREADY_INVOICED", 409);
    }
    return json({ ok: true, invoice: summary(await send(id, actor), await invoicePaid(id), "") }, 201);
  }

  if (path === "/api/billing/send") {
    const d = z.object({ id: z.string().uuid() }).strict().parse(body);
    const inv = await send(d.id, actor);
    return json({ ok: true, invoice: summary(inv, await invoicePaid(inv.id), "") });
  }

  if (path === "/api/billing/spv") {
    const d = z.object({ id: z.string().uuid() }).strict().parse(body);
    try {
      await spv(await loadInvoice(d.id), await loadBillingSettings());
    } catch (e) {
      if (e instanceof OblioError) throw new BillingError(e.code, 502);
      throw e;
    }
    return json({ ok: true });
  }

  if (path === "/api/billing/collect-sync") {
    const d = z.object({ id: z.string().uuid() }).strict().parse(body);
    return json({ ok: true, ...(await syncCollects(await loadInvoice(d.id), await loadBillingSettings())) });
  }

  if (path === "/api/billing/payment") {
    // Utólagos befizetés a számlára (utalás), részletben is; átadás az Obliónak.
    const d = z.object({ invoiceId: z.string().uuid(), amount: z.number().int().min(1).max(100_000_000), reference: z.string().trim().max(60) }).strict().parse(body);
    const inv = await loadInvoice(d.invoiceId);
    if (inv.status !== "issued" || inv.kind === "storno") throw new BillingError("BILLING_NOT_ISSUED");
    const paid = await invoicePaid(inv.id);
    if (d.amount > invoiceOpen(inv.total, paid.orderPaid, paid.invoicePaid).open) throw new BillingError("PAYMENT_TOO_MUCH");
    const id = crypto.randomUUID();
    await DB.batch([
      DB.prepare(
        "INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN (SELECT total FROM sales_invoices WHERE id=? AND status='issued')-COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales_invoice_orders s ON s.order_id=p.order_id WHERE s.invoice_id=?),0)-COALESCE((SELECT SUM(amount) FROM sales_invoice_payments WHERE invoice_id=?),0)>=? THEN ? ELSE NULL END,'sales_invoice_paid',?,?,?)",
      ).bind(crypto.randomUUID(), inv.id, inv.id, inv.id, d.amount, actor, inv.id, JSON.stringify({ amount: d.amount, reference: d.reference }), now),
      DB.prepare("INSERT INTO sales_invoice_payments (id,invoice_id,day,amount,reference,reversal_of,actor,created_at) VALUES (?,?,?,?,?,NULL,?,?)").bind(id, inv.id, today(), d.amount, d.reference, actor, now),
    ]).catch((e: Error) => {
      if (/NOT NULL/.test(e.message)) throw new BillingError("CONFLICT", 409);
      throw e;
    });
    const sync = await syncCollects(inv, await loadBillingSettings()).catch(() => ({ sent: 0, failed: 1 }));
    return json({ ok: true, ...sync });
  }

  if (path === "/api/billing/storno") {
    if (!admin) throw new BillingError("FORBIDDEN", 403);
    const d = z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(300), clientKey: z.string().uuid() }).strict().parse(body);
    const existing = await DB.prepare("SELECT id FROM sales_invoices WHERE idempotency_key=?").bind(d.clientKey).first<{ id: string }>();
    if (existing) return json({ ok: true, invoice: summary(await send(existing.id, actor), { orderPaid: 0, invoicePaid: 0 }, "") });
    const inv = await loadInvoice(d.id);
    if (inv.status !== "issued" || inv.kind === "storno") throw new BillingError("BILLING_NOT_ISSUED");
    if (await DB.prepare("SELECT 1 FROM sales_invoices WHERE storno_of=? AND status IN ('pending','failed','issued')").bind(inv.id).first()) throw new BillingError("BILLING_STORNO_EXISTS", 409);
    const settings = await loadBillingSettings();
    const content = JSON.parse(inv.content) as InvoiceSnapshot;
    const base = oblioInvoicePayload(content, settings, d.clientKey, "STORNO " + inv.oblioSeries + inv.oblioNumber);
    const oblioPayload = {
      cif: settings.companyCif,
      client: base.client,
      issueDate: today(),
      seriesName: settings.stornoSeriesName || settings.seriesName,
      language: "RO",
      useStock: 0,
      mentions: "Stornare: " + d.reason,
      idempotencyKey: d.clientKey,
      referenceDocument: { type: "Factura", refund: 1, seriesName: inv.oblioSeries, number: Number(inv.oblioNumber) || inv.oblioNumber },
    };
    const id = crypto.randomUUID();
    await DB.batch([
      DB.prepare("INSERT INTO sales_invoices (id,kind,customer_id,period,idempotency_key,status,content,total,issue_date,due_date,storno_of,created_by,created_at) VALUES (?,'storno',?,?,?,'pending',?,?,?,'',?,?,?)").bind(
        id,
        inv.customerId,
        inv.period,
        d.clientKey,
        JSON.stringify({ ...content, oblioPayload, reason: d.reason }),
        -inv.total,
        today(),
        inv.id,
        actor,
        now,
      ),
      DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,'sales_invoice_storno_requested',?,?,?)").bind(crypto.randomUUID(), actor, inv.id, JSON.stringify({ reason: d.reason }), now),
    ]);
    return json({ ok: true, invoice: summary(await send(id, actor), { orderPaid: 0, invoicePaid: 0 }, "") }, 201);
  }

  if (path === "/api/billing/profile") {
    const d = z
      .object({
        customerId: z.string().min(1).max(200),
        revision: z.number().int().min(0),
        kind: z.enum(["person", "company"]),
        mode: z.enum(["receipt", "per_order", "monthly"]),
        name: z.string().trim().max(200),
        cif: z.string().trim().max(30),
        regCom: z.string().trim().max(40),
        address: z.string().trim().max(300),
        city: z.string().trim().max(100),
        county: z.string().trim().max(100),
        country: z.string().trim().max(60),
        email: z.string().trim().max(200),
        paymentDays: z.number().int().min(0).max(120),
      })
      .strict()
      .parse(body);
    if (!(await DB.prepare("SELECT 1 FROM customers WHERE id=?").bind(d.customerId).first())) throw new BillingError("NOT_FOUND", 404);
    const p = { ...d, cif: d.kind === "company" ? normalizeTaxId(d.cif) : "" };
    if (p.mode !== "receipt") {
      const error = profileError(p);
      if (error) throw new BillingError(error);
    }
    const r = await DB.batch([
      DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN COALESCE((SELECT revision FROM customer_billing WHERE customer_id=?),0)=? THEN ? ELSE NULL END,'customer_billing_saved',?,?,?)").bind(
        crypto.randomUUID(),
        p.customerId,
        p.revision,
        actor,
        p.customerId,
        JSON.stringify({ kind: p.kind, mode: p.mode, cif: p.cif }),
        now,
      ),
      DB.prepare(
        "INSERT INTO customer_billing (customer_id,kind,mode,name,cif,reg_com,address,city,county,country,email,payment_days,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT(customer_id) DO UPDATE SET kind=excluded.kind,mode=excluded.mode,name=excluded.name,cif=excluded.cif,reg_com=excluded.reg_com,address=excluded.address,city=excluded.city,county=excluded.county,country=excluded.country,email=excluded.email,payment_days=excluded.payment_days,revision=customer_billing.revision+1,updated_at=excluded.updated_at",
      ).bind(p.customerId, p.kind, p.mode, p.name, p.cif, p.regCom, p.address, p.city, p.county, p.country || "România", p.email, p.paymentDays, now),
    ]).catch((e: Error) => {
      if (/NOT NULL/.test(e.message)) throw new BillingError("CONFLICT", 409);
      throw e;
    });
    return json({ ok: true, changes: r.length });
  }

  if (path === "/api/billing/settings") {
    if (!admin) throw new BillingError("FORBIDDEN", 403);
    const d = z
      .object({
        revision: z.number().int().min(0),
        mode: z.enum(["simulated", "live"]),
        companyCif: z.string().trim().max(30),
        seriesName: z.string().trim().max(20),
        stornoSeriesName: z.string().trim().max(20),
        vatFoodBps: z.number().int().min(0).max(5000),
        vatDeliveryBps: z.number().int().min(0).max(5000),
        cashCollectType: z.enum(CASH_COLLECT_TYPES),
        receiptSeries: z.string().trim().max(20),
        autoSpv: z.boolean(),
      })
      .strict()
      .parse(body);
    if (d.mode === "live" && (!normalizeTaxId(d.companyCif) || !d.seriesName)) throw new BillingError("OBLIO_NOT_CONFIGURED");
    if (d.cashCollectType === "Chitanta" && !d.receiptSeries) throw new BillingError("BILLING_RECEIPT_SERIES");
    await DB.batch([
      DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN COALESCE((SELECT revision FROM billing_settings WHERE id=1),0)=? THEN ? ELSE NULL END,'billing_settings_saved','billing_settings',?,?)").bind(
        crypto.randomUUID(),
        d.revision,
        actor,
        JSON.stringify({ ...d, revision: undefined }),
        now,
      ),
      DB.prepare(
        "INSERT INTO billing_settings (id,mode,company_cif,series_name,storno_series_name,vat_food_bps,vat_delivery_bps,cash_collect_type,receipt_series,auto_spv,revision) VALUES (1,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode,company_cif=excluded.company_cif,series_name=excluded.series_name,storno_series_name=excluded.storno_series_name,vat_food_bps=excluded.vat_food_bps,vat_delivery_bps=excluded.vat_delivery_bps,cash_collect_type=excluded.cash_collect_type,receipt_series=excluded.receipt_series,auto_spv=excluded.auto_spv,revision=billing_settings.revision+1",
      ).bind(d.mode, normalizeTaxId(d.companyCif), d.seriesName, d.stornoSeriesName, d.vatFoodBps, d.vatDeliveryBps, d.cashCollectType, d.receiptSeries, d.autoSpv ? 1 : 0),
    ]).catch((e: Error) => {
      if (/NOT NULL/.test(e.message)) throw new BillingError("CONFLICT", 409);
      throw e;
    });
    return json({ ok: true });
  }

  if (path === "/api/billing/check") {
    if (!admin) throw new BillingError("FORBIDDEN", 403);
    const d = z.object({ mode: z.enum(["simulated", "live"]) }).strict().parse(body);
    try {
      return json({ ok: true, ...(await oblioClient(d.mode).check((await loadBillingSettings()).companyCif)) });
    } catch (e) {
      if (e instanceof OblioError) throw new BillingError(e.code, 502);
      throw e;
    }
  }
  return json({ error: "NOT_FOUND" }, 404);
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** A szimulált számla megjelenítése (a valódi Oblio-PDF helyett), jól láthatóan „SIMULAT” jelöléssel. */
function simulatedHtml(seriesName: string, number: number, p: { client?: Record<string, unknown>; products?: { name: string; price: number; quantity: number; vatPercentage: number }[]; issueDate?: string; dueDate?: string; mentions?: string; referenceDocument?: { seriesName: string; number: unknown } }) {
  const rows = (p.products ?? []).map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td class="n">${esc(l.quantity)}</td><td class="n">${Number(l.price).toFixed(2)}</td><td class="n">${esc(l.vatPercentage)}%</td><td class="n">${(Number(l.price) * Number(l.quantity)).toFixed(2)}</td></tr>`).join("");
  const total = (p.products ?? []).reduce((s, l) => s + Number(l.price) * Number(l.quantity), 0);
  const c = p.client ?? {};
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>${esc(seriesName)} ${number}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px}.sim{color:#a00;font-weight:bold;border:2px solid #a00;padding:6px;display:inline-block}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #444;padding:4px}.n{text-align:right}</style></head><body>
<p class="sim">SIMULAT – nu este o factură reală (Oblio nu a fost apelat)</p>
<h1>${p.referenceDocument ? "FACTURĂ STORNO" : "FACTURĂ"} ${esc(seriesName)} ${String(number).padStart(4, "0")}</h1>
${p.referenceDocument ? `<p>Stornare la ${esc(p.referenceDocument.seriesName)} ${esc(p.referenceDocument.number)}</p>` : ""}
<p>Data: ${esc(p.issueDate)}${p.dueDate ? " · Scadență: " + esc(p.dueDate) : ""}</p>
<p>Cumpărător: <b>${esc(c.name)}</b> ${c.cif ? "· CIF " + esc(c.cif) : ""} ${c.rc ? "· " + esc(c.rc) : ""}<br>${esc(c.address)} ${esc(c.city)} ${esc(c.state)}</p>
${rows ? `<table><thead><tr><th>Nr.</th><th>Denumire</th><th>Cant.</th><th>Preț cu TVA</th><th>TVA</th><th>Valoare</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5">Total</td><td class="n"><b>${total.toFixed(2)}</b></td></tr></tfoot></table>` : ""}
${p.mentions ? `<p>${esc(p.mentions)}</p>` : ""}</body></html>`;
}
