import { env } from "cloudflare:workers";
import { z } from "zod";
import type { Session } from "../access/domain";
import { isAdmin } from "../access/domain";
import { orderCode, today } from "../shared/domain";
import { validDay } from "../menu/domain";
import { allocateDocumentNumber } from "../documents/server";
import { DOCUMENT_TYPES, formatDocumentNumber } from "../documents/domain";
import { loadSettings as loadLabelSettings, orderLabels } from "../labels/server";
import {
  noteIssuable,
  noteLines,
  noteRequired,
  noteSection,
  renderNotesHtml,
  reversalNote,
  type DeliveryNoteContent,
  type DeliveryNoteRef,
} from "./domain";

/**
 * Aviz de însoțire a mărfii (v75). Kiállítás a Csomagolás fülről (csomagoló szerepkörök), sztornó és „Aviz kell” jelölés
 * az irodának (admin, diszpécser), beállítás csak adminnak. Minden írás egy D1-kötegben; az első utasítás a napló, amelynek
 * szereplője NULL lesz (és a köteg visszagörgetődik), ha a feltétel közben megváltozott.
 */
export class DeliveryNoteError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const uuid = z.string().uuid();
const packingRoles = ["owner", "admin", "kitchen", "warehouse", "dispatcher"];
const officeRoles = ["owner", "admin", "dispatcher"];
const activeNoteSql = "SELECT 1 FROM delivery_notes WHERE order_id=? AND kind='issue' AND status='issued'";

type OrderRow = { id: string; date: string; time: string; status: string; delivery: string; production: string; revision: number; customerName: string; address: string; phone: string; fulfillmentMode: string; deliveryNoteRequired: number; monthlyBilling: number };
const orderColumns =
  "id,date,time,status,delivery,production,revision,customer_name AS customerName,address,phone,fulfillment_mode AS fulfillmentMode,delivery_note_required AS deliveryNoteRequired,EXISTS (SELECT 1 FROM customer_billing b WHERE b.customer_id=orders.customer_id AND b.mode='monthly') AS monthlyBilling";

async function loadNoteSettings() {
  const row = await env.DB!.prepare("SELECT all_deliveries AS allDeliveries,revision FROM delivery_note_settings WHERE id=1").first<{ allDeliveries: number; revision: number }>();
  return { allDeliveries: !!row?.allDeliveries, revision: row?.revision ?? 0 };
}
async function noteNumbers() {
  const rows = (await env.DB!.prepare("SELECT year,prefix FROM document_series WHERE doc_type='delivery_note'").all<{ year: number; prefix: string }>()).results;
  return (year: number, number: number) => formatDocumentNumber(rows.find((r) => r.year === year)?.prefix ?? DOCUMENT_TYPES.delivery_note, year, number);
}
async function loadOrder(id: string) {
  const row = await env.DB!.prepare(`SELECT ${orderColumns} FROM orders WHERE id=?`).bind(id).first<OrderRow>();
  if (!row) throw new DeliveryNoteError("NOT_FOUND", 404);
  return row;
}
async function noteRefs(where: string, ...binds: unknown[]): Promise<DeliveryNoteRef[]> {
  const [rows, numberText] = await Promise.all([
    env.DB!.prepare(`SELECT id,order_id AS orderId,year,number,kind,status,issue_date AS issueDate FROM delivery_notes WHERE ${where} ORDER BY created_at`)
      .bind(...binds)
      .all<{ id: string; orderId: string; year: number; number: number; kind: DeliveryNoteRef["kind"]; status: DeliveryNoteRef["status"]; issueDate: string }>(),
    noteNumbers(),
  ]);
  return rows.results.map((r) => ({ id: r.id, number: numberText(r.year, r.number), kind: r.kind, status: r.status, orderId: r.orderId, issueDate: r.issueDate }));
}

/** Van-e a rendelésnek érvényes (kiállított, nem sztornózott) avizja. */
export async function hasActiveNote(orderId: string) {
  return !!(await env.DB!.prepare(activeNoteSql).bind(orderId).first());
}

/**
 * Avizos rendelés lemondása (v75): végleges törlés helyett „lemondott” állapot, és az aviz sztornója ugyanabban a kötegben.
 * Ugyanazok a feltételek, mint a törlésnél: visszaigazolt, a főzés és a kiszállítás még nem kezdődött el, változat egyezik.
 */
export async function cancelOrderWithNote(orderId: string, revision: number, actor: string, reason: string): Promise<boolean> {
  const DB = env.DB!;
  const original = await DB.prepare("SELECT id,year,number,content FROM delivery_notes WHERE order_id=? AND kind='issue' AND status='issued'").bind(orderId).first<{ id: string; year: number; number: number; content: string }>();
  if (!original) return false;
  const now = new Date().toISOString();
  const issueDate = today();
  const reversalId = crypto.randomUUID();
  const doc = allocateDocumentNumber("delivery_note", issueDate, now);
  const numberText = (await noteNumbers())(original.year, original.number);
  const day = (await loadOrder(orderId)).date;
  await DB.batch([
    DB.prepare(
      "INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=? AND status IN ('requested','confirmed') AND production='queued' AND delivery='pending') THEN ? ELSE NULL END,'order_cancelled_with_note',?,?,?)",
    ).bind(crypto.randomUUID(), orderId, revision, actor, orderId, JSON.stringify({ aviz: numberText, reason }), now),
    ...doc.statements,
    DB.prepare(`INSERT INTO delivery_notes (id,order_id,year,number,kind,status,reversal_of,reversed_by,issue_date,day,content,invoice_id,created_by,created_at) VALUES (?,?,?,${doc.numberSql},'reversal','issued',?,NULL,?,?,?,NULL,?,?)`).bind(
      reversalId,
      orderId,
      doc.year,
      ...doc.numberBinds,
      original.id,
      issueDate,
      day,
      JSON.stringify(reversalNote(JSON.parse(original.content) as DeliveryNoteContent, reason)),
      actor,
      now,
    ),
    DB.prepare("UPDATE delivery_notes SET status='reversed',reversed_by=? WHERE id=? AND status='issued'").bind(reversalId, original.id),
    DB.prepare("UPDATE orders SET status='cancelled',revision=revision+1 WHERE id=? AND revision=?").bind(orderId, revision),
  ]).catch((e: Error) => {
    if (/NOT NULL|UNIQUE/i.test(e.message)) throw new DeliveryNoteError("CONFLICT", 409);
    throw e;
  });
  return true;
}

export async function handleDeliveryNotes(path: string, body: unknown, session: Session, write: boolean, req: Request): Promise<Response> {
  if (!packingRoles.includes(session.role)) throw new DeliveryNoteError("FORBIDDEN", 403);
  const DB = env.DB!;
  const params = new URL(req.url).searchParams;
  if (!write && path === "/api/delivery-notes") {
    const date = params.get("date") ?? today();
    if (!validDay(date)) throw new DeliveryNoteError("VALIDATION");
    const [orders, settings, notes] = await Promise.all([
      DB.prepare(`SELECT ${orderColumns} FROM orders WHERE date=? AND status='confirmed' ORDER BY time,id`).bind(date).all<OrderRow>(),
      loadNoteSettings(),
      noteRefs("day=?", date),
    ]);
    return json({
      date,
      allDeliveries: settings.allDeliveries,
      settingsRevision: settings.revision,
      canManage: officeRoles.includes(session.role),
      canConfigure: isAdmin(session.role),
      orders: orders.results.map((o) => ({
        id: o.id,
        code: orderCode(o.id),
        time: o.time,
        customerName: o.customerName,
        mode: o.fulfillmentMode,
        delivery: o.delivery,
        revision: o.revision,
        flagged: !!o.deliveryNoteRequired,
        required: noteRequired(o, settings.allDeliveries),
        issuable: noteIssuable(o),
        notes: notes.filter((n) => n.orderId === o.id),
      })),
    });
  }
  if (!write && path === "/api/delivery-notes/print") {
    const id = params.get("id"),
      date = params.get("date");
    const where = id ? "id=?" : "day=? AND kind='issue' AND status='issued'";
    const bind = id ? uuid.parse(id) : z.string().refine(validDay).parse(date);
    const rows = (await DB.prepare(`SELECT id,year,number,reversal_of AS reversalOf,issue_date AS issueDate,content FROM delivery_notes WHERE ${where} ORDER BY created_at`).bind(bind).all<{ id: string; year: number; number: number; reversalOf: string | null; issueDate: string; content: string }>()).results;
    if (!rows.length) throw new DeliveryNoteError("NOT_FOUND", 404);
    const numberText = await noteNumbers();
    const sections = await Promise.all(
      rows.map(async (r) => {
        const original = r.reversalOf ? await DB.prepare("SELECT year,number FROM delivery_notes WHERE id=?").bind(r.reversalOf).first<{ year: number; number: number }>() : null;
        return noteSection(JSON.parse(r.content) as DeliveryNoteContent, numberText(r.year, r.number), r.issueDate, original ? numberText(original.year, original.number) : undefined);
      }),
    );
    return new Response(renderNotesHtml(id ? numberText(rows[0]!.year, rows[0]!.number) : "Avize " + date, sections), {
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Cache-Control": "private, no-store" },
    });
  }
  if (!write) return json({ error: "NOT_FOUND" }, 404);
  const now = new Date().toISOString();
  const actor = session.userId;
  const failOnGuard = (e: unknown): never => {
    if (/NOT NULL|UNIQUE/i.test(String(e))) throw new DeliveryNoteError("CONFLICT", 409);
    throw e;
  };

  if (path === "/api/delivery-notes/issue") {
    // Ismételt kérés (dupla kattintás, újrapróbálás) ugyanazt az avizt adja vissza.
    const d = z.object({ orderId: z.string().min(1).max(200) }).strict().parse(body);
    const existing = await DB.prepare("SELECT id FROM delivery_notes WHERE order_id=? AND kind='issue' AND status='issued'").bind(d.orderId).first<{ id: string }>();
    if (existing) return json({ ok: true, id: existing.id });
    const order = await loadOrder(d.orderId);
    if (!noteIssuable(order)) throw new DeliveryNoteError("NOTE_ORDER_STATE");
    if (!noteRequired(order, (await loadNoteSettings()).allDeliveries)) throw new DeliveryNoteError("NOTE_NOT_REQUIRED");
    const [labels, { settings: producer }] = await Promise.all([orderLabels(order.id, req), loadLabelSettings()]);
    const content: DeliveryNoteContent = {
      supplier: { name: producer.producerName, address: producer.producerAddress, extra: producer.producerExtra },
      buyer: { name: order.customerName, address: order.address, phone: order.phone },
      order: { id: order.id, code: orderCode(order.id), date: order.date, time: order.time, mode: order.fulfillmentMode === "pickup" ? "pickup" : "delivery" },
      lines: noteLines(labels),
    };
    if (!content.lines.length) throw new DeliveryNoteError("NOTE_ORDER_STATE");
    const id = crypto.randomUUID();
    const issueDate = today();
    const doc = allocateDocumentNumber("delivery_note", issueDate, now);
    try {
      await DB.batch([
        DB.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM orders WHERE id=? AND status='confirmed' AND delivery<>'delivered') AND NOT EXISTS (${activeNoteSql}) THEN ? ELSE NULL END,'delivery_note_issued',?,?,?)`).bind(
          crypto.randomUUID(),
          order.id,
          order.id,
          actor,
          order.id,
          JSON.stringify({ lines: content.lines.length }),
          now,
        ),
        ...doc.statements,
        DB.prepare(`INSERT INTO delivery_notes (id,order_id,year,number,kind,status,reversal_of,reversed_by,issue_date,day,content,invoice_id,created_by,created_at) VALUES (?,?,?,${doc.numberSql},'issue','issued',NULL,NULL,?,?,?,NULL,?,?)`).bind(
          id,
          order.id,
          doc.year,
          ...doc.numberBinds,
          issueDate,
          order.date,
          JSON.stringify(content),
          actor,
          now,
        ),
      ]);
    } catch (e) {
      // Párhuzamos kiállítás: a másik kérés nyert – az ő avizját adjuk vissza.
      const winner = await DB.prepare("SELECT id FROM delivery_notes WHERE order_id=? AND kind='issue' AND status='issued'").bind(order.id).first<{ id: string }>();
      if (winner) return json({ ok: true, id: winner.id });
      failOnGuard(e);
    }
    return json({ ok: true, id }, 201);
  }

  if (path === "/api/delivery-notes/reverse") {
    if (!officeRoles.includes(session.role)) throw new DeliveryNoteError("FORBIDDEN", 403);
    const d = z.object({ id: uuid, reason: z.string().trim().min(3).max(500) }).strict().parse(body);
    const original = await DB.prepare("SELECT id,order_id AS orderId,day,year,number,content FROM delivery_notes WHERE id=? AND kind='issue' AND status='issued'").bind(d.id).first<{ id: string; orderId: string; day: string; year: number; number: number; content: string }>();
    if (!original) throw new DeliveryNoteError("NOTE_NOT_ACTIVE", 409);
    const reversalId = crypto.randomUUID();
    const issueDate = today();
    const doc = allocateDocumentNumber("delivery_note", issueDate, now);
    await DB.batch([
      DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM delivery_notes WHERE id=? AND status='issued') THEN ? ELSE NULL END,'delivery_note_reversed',?,?,?)").bind(
        crypto.randomUUID(),
        original.id,
        actor,
        original.orderId,
        JSON.stringify({ aviz: (await noteNumbers())(original.year, original.number), reason: d.reason }),
        now,
      ),
      ...doc.statements,
      DB.prepare(`INSERT INTO delivery_notes (id,order_id,year,number,kind,status,reversal_of,reversed_by,issue_date,day,content,invoice_id,created_by,created_at) VALUES (?,?,?,${doc.numberSql},'reversal','issued',?,NULL,?,?,?,NULL,?,?)`).bind(
        reversalId,
        original.orderId,
        doc.year,
        ...doc.numberBinds,
        original.id,
        issueDate,
        original.day,
        JSON.stringify(reversalNote(JSON.parse(original.content) as DeliveryNoteContent, d.reason)),
        actor,
        now,
      ),
      DB.prepare("UPDATE delivery_notes SET status='reversed',reversed_by=? WHERE id=? AND status='issued'").bind(reversalId, original.id),
    ]).catch(failOnGuard);
    return json({ ok: true, id: reversalId });
  }

  if (path === "/api/delivery-notes/require") {
    if (!officeRoles.includes(session.role)) throw new DeliveryNoteError("FORBIDDEN", 403);
    const d = z.object({ orderId: z.string().min(1).max(200), revision: z.number().int().min(0), required: z.boolean() }).strict().parse(body);
    await DB.batch([
      DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM orders WHERE id=? AND revision=?) THEN ? ELSE NULL END,'delivery_note_required',?,?,?)").bind(
        crypto.randomUUID(),
        d.orderId,
        d.revision,
        actor,
        d.orderId,
        JSON.stringify({ required: d.required }),
        now,
      ),
      DB.prepare("UPDATE orders SET delivery_note_required=?,revision=revision+1 WHERE id=? AND revision=?").bind(d.required ? 1 : 0, d.orderId, d.revision),
    ]).catch(failOnGuard);
    return json({ ok: true });
  }

  if (path === "/api/delivery-notes/settings") {
    if (!isAdmin(session.role)) throw new DeliveryNoteError("FORBIDDEN", 403);
    const d = z.object({ revision: z.number().int().min(0), allDeliveries: z.boolean() }).strict().parse(body);
    await DB.batch([
      DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN COALESCE((SELECT revision FROM delivery_note_settings WHERE id=1),0)=? THEN ? ELSE NULL END,'delivery_note_settings_saved','delivery_note_settings',?,?)").bind(
        crypto.randomUUID(),
        d.revision,
        actor,
        JSON.stringify({ allDeliveries: d.allDeliveries }),
        now,
      ),
      DB.prepare("INSERT INTO delivery_note_settings (id,all_deliveries,revision) VALUES (1,?,1) ON CONFLICT(id) DO UPDATE SET all_deliveries=excluded.all_deliveries,revision=delivery_note_settings.revision+1").bind(d.allDeliveries ? 1 : 0),
    ]).catch(failOnGuard);
    return json({ ok: true });
  }
  return json({ error: "NOT_FOUND" }, 404);
}
