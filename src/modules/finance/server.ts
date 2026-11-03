import { env } from "cloudflare:workers";
import { z } from "zod";
import type { Session } from "../access/domain";
import { isAdmin } from "../access/domain";
import { today } from "../shared/domain";
import { validDay } from "../menu/domain";
import { loadSettings as loadLabelSettings } from "../labels/server";
import {
  MANUAL_CASH_KINDS,
  cashDay,
  courierCash,
  handoverError,
  orderBalance,
  paymentError,
  renderCashRegisterHtml,
  supplierBalance,
  zReconcile,
  type CashEntry,
  type Payment,
  type PaymentMethod,
} from "./domain";

/**
 * Pénzügy és pénztár (v76). Iroda (tulajdonos, admin, diszpécser): befizetés, futár-leadás, pénztártétel, Z-jelentés,
 * nap lezárása. Admin: beszállítói kifizetés, pénztárnap visszanyitása. A futár a futármodulon át rögzít (recordPaymentStatements).
 * Minden írás egy D1-kötegben; az első utasítás a napló, amelynek szereplője NULL lesz (és a köteg visszagörgetődik),
 * ha a feltétel (hátralék, pénztáregyenleg, nyitott nap, változat) közben megváltozott.
 */
export class FinanceError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const officeRoles = ["owner", "admin", "dispatcher"];
const money = z.number().int().min(1).max(100_000_000);
const day = z.string().refine(validDay);

/** A rendelés hátraléka SQL-ben (a v76 előtti „fizetve” jelölés befizetés nélkül 0 hátralék). */
const dueSql = `(SELECT CASE WHEN o.payment='paid' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id) THEN 0 ELSE COALESCE((SELECT SUM(i.price*i.quantity) FROM order_items i WHERE i.order_id=o.id),0)+o.delivery_fee-COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id=o.id),0) END FROM orders o WHERE o.id=?)`;
const cashOpenSql = "NOT EXISTS (SELECT 1 FROM cash_days WHERE day=? AND status='closed')";
const cashBalanceSql = "(SELECT COALESCE(SUM(amount),0) FROM cash_entries)";
const paymentColumns =
  "id,order_id AS orderId,day,method,amount,collected_by AS collectedBy,collector_id AS collectorId,collector_name AS collectorName,reversal_of AS reversalOf,reversed_by AS reversedBy,handover_id AS handoverId,note,created_at AS createdAt";

export async function orderPayments(orderId: string) {
  return (await env.DB!.prepare(`SELECT ${paymentColumns} FROM payments WHERE order_id=? ORDER BY created_at`).bind(orderId).all<Payment>()).results;
}
async function orderTotal(orderId: string) {
  const row = await env.DB!.prepare(
    "SELECT o.status,o.payment,o.revision,o.delivery_fee+COALESCE((SELECT SUM(price*quantity) FROM order_items WHERE order_id=o.id),0) AS total FROM orders o WHERE o.id=?",
  )
    .bind(orderId)
    .first<{ status: string; payment: string; revision: number; total: number }>();
  if (!row) throw new FinanceError("NOT_FOUND", 404);
  return row;
}
/** A rendelés fizetési állapota a befizetések alapján (a megmaradt „paid/unpaid” mezőt frissítjük). */
const syncPaymentSql = `UPDATE orders SET payment=CASE WHEN ${dueSql.replaceAll("o.id=?", "o.id=orders.id")}<=0 THEN 'paid' ELSE 'unpaid' END WHERE id=?`;

/**
 * Egy befizetés utasításai (a futár kézbesítésével közös kötegben is használható). A napló-őr csak akkor enged, ha a rendelés
 * visszaigazolt, a hátralék legalább ekkora, és (iroda készpénzénél) a pénztárnap nyitott.
 */
export function recordPaymentStatements(p: { orderId: string; method: PaymentMethod; amount: number; collectedBy: "courier" | "office"; collectorId: string; collectorName: string; note: string; now: string; extraGuard?: { sql: string; binds: unknown[] } }) {
  const DB = env.DB!;
  const id = crypto.randomUUID(),
    d = today(),
    cashEntryId = p.method === "cash" && p.collectedBy === "office" ? crypto.randomUUID() : null;
  const guard = `EXISTS (SELECT 1 FROM orders WHERE id=? AND status='confirmed') AND ${dueSql}>=?${cashEntryId ? " AND " + cashOpenSql : ""}${p.extraGuard ? " AND " + p.extraGuard.sql : ""}`;
  const binds = [p.orderId, p.orderId, p.amount, ...(cashEntryId ? [d] : []), ...(p.extraGuard?.binds ?? [])];
  return [
    DB.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN ${guard} THEN ? ELSE NULL END,'payment_recorded',?,?,?)`).bind(
      crypto.randomUUID(),
      ...binds,
      p.collectorId,
      p.orderId,
      JSON.stringify({ method: p.method, amount: p.amount, by: p.collectedBy }),
      p.now,
    ),
    DB.prepare(
      "INSERT INTO payments (id,order_id,day,method,amount,collected_by,collector_id,collector_name,reversal_of,reversed_by,handover_id,cash_entry_id,note,created_at) VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,?,?)",
    ).bind(id, p.orderId, d, p.method, p.amount, p.collectedBy, p.collectorId, p.collectorName, cashEntryId, p.note, p.now),
    ...(cashEntryId
      ? [DB.prepare("INSERT INTO cash_entries (id,day,kind,amount,document,note,ref_id,reversal_of,actor,created_at) VALUES (?,?,'counter_sale',?,?,?,?,NULL,?,?)").bind(cashEntryId, d, p.amount, "", p.note, id, p.collectorId, p.now)]
      : []),
    DB.prepare(syncPaymentSql).bind(p.orderId),
  ];
}

/** A futár le nem adott készpénze és a hozzá tartozó befizetések. */
async function courierBalances() {
  const rows = (
    await env.DB!.prepare(`SELECT ${paymentColumns} FROM payments WHERE method='cash' AND collected_by='courier' AND handover_id IS NULL ORDER BY created_at`).all<Payment>()
  ).results;
  const ids = [...new Set(rows.map((r) => r.collectorId))];
  return ids.map((id) => ({ courierUserId: id, courierName: rows.find((r) => r.collectorId === id)?.collectorName ?? "", expected: courierCash(rows, id), payments: rows.filter((r) => r.collectorId === id) }));
}
export async function courierCashOnHand(userId: string) {
  return (await courierBalances()).find((c) => c.courierUserId === userId)?.expected ?? 0;
}

const cashColumns = "id,day,kind,amount,document,note,ref_id AS refId,reversal_of AS reversalOf,created_at AS createdAt";
async function cashView(date: string) {
  const DB = env.DB!;
  const [before, entries, dayRow] = await Promise.all([
    DB.prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM cash_entries WHERE day<?").bind(date).first<{ amount: number }>(),
    DB.prepare(`SELECT ${cashColumns} FROM cash_entries WHERE day=? ORDER BY created_at`).bind(date).all<CashEntry>(),
    DB.prepare("SELECT status,revision,opening,closing,closed_at AS closedAt FROM cash_days WHERE day=?").bind(date).first<{ status: "open" | "closed"; revision: number; opening: number; closing: number; closedAt: string | null }>(),
  ]);
  return { entries: entries.results, totals: cashDay([{ amount: before?.amount ?? 0 }], entries.results), status: dayRow?.status ?? "open", revision: dayRow?.revision ?? 0, closedAt: dayRow?.closedAt ?? null };
}

/** Lemondás befizetéssel: nettó befizetés mellett nem mondható le (előbb vissza kell téríteni / sztornózni). */
export async function cancelPaymentState(orderId: string) {
  const row = await env.DB!.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(amount),0) AS net FROM payments WHERE order_id=?").bind(orderId).first<{ n: number; net: number }>();
  return { hasRows: (row?.n ?? 0) > 0, net: row?.net ?? 0 };
}

export async function handleFinance(path: string, body: unknown, session: Session, write: boolean, req: Request): Promise<Response> {
  if (!officeRoles.includes(session.role)) throw new FinanceError("FORBIDDEN", 403);
  const DB = env.DB!;
  const params = new URL(req.url).searchParams;
  const actor = session.userId;
  if (!write && path === "/api/finance/order") {
    const id = z.string().min(1).max(200).parse(params.get("id"));
    const [order, payments] = await Promise.all([orderTotal(id), orderPayments(id)]);
    return json({ total: order.total, revision: order.revision, balance: orderBalance(order.total, payments, order.payment === "paid"), payments });
  }
  if (!write && path === "/api/finance/day") {
    const date = params.get("date") ?? today();
    if (!validDay(date)) throw new FinanceError("VALIDATION");
    const [cash, couriers, handovers, z, dayPayments, invoices, supplierPays] = await Promise.all([
      cashView(date),
      courierBalances(),
      DB.prepare("SELECT id,courier_name AS courierName,expected,counted,note,created_at AS createdAt FROM courier_handovers WHERE day=? ORDER BY created_at").bind(date).all(),
      DB.prepare("SELECT z_number AS zNumber,total,cash,card,note,revision FROM z_reports WHERE day=?").bind(date).first<{ zNumber: string; total: number; cash: number; card: number; note: string; revision: number }>(),
      DB.prepare("SELECT method,amount FROM payments WHERE day=?").bind(date).all<{ method: PaymentMethod; amount: number }>(),
      DB.prepare("SELECT id,supplier_name AS supplierName,series,number,issue_date AS issueDate,due_date AS dueDate,total,received_date AS receivedDate FROM supplier_invoices WHERE status='received' AND total IS NOT NULL ORDER BY issue_date").all<{ id: string; supplierName: string; series: string; number: string; issueDate: string; dueDate: string; total: number; receivedDate: string }>(),
      DB.prepare("SELECT id,invoice_id AS invoiceId,day,method,amount,reversal_of AS reversalOf,reversed_by AS reversedBy,note,created_at AS createdAt FROM supplier_payments ORDER BY created_at").all<{ id: string; invoiceId: string; day: string; method: "cash" | "bank"; amount: number; reversalOf: string | null; reversedBy: string | null; note: string; createdAt: string }>(),
    ]);
    const now = today();
    const suppliers = invoices.results
      .map((i) => {
        const pays = supplierPays.results.filter((p) => p.invoiceId === i.id);
        return { ...i, payments: pays, ...supplierBalance(i.total, pays, i.dueDate, now) };
      })
      .filter((i) => i.open > 0 || i.payments.some((p) => p.day === date));
    return json({
      date,
      isAdmin: isAdmin(session.role),
      cash,
      couriers: couriers.map((c) => ({ courierUserId: c.courierUserId, courierName: c.courierName, expected: c.expected, count: c.payments.length })),
      handovers: handovers.results,
      z: z ?? null,
      reconcile: zReconcile(z ?? null, dayPayments.results),
      suppliers,
    });
  }
  if (!write && path === "/api/finance/register") {
    const date = day.parse(params.get("date"));
    const [cash, { settings }] = await Promise.all([cashView(date), loadLabelSettings()]);
    return new Response(renderCashRegisterHtml(date, settings.producerName, cash.entries, cash.totals, cash.status === "closed"), {
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Cache-Control": "private, no-store" },
    });
  }
  if (!write) return json({ error: "NOT_FOUND" }, 404);
  const now = new Date().toISOString();
  const d0 = today();
  const run = async (statements: D1PreparedStatement[]) => {
    try {
      await DB.batch(statements);
    } catch (e) {
      if (/NOT NULL|UNIQUE|CHECK/i.test(String(e))) throw new FinanceError("CONFLICT", 409);
      throw e;
    }
  };
  /** Előzetes ellenőrzés érthető hibaüzenetért (a köteg őre ugyanezt újra ellenőrzi): nyitott mai pénztárnap, elég pénz kiadáshoz. */
  const requireCash = async (outflow = 0) => {
    const [closed, balance] = await Promise.all([
      DB.prepare("SELECT 1 FROM cash_days WHERE day=? AND status='closed'").bind(d0).first(),
      DB.prepare(`SELECT ${cashBalanceSql} AS balance`).first<{ balance: number }>(),
    ]);
    if (closed) throw new FinanceError("CASH_DAY_CLOSED", 409);
    if (outflow > 0 && (balance?.balance ?? 0) < outflow) throw new FinanceError("CASH_INSUFFICIENT", 409);
  };
  const audit = (action: string, guard: string, binds: unknown[], entity: string, detail: unknown) =>
    DB.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN ${guard} THEN ? ELSE NULL END,?,?,?,?)`).bind(crypto.randomUUID(), ...binds, actor, action, entity, JSON.stringify(detail), now);

  if (path === "/api/finance/payment") {
    const d = z.object({ orderId: z.string().min(1).max(200), revision: z.number().int().min(0), method: z.enum(["cash", "card"]), amount: money, note: z.string().trim().max(300) }).strict().parse(body);
    const [order, payments] = await Promise.all([orderTotal(d.orderId), orderPayments(d.orderId)]);
    if (order.status !== "confirmed") throw new FinanceError("PAYMENT_ORDER_STATE");
    if (order.revision !== d.revision) throw new FinanceError("CONFLICT", 409);
    const error = paymentError(d.amount, orderBalance(order.total, payments, order.payment === "paid").due);
    if (error) throw new FinanceError(error);
    if (d.method === "cash") await requireCash();
    await run([
      ...recordPaymentStatements({ ...d, collectedBy: "office", collectorId: actor, collectorName: session.name, now, extraGuard: { sql: "EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=?)", binds: [d.orderId, d.revision] } }),
      DB.prepare("UPDATE orders SET revision=revision+1 WHERE id=? AND revision=?").bind(d.orderId, d.revision),
    ]);
    return json({ ok: true });
  }

  if (path === "/api/finance/payment/reverse") {
    // Sztornó: ellentétes tétel. A futárnál lévő (le nem adott) készpénz csak a futár egyenlegét csökkenti; a már pénztárba
    // került készpénz (iroda vagy leadott futár) pénztár-kiadásként megy vissza.
    const d = z.object({ paymentId: z.string().uuid(), reason: z.string().trim().min(3).max(300) }).strict().parse(body);
    const p = await DB.prepare(`SELECT ${paymentColumns} FROM payments WHERE id=?`).bind(d.paymentId).first<Payment>();
    if (!p || p.reversalOf || p.reversedBy) throw new FinanceError("PAYMENT_NOT_REVERSIBLE", 409);
    const id = crypto.randomUUID();
    const inCash = p.method === "cash" && (p.collectedBy === "office" || !!p.handoverId);
    const cashEntryId = inCash ? crypto.randomUUID() : null;
    if (inCash) await requireCash(p.amount);
    const guard = `EXISTS (SELECT 1 FROM payments WHERE id=? AND reversed_by IS NULL) AND NOT EXISTS (SELECT 1 FROM payments WHERE id=? AND handover_id IS NOT NULL AND ?=0)${inCash ? ` AND ${cashOpenSql} AND ${cashBalanceSql}>=?` : ""}`;
    await run([
      audit("payment_reversed", guard, [p.id, p.id, p.handoverId ? 1 : 0, ...(inCash ? [d0, p.amount] : [])], p.orderId, { amount: p.amount, method: p.method, reason: d.reason }),
      DB.prepare(
        "INSERT INTO payments (id,order_id,day,method,amount,collected_by,collector_id,collector_name,reversal_of,reversed_by,handover_id,cash_entry_id,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)",
      ).bind(id, p.orderId, d0, p.method, -p.amount, p.collectedBy, p.collectorId, p.collectorName, p.id, inCash && p.collectedBy === "courier" ? p.handoverId : null, cashEntryId, d.reason, now),
      DB.prepare("UPDATE payments SET reversed_by=? WHERE id=? AND reversed_by IS NULL").bind(id, p.id),
      ...(cashEntryId ? [DB.prepare("INSERT INTO cash_entries (id,day,kind,amount,document,note,ref_id,reversal_of,actor,created_at) VALUES (?,?,'reversal',?,'',?,?,NULL,?,?)").bind(cashEntryId, d0, -p.amount, d.reason, id, actor, now)] : []),
      DB.prepare(syncPaymentSql).bind(p.orderId),
      DB.prepare("UPDATE orders SET revision=revision+1 WHERE id=?").bind(p.orderId),
    ]);
    return json({ ok: true });
  }

  if (path === "/api/finance/handover") {
    const d = z.object({ courierUserId: z.string().min(1).max(200), expected: z.number().int(), counted: z.number().int().min(0).max(100_000_000), note: z.string().trim().max(300) }).strict().parse(body);
    const courier = (await courierBalances()).find((c) => c.courierUserId === d.courierUserId);
    const expected = courier?.expected ?? 0;
    if (expected !== d.expected) throw new FinanceError("CONFLICT", 409);
    const error = handoverError(expected, d.counted, d.note);
    if (error) throw new FinanceError(error);
    await requireCash();
    const id = crypto.randomUUID(),
      cashEntryId = d.counted > 0 ? crypto.randomUUID() : null;
    const pending = "(SELECT COALESCE(SUM(amount),0) FROM payments WHERE method='cash' AND collected_by='courier' AND handover_id IS NULL AND collector_id=?)";
    await run([
      audit("courier_handover", `${pending}=? AND ${cashOpenSql}`, [d.courierUserId, expected, d0], d.courierUserId, { expected, counted: d.counted, note: d.note }),
      DB.prepare("INSERT INTO courier_handovers (id,courier_user_id,courier_name,day,expected,counted,note,cash_entry_id,actor,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id, d.courierUserId, courier?.courierName ?? "", d0, expected, d.counted, d.note, cashEntryId, actor, now),
      ...(cashEntryId
        ? [DB.prepare("INSERT INTO cash_entries (id,day,kind,amount,document,note,ref_id,reversal_of,actor,created_at) VALUES (?,?,'courier_handover',?,'',?,?,NULL,?,?)").bind(cashEntryId, d0, d.counted, (courier?.courierName ?? "") + (d.note ? " – " + d.note : ""), id, actor, now)]
        : []),
      DB.prepare("UPDATE payments SET handover_id=? WHERE method='cash' AND collected_by='courier' AND handover_id IS NULL AND collector_id=?").bind(id, d.courierUserId),
    ]);
    return json({ ok: true, id });
  }

  if (path === "/api/finance/cash") {
    const d = z.object({ kind: z.enum(["deposit", "bank_deposit", "other_in", "other_out"]), amount: money, document: z.string().trim().max(100), note: z.string().trim().min(1).max(300) }).strict().parse(body);
    const signed = d.amount * MANUAL_CASH_KINDS[d.kind];
    await requireCash(signed < 0 ? d.amount : 0);
    await run([
      audit("cash_entry_added", `${cashOpenSql}${signed < 0 ? ` AND ${cashBalanceSql}>=?` : ""}`, [d0, ...(signed < 0 ? [d.amount] : [])], d.kind, { amount: signed, document: d.document, note: d.note }),
      DB.prepare("INSERT INTO cash_entries (id,day,kind,amount,document,note,ref_id,reversal_of,actor,created_at) VALUES (?,?,?,?,?,?,NULL,NULL,?,?)").bind(crypto.randomUUID(), d0, d.kind, signed, d.document, d.note, actor, now),
    ]);
    return json({ ok: true });
  }

  if (path === "/api/finance/cash/reverse") {
    // Csak a kézzel rögzített tétel sztornózható itt; a befizetésből / kifizetésből eredőt a forrásánál kell sztornózni.
    const d = z.object({ entryId: z.string().uuid(), reason: z.string().trim().min(3).max(300) }).strict().parse(body);
    const e = await DB.prepare(`SELECT ${cashColumns} FROM cash_entries WHERE id=?`).bind(d.entryId).first<CashEntry>();
    if (!e || !(e.kind in MANUAL_CASH_KINDS)) throw new FinanceError("CASH_NOT_REVERSIBLE", 409);
    await requireCash(e.amount > 0 ? e.amount : 0);
    await run([
      audit("cash_entry_reversed", `NOT EXISTS (SELECT 1 FROM cash_entries WHERE reversal_of=?) AND ${cashOpenSql}${e.amount > 0 ? ` AND ${cashBalanceSql}>=?` : ""}`, [e.id, d0, ...(e.amount > 0 ? [e.amount] : [])], e.id, { amount: -e.amount, reason: d.reason }),
      DB.prepare("INSERT INTO cash_entries (id,day,kind,amount,document,note,ref_id,reversal_of,actor,created_at) VALUES (?,?,'reversal',?,?,?,NULL,?,?,?)").bind(crypto.randomUUID(), d0, -e.amount, e.document, d.reason, e.id, actor, now),
    ]);
    return json({ ok: true });
  }

  if (path === "/api/finance/day/close") {
    const d = z.object({ date: day, revision: z.number().int().min(0) }).strict().parse(body);
    if (d.date > d0) throw new FinanceError("CASH_DAY_FUTURE");
    const cash = await cashView(d.date);
    if (cash.status === "closed") throw new FinanceError("CASH_DAY_CLOSED", 409);
    if (cash.revision !== d.revision) throw new FinanceError("CONFLICT", 409);
    await run([
      audit("cash_day_closed", "COALESCE((SELECT revision FROM cash_days WHERE day=?),0)=? AND (SELECT COUNT(*) FROM cash_entries WHERE day=?)=?", [d.date, d.revision, d.date, cash.entries.length], d.date, cash.totals),
      DB.prepare(
        "INSERT INTO cash_days (day,status,opening,closing,revision,closed_by,closed_at) VALUES (?,'closed',?,?,1,?,?) ON CONFLICT(day) DO UPDATE SET status='closed',opening=excluded.opening,closing=excluded.closing,revision=cash_days.revision+1,closed_by=excluded.closed_by,closed_at=excluded.closed_at WHERE cash_days.status='open'",
      ).bind(d.date, cash.totals.opening, cash.totals.closing, actor, now),
    ]);
    return json({ ok: true });
  }

  if (path === "/api/finance/day/reopen") {
    if (!isAdmin(session.role)) throw new FinanceError("FORBIDDEN", 403);
    const d = z.object({ date: day, revision: z.number().int().min(0), reason: z.string().trim().min(3).max(300) }).strict().parse(body);
    await run([
      audit("cash_day_reopened", "EXISTS (SELECT 1 FROM cash_days WHERE day=? AND status='closed' AND revision=?)", [d.date, d.revision], d.date, { reason: d.reason }),
      DB.prepare("UPDATE cash_days SET status='open',revision=revision+1,closed_by=NULL,closed_at=NULL WHERE day=? AND status='closed' AND revision=?").bind(d.date, d.revision),
    ]);
    return json({ ok: true });
  }

  if (path === "/api/finance/z") {
    const d = z
      .object({ date: day, revision: z.number().int().min(0), zNumber: z.string().trim().min(1).max(30), total: z.number().int().min(0).max(100_000_000), cash: z.number().int().min(0).max(100_000_000), card: z.number().int().min(0).max(100_000_000), note: z.string().trim().max(300) })
      .strict()
      .parse(body);
    if (d.date > d0) throw new FinanceError("CASH_DAY_FUTURE");
    await run([
      audit("z_report_saved", "COALESCE((SELECT revision FROM z_reports WHERE day=?),0)=?", [d.date, d.revision], d.date, { z: d.zNumber, total: d.total, cash: d.cash, card: d.card }),
      DB.prepare(
        "INSERT INTO z_reports (day,z_number,total,cash,card,note,revision,actor,updated_at) VALUES (?,?,?,?,?,?,1,?,?) ON CONFLICT(day) DO UPDATE SET z_number=excluded.z_number,total=excluded.total,cash=excluded.cash,card=excluded.card,note=excluded.note,revision=z_reports.revision+1,actor=excluded.actor,updated_at=excluded.updated_at",
      ).bind(d.date, d.zNumber, d.total, d.cash, d.card, d.note, actor, now),
    ]);
    return json({ ok: true });
  }

  if (path === "/api/finance/supplier-payment") {
    if (!isAdmin(session.role)) throw new FinanceError("FORBIDDEN", 403);
    const d = z.object({ invoiceId: z.string().uuid(), amount: money, method: z.enum(["cash", "bank"]), note: z.string().trim().max(300) }).strict().parse(body);
    const inv = await DB.prepare("SELECT status,total,series,number,supplier_name AS supplierName FROM supplier_invoices WHERE id=?").bind(d.invoiceId).first<{ status: string; total: number | null; series: string; number: string; supplierName: string }>();
    if (!inv || inv.status !== "received" || inv.total === null) throw new FinanceError("SUPPLIER_PAYMENT_STATE");
    const paid = await DB.prepare("SELECT COALESCE(SUM(amount),0) AS paid FROM supplier_payments WHERE invoice_id=?").bind(d.invoiceId).first<{ paid: number }>();
    if (d.amount > inv.total - (paid?.paid ?? 0)) throw new FinanceError("PAYMENT_TOO_MUCH");
    if (d.method === "cash") await requireCash(d.amount);
    const id = crypto.randomUUID(),
      cashEntryId = d.method === "cash" ? crypto.randomUUID() : null;
    const open = "(SELECT total FROM supplier_invoices WHERE id=?)-(SELECT COALESCE(SUM(amount),0) FROM supplier_payments WHERE invoice_id=?)";
    await run([
      audit("supplier_payment_recorded", `${open}>=?${cashEntryId ? ` AND ${cashOpenSql} AND ${cashBalanceSql}>=?` : ""}`, [d.invoiceId, d.invoiceId, d.amount, ...(cashEntryId ? [d0, d.amount] : [])], d.invoiceId, { amount: d.amount, method: d.method }),
      DB.prepare("INSERT INTO supplier_payments (id,invoice_id,day,method,amount,reversal_of,reversed_by,cash_entry_id,note,actor,created_at) VALUES (?,?,?,?,?,NULL,NULL,?,?,?,?)").bind(id, d.invoiceId, d0, d.method, d.amount, cashEntryId, d.note, actor, now),
      ...(cashEntryId
        ? [DB.prepare("INSERT INTO cash_entries (id,day,kind,amount,document,note,ref_id,reversal_of,actor,created_at) VALUES (?,?,'supplier_payment',?,?,?,?,NULL,?,?)").bind(cashEntryId, d0, -d.amount, (inv.series + " " + inv.number).trim(), inv.supplierName + (d.note ? " – " + d.note : ""), id, actor, now)]
        : []),
    ]);
    return json({ ok: true });
  }

  if (path === "/api/finance/supplier-payment/reverse") {
    if (!isAdmin(session.role)) throw new FinanceError("FORBIDDEN", 403);
    const d = z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(300) }).strict().parse(body);
    const p = await DB.prepare("SELECT id,invoice_id AS invoiceId,method,amount,reversal_of AS reversalOf,reversed_by AS reversedBy FROM supplier_payments WHERE id=?").bind(d.id).first<{ id: string; invoiceId: string; method: "cash" | "bank"; amount: number; reversalOf: string | null; reversedBy: string | null }>();
    if (!p || p.reversalOf || p.reversedBy) throw new FinanceError("PAYMENT_NOT_REVERSIBLE", 409);
    if (p.method === "cash") await requireCash();
    const id = crypto.randomUUID(),
      cashEntryId = p.method === "cash" ? crypto.randomUUID() : null;
    await run([
      audit("supplier_payment_reversed", `EXISTS (SELECT 1 FROM supplier_payments WHERE id=? AND reversed_by IS NULL)${cashEntryId ? ` AND ${cashOpenSql}` : ""}`, [p.id, ...(cashEntryId ? [d0] : [])], p.invoiceId, { amount: p.amount, reason: d.reason }),
      DB.prepare("INSERT INTO supplier_payments (id,invoice_id,day,method,amount,reversal_of,reversed_by,cash_entry_id,note,actor,created_at) VALUES (?,?,?,?,?,?,NULL,?,?,?,?)").bind(id, p.invoiceId, d0, p.method, -p.amount, p.id, cashEntryId, d.reason, actor, now),
      DB.prepare("UPDATE supplier_payments SET reversed_by=? WHERE id=? AND reversed_by IS NULL").bind(id, p.id),
      ...(cashEntryId ? [DB.prepare("INSERT INTO cash_entries (id,day,kind,amount,document,note,ref_id,reversal_of,actor,created_at) VALUES (?,?,'reversal',?,'',?,?,NULL,?,?)").bind(cashEntryId, d0, p.amount, d.reason, id, actor, now)] : []),
    ]);
    return json({ ok: true });
  }
  return json({ error: "NOT_FOUND" }, 404);
}
