import { env } from "cloudflare:workers";
import { z } from "zod";
import type { Session } from "../access/domain";
import { orderCode, today } from "../shared/domain";
import { documentNumberText } from "../documents/server";
import { renderNirHtml } from "../invoices/nir-print";
import type { NirContent } from "../invoices/domain";
import { renderBcHtml, renderHandoverHtml, renderWriteOffHtml } from "../production/bc-print";
import type { BcContent } from "../production/domain";
import type { HandoverContent, WriteOffContent } from "../production/finished";
import { noteSection, renderNotesHtml, type DeliveryNoteContent } from "../delivery-notes/domain";
import { cashDay, renderCashRegisterHtml, type CashEntry } from "../finance/domain";
import { loadSettings as loadLabelSettings } from "../labels/server";
import { loadCompanyProfile } from "../documents/server";
import { companyLine } from "../delivery-notes/domain";
import { ARCHIVE_TYPES, OWN_PARTNER, archiveKey, partnerKey, sha256Hex, type ArchiveType } from "./domain";

/**
 * Bizonylat-archívum (v82). A feltöltött beszállítói számlák és a kiállított bizonylatok változatlan példánya a privát R2-tárolóba
 * (`ARCHIVE`) kerül, a metaadat az `archive_documents` táblába. Egyszer írható: meglévő kulcsot soha nem ír felül, törlés nincs.
 * Az archiválás a bizonylat mentése után, külön fut (időzítve félóránként és kézzel); hibája a bizonylatot nem érinti.
 */
export class ArchiveError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const officeRoles = ["owner", "admin", "dispatcher"];
const HTML = "text/html; charset=utf-8";
const enc = new TextEncoder();
const archived = (table: string, idColumn: string, type: string) =>
  `NOT EXISTS (SELECT 1 FROM archive_documents a WHERE a.source_table='${table}' AND a.source_id=${idColumn} AND a.doc_type='${type}')`;

function bucket(): R2Bucket {
  const b = (env as unknown as { ARCHIVE?: R2Bucket }).ARCHIVE;
  if (!b) throw new ArchiveError("ARCHIVE_NOT_CONFIGURED", 503);
  return b;
}

type Candidate = {
  type: ArchiveType;
  sourceTable: string;
  sourceId: string;
  version: number;
  number: string;
  partner: string;
  partnerName: string;
  issueDate: string;
  mime: string;
  bytes: () => Promise<Uint8Array<ArrayBuffer>>;
  /** Sikeres archiválás után (pl. a D1-ben tárolt fájl kiürítése). */
  after?: (sha: string) => Promise<void>;
};

/** Egy tétel mentése: R2 (ellenőrzőkóddal, felülírás nélkül), majd a metaadat. Ismételt hívás nem hoz létre második példányt. */
async function store(c: Candidate, actor: string): Promise<"stored" | "exists"> {
  const DB = env.DB!;
  const existing = await DB.prepare("SELECT sha256 FROM archive_documents WHERE source_table=? AND source_id=? AND doc_type=? AND version=?").bind(c.sourceTable, c.sourceId, c.type, c.version).first<{ sha256: string }>();
  if (existing) {
    await c.after?.(existing.sha256);
    return "exists";
  }
  const id = crypto.randomUUID();
  const bytes = await c.bytes();
  const sha = await sha256Hex(bytes);
  const key = archiveKey({ type: c.type, number: c.number, issueDate: c.issueDate, partner: c.partner, id, mime: c.mime, version: c.version });
  const r2 = bucket();
  if (!(await r2.head(key))) {
    // Az R2 a feltöltéskor ellenőrzi az SHA-256-ot: sérült átvitel esetén hibát ad, nem ment el rossz fájlt.
    await r2.put(key, bytes, { httpMetadata: { contentType: c.mime }, sha256: sha, customMetadata: { sourceTable: c.sourceTable, sourceId: c.sourceId, type: c.type } });
  }
  const stored = await r2.head(key);
  if (!stored || stored.size !== bytes.byteLength) throw new ArchiveError("ARCHIVE_VERIFY", 502);
  await DB.prepare(
    "INSERT INTO archive_documents (id,doc_type,source_table,source_id,version,number,partner_key,partner_name,issue_date,r2_key,mime,size_bytes,sha256,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
  )
    .bind(id, c.type, c.sourceTable, c.sourceId, c.version, c.number, c.partner, c.partnerName.slice(0, 200), c.issueDate, key, c.mime, bytes.byteLength, sha, actor, new Date().toISOString())
    .run();
  await c.after?.(sha);
  return "stored";
}

function fromBase64(value: string) {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const html = (s: string) => async () => enc.encode(s);

/** A még nem archivált bizonylatok (legfeljebb `limit` darab), forrásonként. */
async function candidates(limit: number): Promise<Candidate[]> {
  const DB = env.DB!;
  const out: Candidate[] = [];
  const room = () => limit - out.length;

  // 1) Bevételezett beszállítói számlák eredeti fájlja (a D1-ből; archiválás után ott kiürül).
  if (room() > 0) {
    const rows = (
      await DB.prepare(
        `SELECT f.invoice_id AS id,f.mime,i.kind,i.supplier_tax_id AS taxId,i.supplier_name AS name,i.series,i.number,i.issue_date AS issueDate,i.received_date AS receivedDate FROM supplier_invoice_files f JOIN supplier_invoices i ON i.id=f.invoice_id WHERE i.status='received' AND f.data<>'' AND ${archived("supplier_invoices", "f.invoice_id", "SUPPLIER_INVOICE")} AND ${archived("supplier_invoices", "f.invoice_id", "SUPPLIER_RECEIPT")} ORDER BY i.received_at LIMIT ?`,
      )
        .bind(room())
        .all<{ id: string; mime: string; kind: string; taxId: string; name: string; series: string; number: string; issueDate: string; receivedDate: string }>()
    ).results;
    for (const r of rows)
      out.push({
        type: r.kind === "bon_fiscal" ? "SUPPLIER_RECEIPT" : "SUPPLIER_INVOICE",
        sourceTable: "supplier_invoices",
        sourceId: r.id,
        version: 1,
        number: `${r.series} ${r.number}`.trim() || r.id.slice(0, 8),
        partner: partnerKey(r.taxId, r.name),
        partnerName: r.name,
        issueDate: /^\d{4}-\d{2}-\d{2}$/.test(r.issueDate) ? r.issueDate : r.receivedDate || today(),
        mime: r.mime,
        bytes: async () => {
          const f = await DB.prepare("SELECT data FROM supplier_invoice_files WHERE invoice_id=?").bind(r.id).first<{ data: string }>();
          if (!f?.data) throw new ArchiveError("ARCHIVE_SOURCE_EMPTY", 409);
          return fromBase64(f.data);
        },
        // Az eredeti csak ellenőrzött R2-példány után ürül ki a D1-ből; a Számlák lap ezután az R2-ből mutatja.
        after: async (sha) => {
          const f = await DB.prepare("SELECT data FROM supplier_invoice_files WHERE invoice_id=?").bind(r.id).first<{ data: string }>();
          if (f?.data && (await sha256Hex(fromBase64(f.data))) === sha) await DB.prepare("UPDATE supplier_invoice_files SET data='' WHERE invoice_id=? AND data=?").bind(r.id, f.data).run();
        },
      });
  }

  // 2) NIR (bevételezés és sztornó).
  if (room() > 0) {
    const rows = (
      await DB.prepare(`SELECT id,year,number,reversal_of AS reversalOf,issue_date AS issueDate,content FROM nir_documents n WHERE ${archived("nir_documents", "n.id", "NIR")} ORDER BY created_at LIMIT ?`)
        .bind(room())
        .all<{ id: string; year: number; number: number; reversalOf: string | null; issueDate: string; content: string }>()
    ).results;
    for (const r of rows) {
      const c = JSON.parse(r.content) as NirContent;
      const text = await documentNumberText("nir", r.year, r.number);
      const original = r.reversalOf ? await DB.prepare("SELECT year,number FROM nir_documents WHERE id=?").bind(r.reversalOf).first<{ year: number; number: number }>() : null;
      const company = companyLine(await loadCompanyProfile());
      const page = renderNirHtml(c, text, { ...(original ? { reversalOf: await documentNumberText("nir", original.year, original.number) } : {}), ...(company ? { company } : {}) });
      out.push({ type: "NIR", sourceTable: "nir_documents", sourceId: r.id, version: 1, number: text, partner: partnerKey(c.supplier.taxId, c.supplier.name), partnerName: c.supplier.name, issueDate: r.issueDate, mime: HTML, bytes: html(page) });
    }
  }

  // 3) Bon de consum.
  if (room() > 0) {
    const rows = (
      await DB.prepare(`SELECT id,year,number,reversal_of AS reversalOf,issue_date AS issueDate,content FROM consumption_documents c WHERE ${archived("consumption_documents", "c.id", "BON_CONSUM")} ORDER BY created_at LIMIT ?`)
        .bind(room())
        .all<{ id: string; year: number; number: number; reversalOf: string | null; issueDate: string; content: string }>()
    ).results;
    for (const r of rows) {
      const text = await documentNumberText("consumption", r.year, r.number);
      const original = r.reversalOf ? await DB.prepare("SELECT year,number FROM consumption_documents WHERE id=?").bind(r.reversalOf).first<{ year: number; number: number }>() : null;
      const page = renderBcHtml(JSON.parse(r.content) as BcContent, text, { issueDate: r.issueDate, ...(original ? { reversalOf: await documentNumberText("consumption", original.year, original.number) } : {}) });
      out.push({ type: "BON_CONSUM", sourceTable: "consumption_documents", sourceId: r.id, version: 1, number: text, partner: OWN_PARTNER, partnerName: "", issueDate: r.issueDate, mime: HTML, bytes: html(page) });
    }
  }

  // 4) Aviz (a vevő neve nem kerül a kulcsba, csak a rendelés kódja).
  if (room() > 0) {
    const rows = (
      await DB.prepare(`SELECT id,order_id AS orderId,year,number,reversal_of AS reversalOf,issue_date AS issueDate,content FROM delivery_notes d WHERE ${archived("delivery_notes", "d.id", "AVIZ")} ORDER BY created_at LIMIT ?`)
        .bind(room())
        .all<{ id: string; orderId: string; year: number; number: number; reversalOf: string | null; issueDate: string; content: string }>()
    ).results;
    for (const r of rows) {
      const text = await documentNumberText("delivery_note", r.year, r.number);
      const original = r.reversalOf ? await DB.prepare("SELECT year,number FROM delivery_notes WHERE id=?").bind(r.reversalOf).first<{ year: number; number: number }>() : null;
      const content = JSON.parse(r.content) as DeliveryNoteContent;
      const page = renderNotesHtml(text, [noteSection(content, text, r.issueDate, original ? await documentNumberText("delivery_note", original.year, original.number) : undefined, r.id)]);
      // v84: céges vevőnél a vevő CUI-ja a partner (a magánszemély adata nem kerül a kulcsba).
      const buyerCif = content.buyer.cif ?? "";
      out.push({ type: "AVIZ", sourceTable: "delivery_notes", sourceId: r.id, version: 1, number: text, partner: buyerCif ? partnerKey(buyerCif, content.buyer.name) : "CLIENT-" + orderCode(r.orderId), partnerName: buyerCif ? content.buyer.name : "", issueDate: r.issueDate, mime: HTML, bytes: html(page) });
    }
  }

  // 5) Selejt-PV és bon de predare.
  if (room() > 0) {
    const rows = (
      await DB.prepare(
        `SELECT id,doc_type AS type,year,number,reversal_of AS reversalOf,issue_date AS issueDate,content FROM production_documents p WHERE (doc_type='write_off' AND ${archived("production_documents", "p.id", "PV_CASARE")}) OR (doc_type='handover' AND ${archived("production_documents", "p.id", "BON_PREDARE")}) ORDER BY created_at LIMIT ?`,
      )
        .bind(room())
        .all<{ id: string; type: "write_off" | "handover"; year: number; number: number; reversalOf: string | null; issueDate: string; content: string }>()
    ).results;
    for (const r of rows) {
      const text = await documentNumberText(r.type, r.year, r.number);
      const original = r.reversalOf ? await DB.prepare("SELECT year,number FROM production_documents WHERE id=?").bind(r.reversalOf).first<{ year: number; number: number }>() : null;
      const options = { issueDate: r.issueDate, ...(original ? { reversalOf: await documentNumberText(r.type, original.year, original.number) } : {}) };
      const page = r.type === "write_off" ? renderWriteOffHtml(JSON.parse(r.content) as WriteOffContent, text, options) : renderHandoverHtml(JSON.parse(r.content) as HandoverContent, text, options);
      out.push({ type: r.type === "write_off" ? "PV_CASARE" : "BON_PREDARE", sourceTable: "production_documents", sourceId: r.id, version: 1, number: text, partner: OWN_PARTNER, partnerName: "", issueDate: r.issueDate, mime: HTML, bytes: html(page) });
    }
  }

  // 6) Lezárt pénztárnap (registru de casă); visszanyitás és újrazárás után új változat.
  if (room() > 0) {
    const days = (
      await DB.prepare(
        "SELECT day,revision FROM cash_days c WHERE status='closed' AND NOT EXISTS (SELECT 1 FROM archive_documents a WHERE a.source_table='cash_days' AND a.source_id=c.day AND a.doc_type='REGISTRU_CASA' AND a.version=c.revision) ORDER BY day LIMIT ?",
      )
        .bind(room())
        .all<{ day: string; revision: number }>()
    ).results;
    if (days.length) {
      const { company } = await loadLabelSettings();
      for (const d of days) {
        const [before, entries] = await Promise.all([
          DB.prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM cash_entries WHERE day<?").bind(d.day).first<{ amount: number }>(),
          DB.prepare("SELECT id,day,kind,amount,document,note,ref_id AS refId,reversal_of AS reversalOf,created_at AS createdAt FROM cash_entries WHERE day=? ORDER BY created_at").bind(d.day).all<CashEntry>(),
        ]);
        const page = renderCashRegisterHtml(d.day, company, entries.results, cashDay([{ amount: before?.amount ?? 0 }], entries.results), true);
        out.push({ type: "REGISTRU_CASA", sourceTable: "cash_days", sourceId: d.day, version: d.revision, number: d.day, partner: OWN_PARTNER, partnerName: "", issueDate: d.day, mime: HTML, bytes: html(page) });
      }
    }
  }
  return out;
}

/** Hiányzók archiválása (időzítve és kézzel). Tételenként külön: egy hiba nem állítja meg a többit. */
export async function sweepArchive(actor: string, limit = 25) {
  const list = await candidates(limit);
  let stored = 0;
  const failed: { type: string; number: string; code: string }[] = [];
  for (const c of list) {
    try {
      if ((await store(c, actor)) === "stored") stored++;
    } catch (e) {
      failed.push({ type: c.type, number: c.number, code: e instanceof ArchiveError ? e.code : "ARCHIVE_ERROR" });
      console.error("archive", c.type, c.sourceId, String(e).slice(0, 200));
    }
  }
  return { stored, failed, more: list.length >= limit };
}

/** Az R2-be költözött beszállítói számlafájl kiszolgálása (a Számlák lap hívja, ha a D1-ben már nincs meg). */
export async function archivedSourceFile(sourceTable: string, sourceId: string) {
  const row = await env.DB!.prepare("SELECT r2_key AS key,mime FROM archive_documents WHERE source_table=? AND source_id=? ORDER BY version DESC LIMIT 1").bind(sourceTable, sourceId).first<{ key: string; mime: string }>();
  if (!row) return null;
  const obj = await bucket().get(row.key);
  return obj ? { body: obj.body, mime: row.mime } : null;
}

export async function handleArchive(path: string, body: unknown, session: Session, write: boolean, req: Request): Promise<Response> {
  if (!officeRoles.includes(session.role)) throw new ArchiveError("FORBIDDEN", 403);
  const DB = env.DB!;
  const params = new URL(req.url).searchParams;
  if (!write && path === "/api/archive") {
    const year = z.string().regex(/^\d{4}$/).optional().parse(params.get("year") || undefined);
    const month = z.string().regex(/^(0[1-9]|1[0-2])$/).optional().parse(params.get("month") || undefined);
    const type = z.enum(ARCHIVE_TYPES).optional().parse(params.get("type") || undefined);
    const q = z.string().trim().max(60).parse(params.get("q") ?? "");
    const where: string[] = [];
    const binds: unknown[] = [];
    if (year) {
      where.push("issue_date LIKE ?");
      binds.push(year + (month ? "-" + month : "") + "-%");
    }
    if (type) {
      where.push("doc_type=?");
      binds.push(type);
    }
    if (q) {
      where.push("(number LIKE ? OR partner_key LIKE ? OR partner_name LIKE ?)");
      binds.push("%" + q + "%", "%" + q.toUpperCase() + "%", "%" + q + "%");
    }
    const [rows, counts] = await Promise.all([
      DB.prepare(`SELECT id,doc_type AS type,number,partner_key AS partner,partner_name AS partnerName,issue_date AS issueDate,r2_key AS key,mime,size_bytes AS size,version,created_at AS createdAt FROM archive_documents ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY issue_date DESC,created_at DESC LIMIT 300`)
        .bind(...binds)
        .all(),
      DB.prepare(
        `SELECT (SELECT COUNT(*) FROM supplier_invoice_files f JOIN supplier_invoices i ON i.id=f.invoice_id WHERE i.status='received' AND f.data<>'' AND ${archived("supplier_invoices", "f.invoice_id", "SUPPLIER_INVOICE")} AND ${archived("supplier_invoices", "f.invoice_id", "SUPPLIER_RECEIPT")})
          +(SELECT COUNT(*) FROM nir_documents n WHERE ${archived("nir_documents", "n.id", "NIR")})
          +(SELECT COUNT(*) FROM consumption_documents c WHERE ${archived("consumption_documents", "c.id", "BON_CONSUM")})
          +(SELECT COUNT(*) FROM delivery_notes d WHERE ${archived("delivery_notes", "d.id", "AVIZ")})
          +(SELECT COUNT(*) FROM production_documents p WHERE (doc_type='write_off' AND ${archived("production_documents", "p.id", "PV_CASARE")}) OR (doc_type='handover' AND ${archived("production_documents", "p.id", "BON_PREDARE")}))
          +(SELECT COUNT(*) FROM cash_days c WHERE status='closed' AND NOT EXISTS (SELECT 1 FROM archive_documents a WHERE a.source_table='cash_days' AND a.source_id=c.day AND a.doc_type='REGISTRU_CASA' AND a.version=c.revision)) AS missing,
          (SELECT COUNT(*) FROM archive_documents) AS total`,
      ).first<{ missing: number; total: number }>(),
    ]);
    return json({ rows: rows.results, missing: counts?.missing ?? 0, total: counts?.total ?? 0, configured: !!(env as unknown as { ARCHIVE?: R2Bucket }).ARCHIVE });
  }
  if (!write && path === "/api/archive/file") {
    const id = z.string().uuid().parse(params.get("id"));
    const row = await DB.prepare("SELECT r2_key AS key,mime,doc_type AS type,number FROM archive_documents WHERE id=?").bind(id).first<{ key: string; mime: string; type: string; number: string }>();
    if (!row) throw new ArchiveError("NOT_FOUND", 404);
    const obj = await bucket().get(row.key);
    if (!obj) throw new ArchiveError("ARCHIVE_MISSING_OBJECT", 404);
    await DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,'archive_downloaded',?,?,?)")
      .bind(crypto.randomUUID(), session.userId, id, JSON.stringify({ type: row.type, number: row.number }), new Date().toISOString())
      .run();
    const download = params.get("download") === "1";
    const name = row.key.split("/").pop() ?? "document";
    return new Response(obj.body, {
      headers: {
        "Content-Type": row.mime,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (write && path === "/api/archive/sweep") {
    z.object({}).strict().parse(body ?? {});
    return json({ ok: true, ...(await sweepArchive(session.userId)) });
  }
  return json({ error: "NOT_FOUND" }, 404);
}
