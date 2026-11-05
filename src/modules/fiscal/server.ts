import { env } from "cloudflare:workers";
import { z } from "zod";
import { isAdmin, type Session } from "../access/domain";
import { nextFiscalReceiptState, today } from "../shared/domain";
import { orderCollectionDeferred } from "../billing/server";
import { orderCollectionAllowedSql } from "../billing/order-collection";
import { validDay } from "../menu/domain";
import { receiptLines, matchesReceiptToken, type FiscalJob, type FiscalSettings, type FiscalReceipt, type FiscalLine } from "./domain";

export class FiscalError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
const id = z.string().min(1).max(200);
const revision = z.number().int().min(0);
const method = z.enum(["cash", "card"]);
const serial = z.string().regex(/^[A-Za-z0-9]{4,20}$/);
const number = z.string().regex(/^\d{1,4}$/).refine((value) => Number(value) > 0);
const columns = "id,order_id AS orderId,mode,state,revision,day,method,total,device_serial AS deviceSerial,receipt_number AS receiptNumber,expires_at AS expiresAt,created_at AS createdAt,completed_at AS completedAt,resolution";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
type StoredReceipt = FiscalReceipt & { token: string; content: string; result: string; receiptCounter: number | null };
async function settings(): Promise<FiscalSettings> {
  return await env.DB!.prepare("SELECT mode,device_serial AS deviceSerial,revision FROM fiscal_settings WHERE id=1").first<FiscalSettings>() ?? { mode: "simulation", deviceSerial: "", revision: 0 };
}
async function orderView(orderId: string) {
  const [order, config, jobs, collectionDeferred] = await Promise.all([
    env.DB!.prepare("SELECT expected_payment_method AS expectedPaymentMethod,revision FROM orders WHERE id=?").bind(orderId).first(),
    settings(),
    env.DB!.prepare(`SELECT ${columns} FROM fiscal_receipts WHERE order_id=? ORDER BY CASE WHEN mode='live' THEN 0 ELSE 1 END,created_at DESC,id DESC LIMIT 20`).bind(orderId).all<FiscalReceipt>(),
    orderCollectionDeferred(orderId),
  ]);
  if (!order) throw new FiscalError("NOT_FOUND", 404);
  return { ...order, collectionDeferred, settings: config, receipts: jobs.results };
}
async function run(statements: D1PreparedStatement[]) {
  try { return await env.DB!.batch(statements); }
  catch (error) {
    if (/UNIQUE|NOT NULL|FISCAL_ORDER_LOCKED/i.test(String(error))) throw new FiscalError("FISCAL_CONFLICT", 409);
    throw error;
  }
}

export async function handleFiscal(path: string, body: unknown, session: Session, write: boolean, req: Request) {
  if (!["owner", "admin", "dispatcher"].includes(session.role)) throw new FiscalError("FORBIDDEN", 403);
  const DB = env.DB!, params = new URL(req.url).searchParams, now = new Date().toISOString();
  const audit = (action: string, condition: string, binds: (string | number)[], entity: string, detail: unknown) =>
    DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN " + condition + " THEN ? ELSE NULL END,?,?,?,?)")
      .bind(crypto.randomUUID(), ...binds, session.userId, action, entity, JSON.stringify(detail), now);
  if (!write && path === "/api/fiscal/order") return json(await orderView(id.parse(params.get("id"))));
  if (!write && path === "/api/fiscal/day") {
    const day = z.string().refine(validDay).parse(params.get("date") ?? today());
    const [config, totals, open, zReport, simulations] = await Promise.all([
      settings(),
      DB.prepare("SELECT method,COUNT(*) AS count,SUM(total) AS amount FROM fiscal_receipts WHERE day=? AND mode='live' AND state='issued' GROUP BY method").bind(day).all<{ method: "cash" | "card"; count: number; amount: number }>(),
      DB.prepare(`SELECT ${columns} FROM fiscal_receipts WHERE mode='live' AND state IN ('prepared','uncertain') ORDER BY created_at LIMIT 20`).all<FiscalReceipt>(),
      DB.prepare("SELECT cash,card,total FROM z_reports WHERE day=?").bind(day).first(),
      DB.prepare("SELECT COUNT(*) AS count FROM fiscal_receipts WHERE day=? AND mode='simulation'").bind(day).first<{ count: number }>(),
    ]);
    const cash = totals.results.find((row) => row.method === "cash")?.amount ?? 0;
    const card = totals.results.find((row) => row.method === "card")?.amount ?? 0;
    return json({ settings: config, isAdmin: isAdmin(session.role), totals: { cash, card, total: cash + card, count: totals.results.reduce((sum, row) => sum + row.count, 0) }, z: zReport, unresolved: open.results, simulations: simulations?.count ?? 0 });
  }
  if (!write && path === "/api/fiscal/job") {
    const job = await DB.prepare("SELECT id,order_id AS orderId,day,expires_at AS expiresAt,token,device_serial AS deviceSerial,method,total AS totalBani,content FROM fiscal_receipts WHERE id=? AND mode='live' AND state='prepared'").bind(z.string().uuid().parse(params.get("id"))).first<Omit<FiscalJob, "version" | "jobId" | "lines"> & { id: string; content: string }>();
    if (!job || job.day !== today() || job.expiresAt <= now) throw new FiscalError("FISCAL_JOB_EXPIRED", 409);
    if (await orderCollectionDeferred(job.orderId)) throw new FiscalError("PAYMENT_MONTHLY_INVOICE", 409);
    const { id: jobId, content, ...data } = job;
    return Response.json({ ...data, version: 2, jobId, lines: JSON.parse(content) }, { headers: { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="${jobId}.gastrobon"` } });
  }
  if (!write && path === "/api/fiscal/resolution") {
    if (!isAdmin(session.role)) throw new FiscalError("FORBIDDEN", 403);
    const job = await DB.prepare("SELECT id AS jobId,order_id AS orderId,token,device_serial AS deviceSerial,state,receipt_number AS receiptNumber,receipt_counter AS receiptCounter,resolution,expires_at AS expiresAt,completed_at AS completedAt FROM fiscal_receipts WHERE id=? AND mode='live' AND state IN ('issued','not_issued') AND length(resolution)>=10").bind(z.string().uuid().parse(params.get("id"))).first();
    if (!job) throw new FiscalError("FISCAL_STATE", 409);
    return Response.json({ version: 2, ...job }, { headers: { "Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="kassza-egyeztetes.gastroresolution"' } });
  }
  if (!write) return json({ error: "NOT_FOUND" }, 404);
  if (path === "/api/fiscal/settings") {
    if (!isAdmin(session.role)) throw new FiscalError("FORBIDDEN", 403);
    const data = z.object({ revision, mode: z.enum(["simulation", "live"]), deviceSerial: z.union([serial, z.literal("")]) }).strict().parse(body);
    if (data.mode === "live" && !data.deviceSerial) throw new FiscalError("FISCAL_DEVICE_REQUIRED");
    await run([
      audit("fiscal_settings_saved", "COALESCE((SELECT revision FROM fiscal_settings WHERE id=1),0)=? AND NOT EXISTS (SELECT 1 FROM fiscal_receipts WHERE mode='live' AND state IN ('prepared','uncertain'))", [data.revision], "kitchen_register", data),
      DB.prepare("INSERT INTO fiscal_settings(id,mode,device_serial,revision) VALUES(1,?,?,1) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode,device_serial=excluded.device_serial,revision=fiscal_settings.revision+1").bind(data.mode, data.deviceSerial),
    ]);
    return json(await settings());
  }
  if (path === "/api/fiscal/method") {
    const data = z.object({ orderId: id, revision, method: z.union([method, z.literal("")]) }).strict().parse(body);
    if (data.method && await orderCollectionDeferred(data.orderId)) throw new FiscalError("PAYMENT_MONTHLY_INVOICE", 409);
    await run([
      audit("expected_payment_saved", "(?='' OR " + orderCollectionAllowedSql + ") AND EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=? AND status IN ('requested','confirmed')) AND NOT EXISTS (SELECT 1 FROM fiscal_receipts WHERE order_id=? AND mode='live' AND state<>'not_issued')", [data.method, data.orderId, data.orderId, data.revision, data.orderId], data.orderId, { method: data.method }),
      DB.prepare("UPDATE orders SET expected_payment_method=?,revision=revision+1 WHERE id=? AND revision=?").bind(data.method, data.orderId, data.revision),
    ]);
    return json(await orderView(data.orderId));
  }
  if (path === "/api/fiscal/prepare") {
    const data = z.object({ id: z.string().uuid(), orderId: id, revision, settingsRevision: revision }).strict().parse(body);
    if (await orderCollectionDeferred(data.orderId)) throw new FiscalError("PAYMENT_MONTHLY_INVOICE", 409);
    const previous = await DB.prepare("SELECT order_id AS orderId FROM fiscal_receipts WHERE id=?").bind(data.id).first<{ orderId: string }>();
    if (previous) {
      if (previous.orderId !== data.orderId) throw new FiscalError("FISCAL_CONFLICT", 409);
      return json({ id: data.id });
    }
    const [config, order, lines, paid] = await Promise.all([
      settings(),
      DB.prepare("SELECT status,revision,date,delivery_fee AS deliveryFee,expected_payment_method AS method FROM orders WHERE id=?").bind(data.orderId).first<{ status: string; revision: number; date: string; deliveryFee: number; method: string }>(),
      DB.prepare("SELECT product_id AS productId,ro AS name,price AS unitBani,quantity FROM order_items WHERE order_id=? ORDER BY rowid").bind(data.orderId).all<FiscalLine>(),
      DB.prepare("SELECT method,SUM(amount) AS amount FROM payments WHERE order_id=? GROUP BY method").bind(data.orderId).all<{ method: string; amount: number }>(),
    ]);
    if (!order) throw new FiscalError("NOT_FOUND", 404);
    if (order.status !== "confirmed" || order.date !== today()) throw new FiscalError("FISCAL_ORDER_DAY", 409);
    if (!method.safeParse(order.method).success) throw new FiscalError("FISCAL_METHOD_REQUIRED");
    if (paid.results.some((payment) => payment.amount !== 0 && payment.method !== order.method)) throw new FiscalError("FISCAL_PAYMENT_METHOD", 409);
    if (config.mode === "live" && !config.deviceSerial) throw new FiscalError("FISCAL_DEVICE_REQUIRED");
    let receipt;
    try { receipt = receiptLines(lines.results, order.deliveryFee); }
    catch { throw new FiscalError("FISCAL_LINES"); }
    const content = JSON.stringify(receipt.lines);
    if (new TextEncoder().encode(content).byteLength > 31_000 || !/^[a-zA-Z0-9_:@.-]{1,200}$/.test(data.orderId)) throw new FiscalError("FISCAL_LINES");
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    await run([
      audit("fiscal_prepared", orderCollectionAllowedSql + " AND EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=? AND status='confirmed' AND expected_payment_method=? AND date=?) AND COALESCE((SELECT revision FROM fiscal_settings WHERE id=1),0)=? AND NOT EXISTS (SELECT 1 FROM payments WHERE order_id=? GROUP BY method HAVING SUM(amount)<>0 AND method<>?)", [data.orderId, data.orderId, data.revision, order.method, today(), data.settingsRevision, data.orderId, order.method], data.orderId, { id: data.id, mode: config.mode, method: order.method, total: receipt.total }),
      DB.prepare("INSERT INTO fiscal_receipts(id,order_id,mode,state,day,method,total,content,token,device_serial,expires_at,created_by,created_at) VALUES(?,?,?,'prepared',?,?,?,?,?,?,?,?,?)")
        .bind(data.id, data.orderId, config.mode, today(), order.method, receipt.total, content, token, config.mode === "simulation" ? "SIMULATION" : config.deviceSerial, expiresAt, session.userId, now),
    ]);
    return json({ id: data.id }, 201);
  }
  if (["/api/fiscal/result", "/api/fiscal/simulate", "/api/fiscal/resolve"].includes(path)) {
    const data = z.object({ id: z.string().uuid(), revision, outcome: z.enum(["issued", "uncertain", "not_issued"]), reason: z.string().trim().max(1000).default(""), receiptNumber: z.string().max(4).default(""), receiptCounter: z.number().int().min(1).max(9_999_999).optional(), report: z.unknown().optional() }).strict().parse(body);
    const job = await DB.prepare(`SELECT ${columns},token,content,result,receipt_counter AS receiptCounter FROM fiscal_receipts WHERE id=?`).bind(data.id).first<StoredReceipt>();
    if (!job) throw new FiscalError("NOT_FOUND", 404);
    let receiptNumber = data.receiptNumber, receiptCounter = data.receiptCounter ?? null, result = "";
    if (path === "/api/fiscal/result") {
      if (job.mode !== "live") throw new FiscalError("FISCAL_STATE", 409);
      const report = z.object({ version: z.literal(2), jobId: z.string().uuid(), orderId: id, token: z.string().regex(/^[a-f0-9]{64}$/), day: z.string().refine(validDay), status: z.enum(["issued", "uncertain"]), method, totalBani: z.number().int(), deviceSerial: serial, receiptNumber: z.string().max(4), receiptCounter: z.number().int().min(1).max(9_999_999).nullable(), closedAt: z.string().max(40) }).strict().parse(data.report);
      if (report.jobId !== job.id || report.orderId !== job.orderId || report.day !== job.day || report.status !== data.outcome || report.method !== job.method || report.totalBani !== job.total || report.deviceSerial !== job.deviceSerial || !(await matchesReceiptToken(job.token, report.token))) throw new FiscalError("FISCAL_RESULT_MISMATCH", 409);
      if (report.status === "issued" && (!number.safeParse(report.receiptNumber).success || report.receiptCounter === null || !z.string().datetime({ offset: true }).safeParse(report.closedAt).success || Date.parse(report.closedAt) < Date.parse(job.createdAt) - 60_000 || Date.parse(report.closedAt) > Date.now() + 60_000)) throw new FiscalError("FISCAL_RESULT_MISMATCH");
      receiptNumber = report.receiptNumber; receiptCounter = report.receiptCounter;
      // The token stays in runtime storage, never in audit or report output.
      result = JSON.stringify({ ...report, token: undefined });
      if (job.state === report.status && job.result === result) return json({ ok: true });
    } else if (path === "/api/fiscal/simulate") {
      if (job.mode !== "simulation" || data.outcome === "not_issued") throw new FiscalError("FISCAL_STATE", 409);
      receiptNumber = data.outcome === "issued" ? "TEST" : "";
    } else {
      if (!isAdmin(session.role)) throw new FiscalError("FORBIDDEN", 403);
      if (data.reason.length < 10) throw new FiscalError("FISCAL_REASON_REQUIRED");
      if (data.outcome === "not_issued" && job.mode === "live" && Date.parse(job.expiresAt) + 60_000 > Date.now()) throw new FiscalError("FISCAL_WAIT_EXPIRY", 409);
      if (data.outcome === "issued" && job.mode === "live" && (!number.safeParse(receiptNumber).success || receiptCounter === null)) throw new FiscalError("FISCAL_RESULT_MISMATCH");
    }
    if (job.revision !== data.revision) throw new FiscalError("FISCAL_CONFLICT", 409);
    try { nextFiscalReceiptState(job.state, data.outcome); }
    catch { throw new FiscalError("FISCAL_STATE", 409); }
    await run([
      audit("fiscal_" + data.outcome, "EXISTS (SELECT 1 FROM fiscal_receipts WHERE id=? AND revision=? AND state IN ('prepared','uncertain'))", [data.id, data.revision], job.orderId, { id: data.id, mode: job.mode, source: path.split("/").at(-1), outcome: data.outcome, reason: data.reason, receiptNumber }),
      DB.prepare("UPDATE fiscal_receipts SET state=?,revision=revision+1,receipt_number=?,receipt_counter=?,completed_at=?,result=?,resolution=? WHERE id=? AND revision=?")
        .bind(data.outcome, receiptNumber, receiptCounter, data.outcome === "uncertain" ? "" : now, result, data.reason, data.id, data.revision),
    ]);
    return json({ ok: true });
  }
  return json({ error: "NOT_FOUND" }, 404);
}
