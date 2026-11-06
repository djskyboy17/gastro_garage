import { env } from "cloudflare:workers";
import { z } from "zod";
import type { Session } from "../access/domain";
import { isAdmin } from "../access/domain";
import { today } from "../shared/domain";
import { validDay } from "../menu/domain";
import { addDays } from "../labels/domain";
import { committeeNames } from "../invoices/domain";
import { allocateDocumentNumber } from "../documents/server";
import { DOCUMENT_TYPES, formatDocumentNumber, type DocumentType } from "../documents/domain";
import { ProductionError, dayOrders } from "./server";
import { dayToken, dayTokenBinds, dayTokenSql, dailyMaterialStatements, reverseDailyMaterials } from "./daily-materials";
import type { BcContent } from "./domain";
import {
  lastUsableDay,
  planDayClose,
  portionValue,
  remainingAt,
  reversalWriteOff,
  type DayInput,
  type DayRow,
  type FinishedLot,
  type WriteOffContent,
} from "./finished";
import { renderHandoverHtml, renderWriteOffHtml } from "./bc-print";

/**
 * Napi zárás, készétel-készlet és selejt-PV (v74). A konyha zárja le a napot, az admin nyithatja vissza.
 * Minden írás egy D1-kötegben; az első utasítás a napló, amelynek szereplője NULL lesz (és a köteg visszagörgetődik),
 * ha közben más zárt, visszanyitott, vagy a nap gyártási tételei változtak.
 */
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const day = z.string().refine(validDay);
const count = z.number().int().min(0).max(100000);
/** Ennyi napra visszamenőleg számít a maradék és a zárási sorrend. */
const WINDOW_DAYS = 14;

export type DocRef = { id: string; number: string; type: "write_off" | "handover"; kind: "issue" | "reversal"; status: "issued" | "reversed"; batchId: string | null; day: string };
export type DayCloseView = {
  date: string;
  materialToken: string;
  consumptionId: string | null;
  status: "open" | "closed";
  revision: number;
  closedAt: string | null;
  /** A legkorábbi, még le nem zárt korábbi nap, amelyet előbb le kell zárni. */
  pendingDay: string | null;
  openBatches: { productId: string; hu: string; ro: string }[];
  products: { productId: string; hu: string; ro: string; sold: number }[];
  lots: FinishedLot[];
  /** Lezárt napnál a rögzített sorok. */
  rows: DayRow[] | null;
  documents: DocRef[];
  writeOffCommittee: string;
  handoverEnabled: boolean;
  settingsRevision: number;
  canReopen: boolean;
};

/** Lezárt gyártási tételek készétel-készlete a nap elején (a korábbi napok mozgásai levonva), az ablakon belül. */
export async function loadFinishedLots(date: string, productIds?: string[]): Promise<FinishedLot[]> {
  const DB = env.DB!;
  const filter = productIds ? " AND b.product_id IN (SELECT value FROM json_each(?))" : "";
  const binds: unknown[] = [date, addDays(date, -WINDOW_DAYS), ...(productIds ? [JSON.stringify(productIds)] : [])];
  const [batches, moves] = await Promise.all([
    DB.prepare(`SELECT b.id AS batchId,b.product_id AS productId,b.code,b.day,b.use_by AS useBy,b.actual FROM production_batches b WHERE b.status='closed' AND b.day<=? AND b.day>=?${filter}`)
      .bind(...binds)
      .all<{ batchId: string; productId: string; code: string; day: string; useBy: string | null; actual: number | null }>(),
    DB.prepare(`SELECT m.batch_id AS batchId,m.day,m.quantity FROM finished_moves m JOIN production_batches b ON b.id=m.batch_id WHERE b.status='closed' AND b.day<=? AND b.day>=?${filter}`)
      .bind(...binds)
      .all<{ batchId: string; day: string; quantity: number }>(),
  ]);
  return batches.results.map((b) => ({
    batchId: b.batchId,
    productId: b.productId,
    code: b.code,
    day: b.day,
    useBy: b.useBy,
    remaining: remainingAt(b.actual ?? 0, moves.results.filter((m) => m.batchId === b.batchId), date),
  }));
}

async function closeRow(date: string) {
  return env.DB!.prepare("SELECT status,revision,content,write_off_id AS writeOffId,closed_at AS closedAt FROM production_day_closes WHERE day=?")
    .bind(date)
    .first<{ status: "open" | "closed"; revision: number; content: string; writeOffId: string | null; closedAt: string | null }>();
}

/**
 * A legkorábbi korábbi nap (az ablakon belül), amelyet a mai előtt le kell zárni: ahol lezárt gyártási tétel volt,
 * vagy ahol rendelés volt, és még maradt kiadható készétel. [FELTÉTELEZÉS] rendelés és tétel nélküli napot (pl. vasárnap) nem kell lezárni.
 */
export async function pendingDay(date: string): Promise<string | null> {
  const DB = env.DB!;
  const from = addDays(date, -WINDOW_DAYS);
  const [closed, batchDays, orderDays, moves, lots] = await Promise.all([
    DB.prepare("SELECT day FROM production_day_closes WHERE status='closed' AND day>=? AND day<?").bind(from, date).all<{ day: string }>(),
    DB.prepare("SELECT DISTINCT day FROM production_batches WHERE status='closed' AND day>=? AND day<?").bind(from, date).all<{ day: string }>(),
    DB.prepare("SELECT DISTINCT date AS day FROM orders WHERE status='confirmed' AND date>=? AND date<?").bind(from, date).all<{ day: string }>(),
    DB.prepare("SELECT m.batch_id AS batchId,m.day,m.quantity FROM finished_moves m WHERE m.day>=?").bind(from).all<{ batchId: string; day: string; quantity: number }>(),
    DB.prepare("SELECT id,day,use_by AS useBy,actual FROM production_batches WHERE status='closed' AND day>=? AND day<?").bind(from, date).all<{ id: string; day: string; useBy: string | null; actual: number | null }>(),
  ]);
  const done = new Set(closed.results.map((r) => r.day));
  const candidates = new Set(batchDays.results.map((r) => r.day));
  for (const { day: d } of orderDays.results) {
    const stocked = lots.results.some(
      (l) => l.day <= d && lastUsableDay(l) >= d && remainingAt(l.actual ?? 0, moves.results.filter((m) => m.batchId === l.id), d) > 0,
    );
    if (stocked) candidates.add(d);
  }
  return [...candidates].filter((d) => !done.has(d)).sort()[0] ?? null;
}

async function docNumbers() {
  const rows = (await env.DB!.prepare("SELECT doc_type AS type,year,prefix FROM document_series WHERE doc_type IN ('write_off','handover')").all<{ type: DocumentType; year: number; prefix: string }>()).results;
  return (type: DocumentType, year: number, number: number) => formatDocumentNumber(rows.find((r) => r.type === type && r.year === year)?.prefix ?? DOCUMENT_TYPES[type], year, number);
}
export async function loadDocRefs(where: string, bind: unknown): Promise<DocRef[]> {
  const [rows, numberText] = await Promise.all([
    env.DB!.prepare(`SELECT id,doc_type AS type,year,number,kind,status,batch_id AS batchId,day FROM production_documents WHERE ${where} ORDER BY created_at`)
      .bind(bind)
      .all<{ id: string; type: DocRef["type"]; year: number; number: number; kind: DocRef["kind"]; status: DocRef["status"]; batchId: string | null; day: string }>(),
    docNumbers(),
  ]);
  return rows.results.map((r) => ({ id: r.id, number: numberText(r.type, r.year, r.number), type: r.type, kind: r.kind, status: r.status, batchId: r.batchId, day: r.day }));
}
export async function loadProductionSettings() {
  const row = await env.DB!.prepare("SELECT margin_bps AS marginBps,revision,write_off_committee AS writeOffCommittee,handover_enabled AS handoverEnabled FROM production_settings WHERE id=1").first<{ marginBps: number; revision: number; writeOffCommittee: string; handoverEnabled: number }>();
  return row ?? { marginBps: 1000, revision: 0, writeOffCommittee: "", handoverEnabled: 0 };
}

/** A napi zárás adatai: ételenként az eladott adag, a kiadható tételek, a lezárt nap sorai. */
async function dayView(date: string, session: Session): Promise<DayCloseView> {
  const initialToken = await dayToken(date);
  const DB = env.DB!;
  const [demand, lots, row, pending, openBatches, recipes, settings, documents, later] = await Promise.all([
    dayOrders(date),
    loadFinishedLots(date),
    closeRow(date),
    pendingDay(date),
    DB.prepare("SELECT b.product_id AS productId,p.hu,p.ro FROM production_batches b JOIN products p ON p.id=b.product_id WHERE b.day=? AND b.status='open'").bind(date).all<{ productId: string; hu: string; ro: string }>(),
    DB.prepare("SELECT DISTINCT product_id AS productId FROM recipes").all<{ productId: string }>(),
    loadProductionSettings(),
    loadDocRefs("day=?", date),
    DB.prepare("SELECT 1 FROM production_day_closes WHERE status='closed' AND day>? LIMIT 1").bind(date).first(),
  ]);
  const withRecipe = new Set(recipes.results.map((r) => r.productId));
  // Recept nélküli étel (pl. üdítő) nem gyártott termék: nincs készétel-készlete. A rendelésenként kiadott adag nem a készletből fogy.
  const products = [...demand]
    .filter(([id, d]) => withRecipe.has(id) && d.ordered - d.issued > 0)
    .map(([productId, d]) => ({ productId, hu: d.hu, ro: d.ro, sold: d.ordered - d.issued }));
  const missing = [...new Set(lots.filter((l) => l.remaining > 0).map((l) => l.productId))].filter((id) => !products.some((p) => p.productId === id));
  if (missing.length) {
    const rows = await DB.prepare("SELECT id,hu,ro FROM products WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(missing)).all<{ id: string; hu: string; ro: string }>();
    for (const p of rows.results) products.push({ productId: p.id, hu: p.hu, ro: p.ro, sold: 0 });
  }
  products.sort((a, b) => a.hu.localeCompare(b.hu, "hu"));
  const materialDoc=await DB.prepare("SELECT consumption_id AS id FROM production_materials WHERE day=? AND consumption_id IS NOT NULL LIMIT 1").bind(date).first<{id:string}>();
  const closed = row?.status === "closed";
  if(initialToken !== await dayToken(date)) throw new ProductionError("CONFLICT",409);
  return {
    date,
    materialToken: initialToken,
    consumptionId: materialDoc?.id??null,
    status: closed ? "closed" : "open",
    revision: row?.revision ?? 0,
    closedAt: closed ? (row?.closedAt ?? null) : null,
    pendingDay: pending,
    openBatches: openBatches.results,
    products,
    lots,
    rows: closed ? ((JSON.parse(row!.content) as { rows?: DayRow[] }).rows ?? []) : null,
    documents,
    writeOffCommittee: settings.writeOffCommittee,
    handoverEnabled: !!settings.handoverEnabled,
    settingsRevision: settings.revision,
    canReopen: isAdmin(session.role) && closed && !later,
  };
}

export async function handleDayClose(path: string, body: unknown, session: Session, write: boolean, req: Request): Promise<Response | null> {
  const DB = env.DB!;
  const params = new URL(req.url).searchParams;
  if (!write && path === "/api/production/day") {
    const date = params.get("date") ?? today();
    if (!validDay(date)) throw new ProductionError("VALIDATION");
    return json(await dayView(date, session));
  }
  if (!write && path === "/api/production/doc") {
    const id = z.string().uuid().parse(params.get("id"));
    const row = await DB.prepare("SELECT doc_type AS type,year,number,reversal_of AS reversalOf,issue_date AS issueDate,content FROM production_documents WHERE id=?")
      .bind(id)
      .first<{ type: "write_off" | "handover"; year: number; number: number; reversalOf: string | null; issueDate: string; content: string }>();
    if (!row) throw new ProductionError("NOT_FOUND", 404);
    const numberText = await docNumbers();
    const original = row.reversalOf ? await DB.prepare("SELECT year,number FROM production_documents WHERE id=?").bind(row.reversalOf).first<{ year: number; number: number }>() : null;
    const options = { issueDate: row.issueDate, ...(original ? { reversalOf: numberText(row.type, original.year, original.number) } : {}) };
    const text = numberText(row.type, row.year, row.number);
    const html = row.type === "write_off" ? renderWriteOffHtml(JSON.parse(row.content), text, options) : renderHandoverHtml(JSON.parse(row.content), text, options);
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Cache-Control": "private, no-store" },
    });
  }
  if (!write) return null;
  const now = new Date().toISOString();
  const actor = session.userId;
  const failOnGuard = (e: unknown): never => {
    if (/NOT NULL|UNIQUE/i.test(String(e))) throw new ProductionError("CONFLICT", 409);
    if (/CHECK/i.test(String(e))) throw new ProductionError("STOCK_CONFLICT", 409);
    throw e;
  };

  if (path === "/api/production/day/close") {
    const d = z
      .object({
        date: day,
        revision: z.number().int().min(0),
        materialToken: z.string().min(1).max(90000),
        inputs: z.array(z.object({ productId: z.string().min(1).max(200), staff: count, waste: count, donation: count, wasteNote: z.string().trim().max(500) }).strict()).max(200),
      })
      .strict()
      .parse(body);
    if (d.date > today()) throw new ProductionError("DAY_FUTURE");
    const view = await dayView(d.date, session);
    if (view.status === "closed") throw new ProductionError("DAY_CLOSED", 409);
    if (view.materialToken !== d.materialToken) throw new ProductionError("CONFLICT", 409);
    if (view.revision !== d.revision) throw new ProductionError("CONFLICT", 409);
    if (view.openBatches.length) throw new ProductionError("DAY_BATCHES_OPEN", 409);
    if (view.pendingDay) throw new ProductionError("DAY_EARLIER_OPEN", 409);
    const plan = planDayClose(d.date, view.products, view.lots, d.inputs as DayInput[]);
    if (plan.errors.length) throw new ProductionError(plan.errors[0]!.code);
    const materials = await dailyMaterialStatements(d.date, actor, now, view.handoverEnabled, session.name);
    const lots = new Map(view.lots.map((l) => [l.batchId, l]));
    const statements: D1PreparedStatement[] = [
      DB.prepare(
        "INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN COALESCE((SELECT revision FROM production_day_closes WHERE day=?),0)=? AND NOT EXISTS (SELECT 1 FROM production_day_closes WHERE day=? AND status='closed') AND NOT EXISTS (SELECT 1 FROM production_batches WHERE day=? AND status='open') AND NOT EXISTS (SELECT 1 FROM finished_moves WHERE day=?) THEN ? ELSE NULL END,'production_day_closed',?,?,?)",
      ).bind(crypto.randomUUID(), d.date, d.revision, d.date, d.date, d.date, actor, d.date, JSON.stringify(plan.rows.map((r) => ({ p: r.hu, sold: r.sold, staff: r.staff, waste: r.waste, donation: r.donation, closing: r.closing }))), now),
    ];
    statements.push(DB.prepare(`INSERT INTO audit(id,actor,action,entity,detail,created_at) VALUES(?,CASE WHEN (${dayTokenSql})=? THEN ? ELSE NULL END,'daily_materials_checked',?,'',?)`).bind(crypto.randomUUID(),...dayTokenBinds(d.date),d.materialToken,actor,d.date,now),...materials.statements);
    // Selejt: napi egy PV, tételenként egy sor, a tétel BC-értékéből.
    const wasteMoves = plan.rows.flatMap((r) => r.moves.filter((m) => m.kind === "waste").map((m) => ({ ...m, row: r })));
    let writeOffId: string | null = null;
    if (wasteMoves.length) {
      const bcs = await DB.prepare("SELECT b.id AS batchId,c.content FROM production_batches b JOIN consumption_documents c ON c.id=b.consumption_id WHERE b.id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(wasteMoves.map((m) => m.batchId)))
        .all<{ batchId: string; content: string }>();
      const lines = wasteMoves.map((m) => {
        const lot = lots.get(m.batchId)!;
        const bc = bcs.results.find((b) => b.batchId === m.batchId);
        const content = bc ? (JSON.parse(bc.content) as BcContent) : null;
        return { productId: m.row.productId, ro: m.row.ro, hu: m.row.hu, code: lot.code, batchDay: lot.day, quantity: m.quantity, reason: m.row.wasteNote, value: materials.values.has(m.batchId) ? portionValue(m.quantity, materials.values.get(m.batchId)!.totalValue, materials.values.get(m.batchId)!.consumed) : content ? portionValue(m.quantity, content.dailyBatches?.find(b=>b.batchId===m.batchId)?.totalValue ?? content.totalValue, content.dailyBatches?.find(b=>b.batchId===m.batchId)?.consumed ?? content.portions.consumed) : 0 };
      });
      const content: WriteOffContent = { day: d.date, committee: committeeNames(view.writeOffCommittee), lines, totalValue: lines.reduce((s, l) => s + l.value, 0) };
      writeOffId = crypto.randomUUID();
      const pv = allocateDocumentNumber("write_off", d.date, now);
      statements.push(
        ...pv.statements,
        DB.prepare(`INSERT INTO production_documents (id,doc_type,year,number,kind,status,reversal_of,reversed_by,issue_date,day,batch_id,content,created_by,created_at) VALUES (?,'write_off',?,${pv.numberSql},'issue','issued',NULL,NULL,?,?,NULL,?,?,?)`).bind(writeOffId, pv.year, ...pv.numberBinds, d.date, d.date, JSON.stringify(content), actor, now),
      );
    }
    for (const r of plan.rows)
      for (const m of r.moves)
        statements.push(DB.prepare("INSERT INTO finished_moves (id,batch_id,day,kind,quantity,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), m.batchId, d.date, m.kind, m.quantity, now));
    statements.push(
      DB.prepare(
        "INSERT INTO production_day_closes (day,status,revision,content,write_off_id,closed_by,closed_at) VALUES (?,'closed',1,?,?,?,?) ON CONFLICT(day) DO UPDATE SET status='closed',revision=production_day_closes.revision+1,content=excluded.content,write_off_id=excluded.write_off_id,closed_by=excluded.closed_by,closed_at=excluded.closed_at WHERE production_day_closes.status='open'",
      ).bind(d.date, JSON.stringify({ rows: plan.rows }), writeOffId, actor, now),
    );
    await DB.batch(statements).catch(failOnGuard);
    return json({ ok: true, writeOffId, consumptionId: materials.consumptionId });
  }

  if (path === "/api/production/day/reopen") {
    // Csak admin. A nap mozgásai törlődnek, a PV sztornózódik (a bizonylatok megmaradnak). Későbbi lezárt nap esetén nem lehet.
    if (!isAdmin(session.role)) throw new ProductionError("FORBIDDEN", 403);
    const d = z.object({ date: day, revision: z.number().int().min(0), reason: z.string().trim().min(3).max(500) }).strict().parse(body);
    const row = await closeRow(d.date);
    if (row?.status !== "closed") throw new ProductionError("DAY_OPEN", 409);
    if (row.revision !== d.revision) throw new ProductionError("CONFLICT", 409);
    if (await DB.prepare("SELECT 1 FROM production_day_closes WHERE status='closed' AND day>? LIMIT 1").bind(d.date).first()) throw new ProductionError("DAY_LATER_CLOSED", 409);
    const statements: D1PreparedStatement[] = [
      DB.prepare(
        "INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM production_day_closes WHERE day=? AND status='closed' AND revision=?) AND NOT EXISTS (SELECT 1 FROM production_day_closes WHERE status='closed' AND day>?) THEN ? ELSE NULL END,'production_day_reopened',?,?,?)",
      ).bind(crypto.randomUUID(), d.date, d.revision, d.date, actor, d.date, JSON.stringify({ reason: d.reason }), now),
    ];
    if (row.writeOffId) {
      const original = await DB.prepare("SELECT id,content FROM production_documents WHERE id=? AND status='issued'").bind(row.writeOffId).first<{ id: string; content: string }>();
      if (original) {
        const reversalId = crypto.randomUUID();
        const issueDate = today();
        const pv = allocateDocumentNumber("write_off", issueDate, now);
        statements.push(
          ...pv.statements,
          DB.prepare(`INSERT INTO production_documents (id,doc_type,year,number,kind,status,reversal_of,reversed_by,issue_date,day,batch_id,content,created_by,created_at) VALUES (?,'write_off',?,${pv.numberSql},'reversal','issued',?,NULL,?,?,NULL,?,?,?)`).bind(
            reversalId,
            pv.year,
            ...pv.numberBinds,
            original.id,
            issueDate,
            d.date,
            JSON.stringify(reversalWriteOff(JSON.parse(original.content) as WriteOffContent, d.reason)),
            actor,
            now,
          ),
          DB.prepare("UPDATE production_documents SET status='reversed',reversed_by=? WHERE id=? AND status='issued'").bind(reversalId, original.id),
        );
      }
    }
    statements.push(
      ...await reverseDailyMaterials(d.date,d.reason,actor,now,session.name),
      DB.prepare("DELETE FROM finished_moves WHERE day=?").bind(d.date),
      DB.prepare("UPDATE production_day_closes SET status='open',revision=revision+1,write_off_id=NULL,closed_by=NULL,closed_at=NULL WHERE day=? AND status='closed' AND revision=?").bind(d.date, d.revision),
    );
    await DB.batch(statements).catch(failOnGuard);
    return json({ ok: true });
  }
  return null;
}
