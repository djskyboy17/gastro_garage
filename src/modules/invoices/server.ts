import { env } from "cloudflare:workers";
import { z } from "zod";
import { today } from "../shared/domain";
import { isAdmin, type Session } from "../access/domain";
import {
  InvoiceError,
  INVOICE_FILE_MAX_BYTES,
  INVOICE_MAX_LINES,
  detectInvoiceFile,
  normalizeExtraction,
  suggestIngredient,
  mappingKey,
  defaultFactor,
  baseQuantityOf,
  lineReceiveError,
  costOf,
  parseInvoiceDate,
  type CostBasis,
  type Invoice,
  type InvoiceLine,
  type InvoiceMapping,
  type InvoicesData,
  type ExtractedInvoice,
} from "./domain";
import { extractWithGemini, GEMINI_MODEL } from "./gemini";
export { InvoiceError };

/**
 * Beszállítói számlák (v65) – szerver: lista, fájl, beolvasás (Gemini vagy kézi), piszkozat mentése, bevételezés, elvetés, beállítás.
 * A Gemini-hívás a tranzakción kívül történik; minden írás egy D1-kötegben, változat-ellenőrzéssel és naplóval.
 */
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const uuid = z.string().uuid();
const isoDate = z.string().refine((v) => parseInvoiceDate(v) === v);
const optionalDate = z.union([z.literal(""), isoDate]);
const money = z.number().int().min(-100_000_000).max(100_000_000);

type InvoiceRow = Omit<Invoice, "lines">;
const invoiceColumns =
  "id,kind,status,revision,supplier_name AS supplierName,supplier_tax_id AS supplierTaxId,series,number,issue_date AS issueDate,currency,subtotal,vat_total AS vatTotal,sgr_total AS sgrTotal,total,source,model,has_file AS hasFile,(SELECT mime FROM supplier_invoice_files f WHERE f.invoice_id=supplier_invoices.id) AS fileMime,note,cost_basis AS costBasis,received_date AS receivedDate,received_by AS receivedBy,received_at AS receivedAt,created_by AS createdBy,created_at AS createdAt";
const lineColumns =
  "id,invoice_id AS invoiceId,position,description,invoice_quantity AS invoiceQuantity,invoice_unit AS invoiceUnit,line_net AS lineNet,vat_rate AS vatRate,line_gross AS lineGross,deposit,skip,ingredient_id AS ingredientId,base_quantity AS baseQuantity,expires,batch,lot_id AS lotId";

async function loadSettings(): Promise<{ costBasis: CostBasis; revision: number }> {
  const row = await env.DB!.prepare("SELECT cost_basis AS costBasis,revision FROM purchase_settings WHERE id=1").first<{ costBasis: CostBasis; revision: number }>();
  return row ?? { costBasis: "net", revision: 0 };
}
async function loadMappings(): Promise<InvoiceMapping[]> {
  return (await env.DB!.prepare("SELECT key,ingredient_id AS ingredientId,factor FROM invoice_item_mappings ORDER BY updated_at DESC LIMIT 5000").all<InvoiceMapping>()).results;
}

/** A Beszerzés „Számlák” lapjának adatai: az utolsó 100 számla soraival, a megjegyzett párosítások és a beállítás. */
export async function loadInvoices(): Promise<InvoicesData> {
  const [invoices, lines, mappings, settings] = await Promise.all([
    env.DB!.prepare(`SELECT ${invoiceColumns} FROM supplier_invoices ORDER BY created_at DESC LIMIT 100`).all<InvoiceRow>(),
    env.DB!.prepare(`SELECT ${lineColumns} FROM supplier_invoice_lines WHERE invoice_id IN (SELECT id FROM supplier_invoices ORDER BY created_at DESC LIMIT 100) ORDER BY position`).all<InvoiceLine & { invoiceId: string }>(),
    loadMappings(),
    loadSettings(),
  ]);
  return {
    invoices: invoices.results.map((i) => ({ ...i, lines: lines.results.filter((l) => l.invoiceId === i.id).map(({ invoiceId: _unused, ...l }) => l) })),
    mappings,
    costBasis: settings.costBasis,
    settingsRevision: settings.revision,
    aiEnabled: Boolean(env.GEMINI_API_KEY),
  };
}

/** A számla eredeti képe / PDF-je (csak a Beszerzés jogosultjainak; a hívó ellenőrzi a szerepkört). */
export async function serveInvoiceFile(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!uuid.safeParse(id).success) return json({ error: "NOT_FOUND" }, 404);
  const row = await env.DB!.prepare("SELECT mime,data FROM supplier_invoice_files WHERE invoice_id=?").bind(id).first<{ mime: string; data: string }>();
  if (!row) return json({ error: "NOT_FOUND" }, 404);
  return new Response(fromBase64(row.data), {
    headers: { "Content-Type": row.mime, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Cache-Control": "private, no-store" },
  });
}

function fromBase64(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new InvoiceError("INVOICE_FILE_FORMAT");
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const scanInput = z
  .object({ id: uuid, data: z.string().max(Math.ceil(INVOICE_FILE_MAX_BYTES / 3) * 4).optional(), ai: z.boolean() })
  .strict();
const lineInput = z
  .object({
    id: uuid,
    description: z.string().trim().max(300),
    invoiceQuantity: z.number().int().min(0).max(1_000_000_000),
    invoiceUnit: z.string().trim().max(20),
    lineNet: money.nullable(),
    vatRate: z.number().int().min(0).max(10000).nullable(),
    lineGross: money.nullable(),
    deposit: z.union([z.literal(0), z.literal(1)]),
    skip: z.union([z.literal(0), z.literal(1)]),
    ingredientId: z.string().min(1).max(200).nullable(),
    baseQuantity: z.number().int().min(0).max(100_000_000),
    expires: optionalDate,
    batch: z.string().trim().max(100),
  })
  .strict();
const saveInput = z
  .object({
    id: uuid,
    revision: z.number().int().min(0),
    kind: z.enum(["factura", "bon_fiscal"]),
    supplierName: z.string().trim().max(200),
    supplierTaxId: z.string().trim().max(20),
    series: z.string().trim().max(40),
    number: z.string().trim().max(40),
    issueDate: optionalDate,
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    subtotal: money.nullable(),
    vatTotal: money.nullable(),
    sgrTotal: money,
    total: money.nullable(),
    note: z.string().trim().max(1000),
    lines: z.array(lineInput).max(INVOICE_MAX_LINES),
  })
  .strict();

export async function handleInvoices(path: string, body: unknown, session: Session, write: boolean, req: Request): Promise<Response> {
  if (!write) {
    if (path === "/api/invoices") return json(await loadInvoices());
    if (path === "/api/invoices/file") return await serveInvoiceFile(req);
    return json({ error: "NOT_FOUND" }, 404);
  }
  const now = new Date().toISOString(),
    actor = session.userId;
  const audit = (action: string, entity: string, detail: string) =>
    env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), actor, action, entity, detail, now);
  // Változat-ellenőrzés: ha a számla közben változott (vagy már nem piszkozat), a NULL szereplő miatt az egész köteg visszagörgetődik.
  const guard = (action: string, id: string, revision: number, detail: string) =>
    env
      .DB!.prepare(
        "INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM supplier_invoices WHERE id=? AND revision=? AND status='draft') THEN ? ELSE NULL END,?,?,?,?)",
      )
      .bind(crypto.randomUUID(), id, revision, actor, action, id, detail, now);
  const run = async (statements: D1PreparedStatement[]) => {
    try {
      return await env.DB!.batch(statements);
    } catch (e) {
      if (/NOT NULL|UNIQUE|CHECK|FOREIGN KEY/.test(String(e))) throw new InvoiceError("CONFLICT", 409);
      throw e;
    }
  };

  if (path === "/api/invoices/scan") {
    const d = scanInput.parse(body);
    const existing = await env.DB!.prepare("SELECT id FROM supplier_invoices WHERE id=?").bind(d.id).first();
    if (existing) return json({ ok: true, id: d.id });
    let file: { mime: string; bytes: number } | null = null;
    if (d.data) {
      const bytes = fromBase64(d.data);
      if (bytes.length > INVOICE_FILE_MAX_BYTES) throw new InvoiceError("INVOICE_FILE_TOO_LARGE", 413);
      const mime = detectInvoiceFile(bytes);
      if (!mime) throw new InvoiceError("INVOICE_FILE_FORMAT");
      file = { mime, bytes: bytes.length };
    }
    let extracted: ExtractedInvoice | null = null;
    const model = env.GEMINI_MODEL || GEMINI_MODEL;
    if (d.ai) {
      if (!file || !d.data) throw new InvoiceError("INVOICE_FILE_REQUIRED");
      extracted = normalizeExtraction(await extractWithGemini({ apiKey: env.GEMINI_API_KEY ?? "", mime: file.mime, base64: d.data, model }));
    }
    // Alapanyag-javaslat soronként: megjegyzett párosítás vagy név szerinti egyezés; ha az átváltás egyértelmű, a raktári mennyiség is.
    const [ingredientRows, mappings] = await Promise.all([
      env.DB!.prepare("SELECT id,hu,ro,unit,grams_per_piece AS gramsPerPiece FROM ingredients").all<{ id: string; hu: string; ro: string; unit: string; gramsPerPiece: number | null }>(),
      extracted?.lines.length ? loadMappings() : Promise.resolve([] as InvoiceMapping[]),
    ]);
    const lines: InvoiceLine[] = (extracted?.lines ?? []).map((l) => {
      const suggestion = l.deposit ? null : suggestIngredient(l.description, mappingKey(extracted!.supplierTaxId, extracted!.supplierName, l.description), ingredientRows.results, mappings);
      const ingredient = ingredientRows.results.find((i) => i.id === suggestion?.ingredientId);
      const factor = suggestion?.factor ?? (ingredient ? defaultFactor(l.invoiceUnit, ingredient) : null);
      return { ...l, id: crypto.randomUUID(), skip: l.deposit, ingredientId: suggestion?.ingredientId ?? null, baseQuantity: factor ? baseQuantityOf(l.invoiceQuantity, factor) : 0, expires: "", batch: "", lotId: null };
    });
    const h = extracted ?? { kind: "factura", supplierName: "", supplierTaxId: "", series: "", number: "", issueDate: "", currency: "RON", subtotal: null, vatTotal: null, sgrTotal: 0, total: null };
    try {
      await env.DB!.batch([
        env
          .DB!.prepare(
            "INSERT INTO supplier_invoices (id,kind,status,revision,supplier_name,supplier_tax_id,series,number,issue_date,currency,subtotal,vat_total,sgr_total,total,source,model,has_file,note,created_by,created_at) VALUES (?,?,'draft',0,?,?,?,?,?,?,?,?,?,?,?,?,?,'',?,?)",
          )
          .bind(d.id, h.kind, h.supplierName, h.supplierTaxId, h.series, h.number, h.issueDate, h.currency, h.subtotal, h.vatTotal, h.sgrTotal, h.total, d.ai ? "ai" : "manual", d.ai ? model : "", file ? 1 : 0, actor, now),
        ...(file ? [env.DB!.prepare("INSERT INTO supplier_invoice_files (invoice_id,mime,bytes,data) VALUES (?,?,?,?)").bind(d.id, file.mime, file.bytes, d.data!)] : []),
        ...(lines.length ? [insertLines(d.id, lines)] : []),
        audit(d.ai ? "invoice_scanned" : "invoice_created", d.id, JSON.stringify({ supplier: h.supplierName, number: h.series + h.number, lines: lines.length, file: file?.mime ?? "" })),
      ]);
    } catch (e) {
      // Dupla kattintás / ismételt kérés ugyanazzal az azonosítóval: a meglévő számlát adjuk vissza.
      if (/UNIQUE/.test(String(e)) && (await env.DB!.prepare("SELECT id FROM supplier_invoices WHERE id=?").bind(d.id).first())) return json({ ok: true, id: d.id });
      throw e;
    }
    return json({ ok: true, id: d.id }, 201);
  }

  if (path === "/api/invoices/save") {
    const d = saveInput.parse(body);
    if (new Set(d.lines.map((l) => l.id)).size !== d.lines.length) throw new InvoiceError("VALIDATION");
    const ids = [...new Set(d.lines.map((l) => l.ingredientId).filter((v): v is string => !!v))];
    if (ids.length) {
      const found = await env.DB!.prepare(`SELECT COUNT(*) AS n FROM ingredients WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).first<{ n: number }>();
      if (Number(found?.n) !== ids.length) throw new InvoiceError("INVALID_ITEM");
    }
    const lines: InvoiceLine[] = d.lines.map((l, i) => ({ ...l, position: i + 1, lotId: null }));
    const result = await run([
      guard("invoice_saved", d.id, d.revision, JSON.stringify({ lines: lines.length })),
      env.DB!.prepare("DELETE FROM supplier_invoice_lines WHERE invoice_id=?").bind(d.id),
      ...(lines.length ? [insertLines(d.id, lines)] : []),
      env
        .DB!.prepare(
          "UPDATE supplier_invoices SET kind=?,supplier_name=?,supplier_tax_id=?,series=?,number=?,issue_date=?,currency=?,subtotal=?,vat_total=?,sgr_total=?,total=?,note=?,revision=revision+1 WHERE id=? AND revision=? AND status='draft'",
        )
        .bind(d.kind, d.supplierName, d.supplierTaxId, d.series, d.number, d.issueDate, d.currency, d.subtotal, d.vatTotal, d.sgrTotal, d.total, d.note, d.id, d.revision),
    ]);
    if (result[result.length - 1]!.meta.changes !== 1) throw new InvoiceError("CONFLICT", 409);
    return json({ ok: true, revision: d.revision + 1 });
  }

  if (path === "/api/invoices/receive") {
    const d = z.object({ id: uuid, revision: z.number().int().min(0), receivedDate: isoDate }).strict().parse(body);
    if (d.receivedDate > today()) throw new InvoiceError("INVALID_DATES");
    const invoice = await env.DB!.prepare(`SELECT ${invoiceColumns} FROM supplier_invoices WHERE id=?`).bind(d.id).first<InvoiceRow>();
    if (!invoice) throw new InvoiceError("NOT_FOUND", 404);
    if (invoice.status !== "draft" || invoice.revision !== d.revision) throw new InvoiceError("CONFLICT", 409);
    const lines = (await env.DB!.prepare(`SELECT ${lineColumns} FROM supplier_invoice_lines WHERE invoice_id=? ORDER BY position`).bind(d.id).all<InvoiceLine>()).results;
    const { costBasis } = await loadSettings();
    const receivable = lines.filter((l) => !l.skip);
    if (!receivable.length) throw new InvoiceError("INVOICE_NOTHING_TO_RECEIVE");
    for (const l of receivable) {
      const error = lineReceiveError(l, d.receivedDate, costBasis);
      if (error) throw new InvoiceError(error);
    }
    const label = (invoice.kind === "bon_fiscal" ? "Bon fiscal" : "Factura") + " " + [invoice.series + invoice.number, invoice.issueDate].filter(Boolean).join(" / ");
    const document = label.trim().slice(0, 200);
    const statements: D1PreparedStatement[] = [guard("invoice_received", d.id, d.revision, JSON.stringify({ lines: receivable.length, costBasis }))];
    for (const l of receivable) {
      const lotId = crypto.randomUUID(),
        cost = costOf(l, costBasis)!;
      const batch = (l.batch || invoice.series + invoice.number || d.id.slice(0, 8)).slice(0, 100);
      statements.push(
        env
          .DB!.prepare(
            "INSERT INTO stock_lots (id,ingredient_id,batch,supplier,received,expires,quantity,remaining,total_cost,document,created_at,revision,adjustment_total,purchase_line_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,0,NULL)",
          )
          .bind(lotId, l.ingredientId, batch, (invoice.supplierName || "—").slice(0, 200), d.receivedDate, l.expires, l.baseQuantity, l.baseQuantity, cost, document, now),
        env.DB!.prepare("INSERT INTO stock_moves (id,lot_id,issue_id,quantity,kind,note,created_at) VALUES (?,?,NULL,?,'received',?,?)").bind(crypto.randomUUID(), lotId, l.baseQuantity, document, now),
        env.DB!.prepare("UPDATE supplier_invoice_lines SET lot_id=? WHERE id=? AND invoice_id=?").bind(lotId, l.id, d.id),
      );
      // A párosítás megjegyzése a következő számlához (szállító + megnevezés → alapanyag, átváltás).
      if (l.invoiceQuantity > 0 && l.description)
        statements.push(
          env
            .DB!.prepare("INSERT INTO invoice_item_mappings (key,ingredient_id,factor,updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET ingredient_id=excluded.ingredient_id,factor=excluded.factor,updated_at=excluded.updated_at")
            .bind(mappingKey(invoice.supplierTaxId, invoice.supplierName, l.description), l.ingredientId, Math.max(1, Math.round((l.baseQuantity * 1000) / l.invoiceQuantity)), now),
        );
    }
    statements.push(
      env
        .DB!.prepare("UPDATE supplier_invoices SET status='received',revision=revision+1,cost_basis=?,received_date=?,received_by=?,received_at=? WHERE id=? AND revision=? AND status='draft'")
        .bind(costBasis, d.receivedDate, actor, now, d.id, d.revision),
    );
    const result = await run(statements);
    if (result[result.length - 1]!.meta.changes !== 1) throw new InvoiceError("CONFLICT", 409);
    return json({ ok: true, lots: receivable.length });
  }

  if (path === "/api/invoices/discard") {
    const d = z.object({ id: uuid, revision: z.number().int().min(0) }).strict().parse(body);
    const result = await run([
      guard("invoice_discarded", d.id, d.revision, ""),
      env.DB!.prepare("DELETE FROM supplier_invoice_lines WHERE invoice_id=? AND EXISTS (SELECT 1 FROM supplier_invoices WHERE id=? AND status='draft')").bind(d.id, d.id),
      env.DB!.prepare("DELETE FROM supplier_invoice_files WHERE invoice_id=? AND EXISTS (SELECT 1 FROM supplier_invoices WHERE id=? AND status='draft')").bind(d.id, d.id),
      env.DB!.prepare("DELETE FROM supplier_invoices WHERE id=? AND revision=? AND status='draft'").bind(d.id, d.revision),
    ]);
    if (result[result.length - 1]!.meta.changes !== 1) throw new InvoiceError("CONFLICT", 409);
    return json({ ok: true });
  }

  if (path === "/api/invoices/settings") {
    if (!isAdmin(session.role)) throw new InvoiceError("FORBIDDEN", 403);
    const d = z.object({ revision: z.number().int().min(0), costBasis: z.enum(["net", "gross"]) }).strict().parse(body);
    const result = await run([
      env
        .DB!.prepare(
          "INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN (?=0 AND NOT EXISTS (SELECT 1 FROM purchase_settings WHERE id=1)) OR EXISTS (SELECT 1 FROM purchase_settings WHERE id=1 AND revision=?) THEN ? ELSE NULL END,'purchase_settings_updated','purchase_settings',?,?)",
        )
        .bind(crypto.randomUUID(), d.revision, d.revision, actor, d.costBasis, now),
      env
        .DB!.prepare("INSERT INTO purchase_settings (id,cost_basis,revision) VALUES (1,?,1) ON CONFLICT(id) DO UPDATE SET cost_basis=excluded.cost_basis,revision=purchase_settings.revision+1 WHERE purchase_settings.revision=?")
        .bind(d.costBasis, d.revision),
    ]);
    if (result[1]!.meta.changes !== 1) throw new InvoiceError("CONFLICT", 409);
    return json({ ok: true });
  }
  return json({ error: "NOT_FOUND" }, 404);
}

/** Számlasorok beszúrása egy utasítással (JSON-tömbből). */
function insertLines(invoiceId: string, lines: InvoiceLine[]) {
  return env
    .DB!.prepare(
      "INSERT INTO supplier_invoice_lines (id,invoice_id,position,description,invoice_quantity,invoice_unit,line_net,vat_rate,line_gross,deposit,skip,ingredient_id,base_quantity,expires,batch,lot_id) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.position'),json_extract(value,'$.description'),json_extract(value,'$.invoiceQuantity'),json_extract(value,'$.invoiceUnit'),json_extract(value,'$.lineNet'),json_extract(value,'$.vatRate'),json_extract(value,'$.lineGross'),json_extract(value,'$.deposit'),json_extract(value,'$.skip'),json_extract(value,'$.ingredientId'),json_extract(value,'$.baseQuantity'),json_extract(value,'$.expires'),json_extract(value,'$.batch'),NULL FROM json_each(?)",
    )
    .bind(invoiceId, JSON.stringify(lines));
}
