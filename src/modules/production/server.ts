import { env } from "cloudflare:workers";
import { z } from "zod";
import type { Session } from "../access/domain";
import { isAdmin, isKitchenStaff } from "../access/domain";
import { today, type Order } from "../shared/domain";
import { validDay } from "../menu/domain";
import { addDays, lotCode } from "../labels/domain";
import { allocate, explodeRecipe, latestRecipe } from "../inventory/domain";
import { loadOperations } from "../inventory/server";
import { allocateDocumentNumber } from "../documents/server";
import { DOCUMENT_TYPES, formatDocumentNumber } from "../documents/domain";
import { committeeNames } from "../invoices/domain";
import {
  MARGIN_MAX_BPS,
  PORTIONS_MAX,
  batchNeeds,
  bcLines,
  bulkClosePlan,
  closeLinesError,
  dayDemand,
  portionsToIssue,
  reversalBc,
  type BcContent,
  type ConsumptionRef,
  type ProductionBatch,
  type ProductionDay,
} from "./domain";
import { renderBcHtml } from "./bc-print";
import { handleDayClose, loadDocRefs, loadFinishedLots, loadProductionSettings } from "./day-close";
import { reversalHandover, usableFinished, type HandoverContent } from "./finished";

/**
 * Gyártási tételek és bon de consum (v73) – csak admin (iroda). Minden írás egy D1-kötegben, változat-ellenőrzéssel:
 * az első utasítás a napló, amelynek szereplője NULL lesz (és így az egész köteg visszagörgetődik), ha a tétel közben változott.
 */
export class ProductionError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const uuid = z.string().uuid();
const day = z.string().refine(validDay);
const portions = z.number().int().min(0).max(PORTIONS_MAX);

const batchColumns =
  "id,day,product_id AS productId,code,recipe_id AS recipeId,preparation_version_ids AS preparationVersionIds,ordered,planned,actual,issued_before AS issuedBefore,status,revision,consumption_id AS consumptionId,use_by AS useBy,note,created_at AS createdAt,closed_at AS closedAt";
type BatchRow = Omit<ProductionBatch, "preparationVersionIds"> & { preparationVersionIds: string };
const toBatch = (r: BatchRow): ProductionBatch => ({ ...r, preparationVersionIds: JSON.parse(r.preparationVersionIds) as string[] });

async function loadBatch(id: string) {
  const row = await env.DB!.prepare(`SELECT ${batchColumns} FROM production_batches WHERE id=?`).bind(id).first<BatchRow>();
  if (!row) throw new ProductionError("NOT_FOUND", 404);
  return toBatch(row);
}
const loadSettings = loadProductionSettings;
/** A lezárt napra már nem vehető fel, nem módosítható és nem zárható le gyártási tétel. */
const dayClosedSql = "NOT EXISTS (SELECT 1 FROM production_day_closes WHERE day=? AND status='closed')";
async function assertDayOpen(date: string) {
  if (await env.DB!.prepare("SELECT 1 FROM production_day_closes WHERE day=? AND status='closed'").bind(date).first()) throw new ProductionError("DAY_CLOSED", 409);
}
async function bcNumbers() {
  const rows = (await env.DB!.prepare("SELECT year,prefix FROM document_series WHERE doc_type='consumption'").all<{ year: number; prefix: string }>()).results;
  return (year: number, number: number) => formatDocumentNumber(rows.find((r) => r.year === year)?.prefix ?? DOCUMENT_TYPES.consumption, year, number);
}
/** A nap visszaigazolt rendelései tételekkel, és azok, amelyekhez rendelésenként már kiadtak anyagot. */
export async function dayOrders(date: string) {
  const DB = env.DB!;
  const [orders, items, issues] = await Promise.all([
    DB.prepare("SELECT id,date,status FROM orders WHERE date=? AND status='confirmed'").bind(date).all<{ id: string; date: string; status: string }>(),
    DB.prepare("SELECT i.order_id AS orderId,i.product_id AS productId,i.hu,i.ro,i.quantity,i.ready FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.date=? AND o.status='confirmed'").bind(date).all<{ orderId: string; productId: string; hu: string; ro: string; quantity: number; ready: number }>(),
    DB.prepare("SELECT s.order_id AS orderId FROM stock_issues s JOIN orders o ON o.id=s.order_id WHERE o.date=?").bind(date).all<{ orderId: string }>(),
  ]);
  const list = orders.results.map((o) => ({ ...o, items: items.results.filter((i) => i.orderId === o.id) })) as unknown as Order[];
  return dayDemand(list, date, new Set(issues.results.map((i) => i.orderId)));
}
/** A tétel lezárásához szükséges adatok: adagok, terv szerinti anyagigény, készlet. */
async function closePlan(batch: ProductionBatch, actual: number) {
  const ops = await loadOperations();
  const recipe = batch.recipeId ? ops.recipes.find((r) => r.id === batch.recipeId) : undefined;
  if (!recipe) throw new ProductionError("BATCH_MISSING_RECIPE");
  const demand = (await dayOrders(batch.day)).get(batch.productId);
  const issuedBefore = Math.min(actual, demand?.issued ?? 0);
  const consumed = portionsToIssue(actual, issuedBefore);
  let needs: Map<string, number>;
  try {
    needs = batchNeeds(recipe, consumed, ops.preparationVersions, batch.preparationVersionIds);
  } catch {
    throw new ProductionError("BATCH_MISSING_RECIPE");
  }
  return { ops, recipe, issuedBefore, consumed, needs };
}

export async function handleProduction(path: string, body: unknown, session: Session, write: boolean, req: Request): Promise<Response> {
  // v74: a napi zárást a konyha is végzi; minden más (gyártási tétel, BC, beállítás, visszanyitás) csak admin.
  const kitchenPaths = ["/api/production/day", "/api/production/day/close", "/api/production/doc"];
  if (!isAdmin(session.role) && !(isKitchenStaff(session.role) && kitchenPaths.includes(path))) throw new ProductionError("FORBIDDEN", 403);
  const dayResponse = await handleDayClose(path, body, session, write, req);
  if (dayResponse) return dayResponse;
  const DB = env.DB!;
  const params = new URL(req.url).searchParams;
  if (!write && path === "/api/production") {
    const date = params.get("date") ?? today();
    if (!validDay(date)) throw new ProductionError("VALIDATION");
    const [demand, settings, batches, docs, numberText, products, recipes, lots, handovers, dayClose] = await Promise.all([
      dayOrders(date),
      loadSettings(),
      DB.prepare(`SELECT ${batchColumns} FROM production_batches WHERE day=?`).bind(date).all<BatchRow>(),
      DB.prepare("SELECT c.id,c.batch_id AS batchId,c.year,c.number,c.kind,c.status FROM consumption_documents c JOIN production_batches b ON b.id=c.batch_id WHERE b.day=? ORDER BY c.created_at").bind(date).all<{ id: string; batchId: string; year: number; number: number; kind: ConsumptionRef["kind"]; status: ConsumptionRef["status"] }>(),
      bcNumbers(),
      DB.prepare("SELECT id,hu,ro FROM products").all<{ id: string; hu: string; ro: string }>(),
      DB.prepare("SELECT DISTINCT product_id AS productId FROM recipes").all<{ productId: string }>(),
      loadFinishedLots(date),
      loadDocRefs("doc_type='handover' AND day=?", date),
      DB.prepare("SELECT 1 FROM production_day_closes WHERE day=? AND status='closed'").bind(date).first(),
    ]);
    // v74: korábbi napokról megmaradt, ma még kiadható adag – a javaslat ezt levonja.
    const leftover = usableFinished(lots, date).filter((l) => l.day < date);
    const withRecipe = new Set(recipes.results.map((r) => r.productId));
    const ids = [...new Set([...demand.keys(), ...batches.results.map((b) => b.productId), ...leftover.map((l) => l.productId)])];
    const result: ProductionDay = {
      date,
      marginBps: settings.marginBps,
      settingsRevision: settings.revision,
      dayClosed: !!dayClose,
      rows: ids
        .map((productId) => {
          const d = demand.get(productId),
            p = products.results.find((x) => x.id === productId),
            b = batches.results.find((x) => x.productId === productId);
          return {
            productId,
            hu: p?.hu ?? d?.hu ?? productId,
            ro: p?.ro ?? d?.ro ?? productId,
            ordered: d?.ordered ?? 0,
            issued: d?.issued ?? 0,
            ready: d?.ready ?? 0,
            opening: leftover.filter((l) => l.productId === productId).reduce((s, l) => s + l.remaining, 0),
            hasRecipe: withRecipe.has(productId),
            batch: b ? toBatch(b) : null,
            documents: b ? docs.results.filter((c) => c.batchId === b.id).map((c) => ({ id: c.id, number: numberText(c.year, c.number), kind: c.kind, status: c.status })) : [],
            handovers: b ? handovers.filter((h) => h.batchId === b.id).map((h) => ({ id: h.id, number: h.number, kind: h.kind, status: h.status })) : [],
          };
        })
        .sort((a, b) => a.hu.localeCompare(b.hu, "hu")),
    };
    return json(result);
  }
  if (!write && path === "/api/production/preview") {
    const batch = await loadBatch(uuid.parse(params.get("id")));
    const actual = portions.parse(Number(params.get("actual")));
    const plan = await closePlan(batch, actual);
    const usable = plan.ops.lots.filter((l) => l.remaining > 0 && l.received <= batch.day && l.expires >= batch.day);
    return json({
      issuedBefore: plan.issuedBefore,
      consumed: plan.consumed,
      lines: [...plan.needs].map(([ingredientId, quantity]) => {
        const i = plan.ops.ingredients.find((x) => x.id === ingredientId);
        return { ingredientId, hu: i?.hu ?? ingredientId, ro: i?.ro ?? ingredientId, unit: i?.unit ?? "g", quantity, available: usable.filter((l) => l.ingredientId === ingredientId).reduce((s, l) => s + l.remaining, 0) };
      }),
    });
  }
  if (!write && path === "/api/production/bc") {
    const id = uuid.parse(params.get("id"));
    const row = await DB.prepare("SELECT year,number,reversal_of AS reversalOf,issue_date AS issueDate,content FROM consumption_documents WHERE id=?").bind(id).first<{ year: number; number: number; reversalOf: string | null; issueDate: string; content: string }>();
    if (!row) throw new ProductionError("NOT_FOUND", 404);
    const numberText = await bcNumbers();
    const original = row.reversalOf ? await DB.prepare("SELECT year,number FROM consumption_documents WHERE id=?").bind(row.reversalOf).first<{ year: number; number: number }>() : null;
    const html = renderBcHtml(JSON.parse(row.content) as BcContent, numberText(row.year, row.number), { issueDate: row.issueDate, ...(original ? { reversalOf: numberText(original.year, original.number) } : {}) });
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Cache-Control": "private, no-store" },
    });
  }
  if (!write) return json({ error: "NOT_FOUND" }, 404);
  const now = new Date().toISOString();
  const actor = session.userId;
  const failOnGuard = (e: unknown): never => {
    if (/NOT NULL/i.test(String(e))) throw new ProductionError("CONFLICT", 409);
    if (/UNIQUE/i.test(String(e))) throw new ProductionError("CONFLICT", 409);
    if (/CHECK/i.test(String(e))) throw new ProductionError("STOCK_CONFLICT", 409);
    throw e;
  };
  /** Új nyitott tétel a legfrissebb recept pillanatképével (a mentés és a tömeges lezárás közös része). */
  const createBatch = async (date: string, productId: string, planned: number) => {
    const product = await DB.prepare("SELECT hu FROM products WHERE id=?").bind(productId).first<{ hu: string }>();
    if (!product) throw new ProductionError("INVALID_ITEM");
    await assertDayOpen(date);
    const ops = await loadOperations();
    const recipe = latestRecipe(productId, ops.recipes);
    if (!recipe) throw new ProductionError("BATCH_MISSING_RECIPE");
    const exploded = explodeRecipe(recipe, 1, ops.preparationVersions);
    if (exploded.missingPreparations.length) throw new ProductionError("BATCH_MISSING_RECIPE");
    const ordered = (await dayOrders(date)).get(productId)?.ordered ?? 0;
    const id = crypto.randomUUID();
    await DB.batch([
      DB.prepare("INSERT INTO production_batches (id,day,product_id,code,recipe_id,preparation_version_ids,ordered,planned,status,revision,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,'open',0,?,?)").bind(id, date, productId, lotCode(date, productId), recipe.id, JSON.stringify(exploded.preparationVersionIds), ordered, planned, actor, now),
      DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,'production_batch_created',?,?,?)").bind(crypto.randomUUID(), actor, id, JSON.stringify({ product: product.hu, day: date, planned }), now),
    ]).catch(failOnGuard);
    return id;
  };
  /** Egy nyitott tétel lezárása: anyagkiadás FEFO szerint, bon de consum, (ha be van kapcsolva) bon de predare – egy D1-kötegben. */
  const closeBatch = async (id: string, revision: number, actualPortions: number, givenLines: { ingredientId: string; quantity: number }[] | null, note: string) => {
    const batch = await loadBatch(id);
    if (batch.status !== "open") throw new ProductionError("BATCH_CLOSED", 409);
    if (batch.revision !== revision) throw new ProductionError("CONFLICT", 409);
    if (batch.day > today()) throw new ProductionError("BATCH_FUTURE");
    await assertDayOpen(batch.day);
    const plan = await closePlan(batch, actualPortions);
    // Sorok nélkül (tömeges lezárás): pontosan a recept szerinti mennyiségek.
    const lines = givenLines ?? [...plan.needs].map(([ingredientId, quantity]) => ({ ingredientId, quantity }));
    const lineError = closeLinesError(plan.needs, lines, note);
    if (lineError) throw new ProductionError(lineError);
    // A BC minden receptsort mutat (a 0-ra írtat is); kiosztás csak a ténylegesen felhasznált mennyiségre.
    const used = new Map(lines.map((l) => [l.ingredientId, l.quantity]));
    const actual = new Map([...used].filter(([, q]) => q > 0));
    const allocation = allocate(actual, plan.ops.lots, batch.day);
    if (allocation.shortage.length) throw new ProductionError("INSUFFICIENT_STOCK");
    if (allocation.allocations.length > 40) throw new ProductionError("TOO_MANY_LOTS");
    const shelf = await DB.prepare("SELECT shelf_life_days AS days FROM product_labels WHERE product_id=?").bind(batch.productId).first<{ days: number }>();
    const useBy = shelf ? addDays(batch.day, shelf.days) : null;
    const product = await DB.prepare("SELECT hu,ro FROM products WHERE id=?").bind(batch.productId).first<{ hu: string; ro: string }>();
    const statements: D1PreparedStatement[] = [
      DB.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM production_batches WHERE id=? AND revision=? AND status='open') AND ${dayClosedSql} THEN ? ELSE NULL END,'production_batch_closed',?,?,?)`).bind(crypto.randomUUID(), id, revision, batch.day, actor, id, JSON.stringify({ code: batch.code, product: product?.hu ?? "", actual: actualPortions, issuedBefore: plan.issuedBefore, note: note }), now),
    ];
    let consumptionId: string | null = null;
    let bcTotal = 0;
    if (actual.size) {
      consumptionId = crypto.randomUUID();
      const bcRows = bcLines(plan.needs, used, allocation.allocations, plan.ops.lots, plan.ops.ingredients);
      const content: BcContent = {
        batch: { id: batch.id, code: batch.code, day: batch.day },
        product: { ro: product?.ro ?? "", hu: product?.hu ?? "" },
        portions: { actual: actualPortions, issuedBefore: plan.issuedBefore, consumed: plan.consumed },
        recipe: { id: plan.recipe.id, version: plan.recipe.version },
        note: note,
        lines: bcRows,
        totalValue: bcRows.reduce((s, l) => s + l.value, 0),
      };
      bcTotal = content.totalValue;
      const bc = allocateDocumentNumber("consumption", batch.day, now);
      statements.push(
        ...bc.statements,
        DB.prepare(`INSERT INTO consumption_documents (id,batch_id,year,number,kind,status,reversal_of,reversed_by,issue_date,content,created_by,created_at) VALUES (?,?,?,${bc.numberSql},'consumption','issued',NULL,NULL,?,?,?,?)`).bind(consumptionId, batch.id, bc.year, ...bc.numberBinds, batch.day, JSON.stringify(content), actor, now),
        ...allocation.allocations.flatMap((a) => [
          DB.prepare("UPDATE stock_lots SET remaining=remaining-? WHERE id=?").bind(a.quantity, a.lotId),
          DB.prepare("INSERT INTO stock_moves (id,lot_id,issue_id,batch_id,quantity,kind,note,created_at) VALUES (?,?,NULL,?,?,'production',?,?)").bind(crypto.randomUUID(), a.lotId, batch.id, -a.quantity, batch.code, now),
        ]),
      );
    }
    // v74: bon de predare (ha be van kapcsolva) – a kész étel átadása a készletbe, a BC értékével.
    if ((await loadSettings()).handoverEnabled && actualPortions > 0) {
      const handover: HandoverContent = { batch: { id: batch.id, code: batch.code, day: batch.day }, product: { ro: product?.ro ?? "", hu: product?.hu ?? "" }, portions: actualPortions, useBy, value: bcTotal };
      const bp = allocateDocumentNumber("handover", batch.day, now);
      statements.push(
        ...bp.statements,
        DB.prepare(`INSERT INTO production_documents (id,doc_type,year,number,kind,status,reversal_of,reversed_by,issue_date,day,batch_id,content,created_by,created_at) VALUES (?,'handover',?,${bp.numberSql},'issue','issued',NULL,NULL,?,?,?,?,?,?)`).bind(crypto.randomUUID(), bp.year, ...bp.numberBinds, batch.day, batch.day, batch.id, JSON.stringify(handover), actor, now),
      );
    }
    statements.push(
      DB.prepare("UPDATE production_batches SET status='closed',actual=?,issued_before=?,consumption_id=?,use_by=?,note=?,closed_by=?,closed_at=?,revision=revision+1 WHERE id=? AND revision=? AND status='open'").bind(actualPortions, plan.issuedBefore, consumptionId, useBy, note, actor, now, id, revision),
    );
    await DB.batch(statements).catch(failOnGuard);
    return consumptionId;
  };

  if (path === "/api/production/save") {
    // Tétel felvétele vagy a nyitott tétel tervezett adagszámának mentése; a receptpillanatkép ilyenkor a legfrissebb receptre frissül.
    const d = z.object({ date: day, productId: z.string().min(1).max(200), planned: portions, revision: z.number().int().min(0).nullable() }).strict().parse(body);
    const product = await DB.prepare("SELECT hu FROM products WHERE id=?").bind(d.productId).first<{ hu: string }>();
    if (!product) throw new ProductionError("INVALID_ITEM");
    await assertDayOpen(d.date);
    const ops = await loadOperations();
    const recipe = latestRecipe(d.productId, ops.recipes);
    if (!recipe) throw new ProductionError("BATCH_MISSING_RECIPE");
    const exploded = explodeRecipe(recipe, 1, ops.preparationVersions);
    if (exploded.missingPreparations.length) throw new ProductionError("BATCH_MISSING_RECIPE");
    const ordered = (await dayOrders(d.date)).get(d.productId)?.ordered ?? 0;
    const prepIds = JSON.stringify(exploded.preparationVersionIds);
    if (d.revision === null) return json({ ok: true, id: await createBatch(d.date, d.productId, d.planned) }, 201);
    const existing = await DB.prepare("SELECT id FROM production_batches WHERE day=? AND product_id=?").bind(d.date, d.productId).first<{ id: string }>();
    if (!existing) throw new ProductionError("CONFLICT", 409);
    await DB.batch([
      DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM production_batches WHERE id=? AND revision=? AND status='open') THEN ? ELSE NULL END,'production_batch_planned',?,?,?)").bind(crypto.randomUUID(), existing.id, d.revision, actor, existing.id, JSON.stringify({ product: product.hu, planned: d.planned }), now),
      DB.prepare("UPDATE production_batches SET planned=?,ordered=?,recipe_id=?,preparation_version_ids=?,revision=revision+1 WHERE id=? AND revision=? AND status='open'").bind(d.planned, ordered, recipe.id, prepIds, existing.id, d.revision),
    ]).catch(failOnGuard);
    return json({ ok: true, id: existing.id });
  }

  if (path === "/api/production/delete") {
    // Csak nyitott (anyagkiadás nélküli) tétel törölhető – annak még nincs bizonylata.
    const d = z.object({ id: uuid, revision: z.number().int().min(0) }).strict().parse(body);
    const batch = await loadBatch(d.id);
    if (batch.status !== "open") throw new ProductionError("BATCH_CLOSED", 409);
    if (await DB.prepare("SELECT 1 FROM consumption_documents WHERE batch_id=? LIMIT 1").bind(d.id).first()) throw new ProductionError("BATCH_HAS_DOCUMENT", 409);
    await assertDayOpen(batch.day);
    await DB.batch([
      DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM production_batches WHERE id=? AND revision=? AND status='open') THEN ? ELSE NULL END,'production_batch_deleted',?,?,?)").bind(crypto.randomUUID(), d.id, d.revision, actor, d.id, JSON.stringify({ code: batch.code, day: batch.day }), now),
      DB.prepare("DELETE FROM production_batches WHERE id=? AND revision=? AND status='open'").bind(d.id, d.revision),
    ]).catch(failOnGuard);
    return json({ ok: true });
  }

  if (path === "/api/production/close") {
    const d = z
      .object({
        id: uuid,
        revision: z.number().int().min(0),
        actual: portions,
        note: z.string().trim().max(1000),
        lines: z.array(z.object({ ingredientId: z.string().min(1).max(200), quantity: z.number().int().min(0).max(100_000_000) }).strict()).max(60),
      })
      .strict()
      .parse(body);
    return json({ ok: true, consumptionId: await closeBatch(d.id, d.revision, d.actual, d.lines, d.note) });
  }

  if (path === "/api/production/close-all") {
    // v78: a nap összes (recepttel rendelkező, még nem lezárt) ételének felvétele és lezárása recept szerint. Ételenként külön
    // köteg: ami nem zárható le (pl. kevés a készlet), az kimarad az okával, a többi lezárul.
    const d = z.object({ date: day }).strict().parse(body);
    if (d.date > today()) throw new ProductionError("BATCH_FUTURE");
    await assertDayOpen(d.date);
    const [demand, batches, recipes, products] = await Promise.all([
      dayOrders(d.date),
      DB.prepare(`SELECT ${batchColumns} FROM production_batches WHERE day=?`).bind(d.date).all<BatchRow>(),
      DB.prepare("SELECT DISTINCT product_id AS productId FROM recipes").all<{ productId: string }>(),
      DB.prepare("SELECT id,hu,ro FROM products").all<{ id: string; hu: string; ro: string }>(),
    ]);
    const plan = bulkClosePlan(
      [...demand].map(([productId, x]) => ({ productId, ordered: x.ordered })),
      batches.results.map((b) => ({ id: b.id, productId: b.productId, status: b.status, planned: b.planned })),
      new Set(recipes.results.map((r) => r.productId)),
    );
    const closed: { productId: string; name: string; actual: number }[] = [];
    const skipped: { productId: string; name: string; code: string }[] = [];
    const name = (id: string) => products.results.find((p) => p.id === id)?.hu ?? demand.get(id)?.hu ?? id;
    for (const step of plan.steps) {
      try {
        const id = step.batchId ?? (await createBatch(d.date, step.productId, step.actual));
        const batch = await loadBatch(id);
        await closeBatch(id, batch.revision, step.actual, null, "");
        closed.push({ productId: step.productId, name: name(step.productId), actual: step.actual });
      } catch (e) {
        skipped.push({ productId: step.productId, name: name(step.productId), code: e instanceof ProductionError ? e.code : "SERVER_ERROR" });
      }
    }
    return json({ ok: true, closed, skipped });
  }

  if (path === "/api/production/reverse") {
    // BC sztornó: sztornó-BC negatív sorokkal, a mennyiség visszakerül ugyanazokba a raktári tételekbe, a tétel újra nyitott.
    const d = z.object({ id: uuid, revision: z.number().int().min(0), reason: z.string().trim().min(3).max(500) }).strict().parse(body);
    const batch = await loadBatch(d.id);
    if (batch.status !== "closed") throw new ProductionError("BATCH_OPEN", 409);
    if (batch.revision !== d.revision) throw new ProductionError("CONFLICT", 409);
    // v74: amiből már kiadtak (eladás, selejt…) vagy amelynek napja lezárt, az előbb a nap visszanyitását kéri.
    if (await DB.prepare("SELECT 1 FROM finished_moves WHERE batch_id=? LIMIT 1").bind(d.id).first()) throw new ProductionError("BATCH_HAS_MOVES", 409);
    await assertDayOpen(batch.day);
    const guardSql = DB.prepare(`INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM production_batches WHERE id=? AND revision=? AND status='closed') AND NOT EXISTS (SELECT 1 FROM finished_moves WHERE batch_id=?) AND ${dayClosedSql} THEN ? ELSE NULL END,'production_batch_reversed',?,?,?)`);
    const guard = { bind: (id: string, batchId: string, revision: number, who: string, ...rest: unknown[]) => guardSql.bind(id, batchId, revision, batchId, batch.day, who, ...rest) };
    // A bon de predare (ha volt) a BC-vel együtt sztornózódik.
    const handoverDoc = await DB.prepare("SELECT id,content FROM production_documents WHERE batch_id=? AND doc_type='handover' AND kind='issue' AND status='issued'").bind(d.id).first<{ id: string; content: string }>();
    const handoverReversal: D1PreparedStatement[] = [];
    if (handoverDoc) {
      const bp = allocateDocumentNumber("handover", today(), now);
      const reversalHandoverId = crypto.randomUUID();
      handoverReversal.push(
        ...bp.statements,
        DB.prepare(`INSERT INTO production_documents (id,doc_type,year,number,kind,status,reversal_of,reversed_by,issue_date,day,batch_id,content,created_by,created_at) VALUES (?,'handover',?,${bp.numberSql},'reversal','issued',?,NULL,?,?,?,?,?,?)`).bind(reversalHandoverId, bp.year, ...bp.numberBinds, handoverDoc.id, today(), batch.day, batch.id, JSON.stringify(reversalHandover(JSON.parse(handoverDoc.content) as HandoverContent, d.reason)), actor, now),
        DB.prepare("UPDATE production_documents SET status='reversed',reversed_by=? WHERE id=? AND status='issued'").bind(reversalHandoverId, handoverDoc.id),
      );
    }
    const reopen = DB.prepare("UPDATE production_batches SET status='open',actual=NULL,issued_before=0,consumption_id=NULL,use_by=NULL,closed_by=NULL,closed_at=NULL,revision=revision+1 WHERE id=? AND revision=? AND status='closed'").bind(d.id, d.revision);
    if (!batch.consumptionId) {
      await DB.batch([guard.bind(crypto.randomUUID(), d.id, d.revision, actor, d.id, JSON.stringify({ code: batch.code, reason: d.reason }), now), ...handoverReversal, reopen]).catch(failOnGuard);
      return json({ ok: true, consumptionId: null });
    }
    const original = await DB.prepare("SELECT id,year,number,content FROM consumption_documents WHERE id=? AND status='issued'").bind(batch.consumptionId).first<{ id: string; year: number; number: number; content: string }>();
    if (!original) throw new ProductionError("CONFLICT", 409);
    const reversal = reversalBc(JSON.parse(original.content) as BcContent, d.reason);
    const reversalId = crypto.randomUUID();
    const issueDate = today();
    const bc = allocateDocumentNumber("consumption", issueDate, now);
    const numberText = (await bcNumbers())(original.year, original.number);
    await DB.batch([
      guard.bind(crypto.randomUUID(), d.id, d.revision, actor, d.id, JSON.stringify({ code: batch.code, bc: numberText, reason: d.reason }), now),
      ...bc.statements,
      DB.prepare(`INSERT INTO consumption_documents (id,batch_id,year,number,kind,status,reversal_of,reversed_by,issue_date,content,created_by,created_at) VALUES (?,?,?,${bc.numberSql},'reversal','issued',?,NULL,?,?,?,?)`).bind(reversalId, batch.id, bc.year, ...bc.numberBinds, original.id, issueDate, JSON.stringify(reversal), actor, now),
      DB.prepare("UPDATE consumption_documents SET status='reversed',reversed_by=? WHERE id=? AND status='issued'").bind(reversalId, original.id),
      ...reversal.lines.flatMap((l) =>
        l.lots.flatMap((x) => [
          DB.prepare("UPDATE stock_lots SET remaining=remaining+? WHERE id=?").bind(-x.quantity, x.lotId),
          DB.prepare("INSERT INTO stock_moves (id,lot_id,issue_id,batch_id,quantity,kind,note,created_at) VALUES (?,?,NULL,?,?,'production_reversal',?,?)").bind(crypto.randomUUID(), x.lotId, batch.id, -x.quantity, batch.code, now),
        ]),
      ),
      ...handoverReversal,
      reopen,
    ]).catch(failOnGuard);
    return json({ ok: true, consumptionId: reversalId });
  }

  if (path === "/api/production/settings") {
    // v74: a ráhagyás mellett a selejt-PV aláírói és a bon de predare kapcsoló is (a hiányzó mező a mostani értéken marad).
    const d = z
      .object({
        revision: z.number().int().min(0),
        marginBps: z.number().int().min(0).max(MARGIN_MAX_BPS).optional(),
        writeOffCommittee: z.string().max(1000).optional(),
        handoverEnabled: z.boolean().optional(),
      })
      .strict()
      .parse(body);
    const current = await loadSettings();
    const next = {
      marginBps: d.marginBps ?? current.marginBps,
      writeOffCommittee: d.writeOffCommittee === undefined ? current.writeOffCommittee : committeeNames(d.writeOffCommittee).join("\n"),
      handoverEnabled: d.handoverEnabled === undefined ? current.handoverEnabled : d.handoverEnabled ? 1 : 0,
    };
    await DB.batch([
      DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN COALESCE((SELECT revision FROM production_settings WHERE id=1),0)=? THEN ? ELSE NULL END,'production_settings_saved','production_settings',?,?)").bind(crypto.randomUUID(), d.revision, actor, JSON.stringify(next), now),
      DB.prepare("INSERT INTO production_settings (id,margin_bps,write_off_committee,handover_enabled,revision) VALUES (1,?,?,?,1) ON CONFLICT(id) DO UPDATE SET margin_bps=excluded.margin_bps,write_off_committee=excluded.write_off_committee,handover_enabled=excluded.handover_enabled,revision=production_settings.revision+1").bind(next.marginBps, next.writeOffCommittee, next.handoverEnabled),
    ]).catch(failOnGuard);
    return json({ ok: true });
  }
  return json({ error: "NOT_FOUND" }, 404);
}
