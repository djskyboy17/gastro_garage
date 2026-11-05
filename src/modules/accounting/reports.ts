import { env } from "cloudflare:workers";
import { monthRange } from "../billing/domain";
import { loadSettings } from "../labels/server";
import { formatDocumentNumber, DOCUMENT_TYPES, type DocumentType } from "../documents/domain";
import { renderBcHtml, renderHandoverHtml, renderWriteOffHtml } from "../production/bc-print";
import type { BcContent } from "../production/domain";
import type { HandoverContent, WriteOffContent, DayRow } from "../production/finished";
import { renderNirHtml } from "../invoices/nir-print";
import { grossOf, type Invoice, type NirContent } from "../invoices/domain";
import { noteSection, type DeliveryNoteContent } from "../delivery-notes/domain";
import { cashDay, renderCashRegisterHtml, type CashEntry } from "../finance/domain";
import {
  weekRange, monthWeeks, accountingDeadline, consumptionSection, reportDocumentBody, reportPage,
  escapeReport as esc, reportLei as lei, type BcReportDocument,
} from "./report-domain";

const MAX_DOCUMENTS = 1500;
const MAX_CONTENT_BYTES = 6 * 1024 * 1024;
const encoder = new TextEncoder();
const contentBytes = (content: string) => encoder.encode(content).byteLength;
const documentNames: Record<string, string> = { consumption: "Bon de consum", nir: "NIR", handover: "Bon de predare", write_off: "Proces-verbal de casare", delivery_note: "Aviz" };
const sources = [
  { table: "consumption_documents", type: "'consumption'" },
  { table: "production_documents", type: "d.doc_type" },
  { table: "nir_documents", type: "'nir'" },
  { table: "delivery_notes", type: "'delivery_note'" },
] as const;
type DocumentRow = { id: string; type: DocumentType; year: number; number: number; issueDate: string; kind: string; content: string; originalYear: number | null; originalNumber: number | null };
type ExpenseRow = { id: string; invoiceId: string; postingDay: string; kind: string; amount: number; content: string };

function response(html: string) {
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
}

function table(headers: string[], rows: string[][]) {
  return `<table><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${headers.length}">Fără înregistrări.</td></tr>`}</tbody></table>`;
}

function invoiceLink(value: string) {
  if (/^\/api\/billing\/simulated-doc\?id=[a-f0-9-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["oblio.eu", "www.oblio.eu"].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

function expenseSection(expense: ExpenseRow) {
  const invoice = JSON.parse(expense.content) as Invoice;
  return `<h1>REGISTRU CHELTUIELI · ${expense.kind === "reversal" ? "CORECȚIE" : "ÎNREGISTRARE"}</h1>
    <p>Data înregistrării ${expense.postingDay} · Factura ${esc(invoice.series)} ${esc(invoice.number)} / ${esc(invoice.issueDate)}</p>
    <p>${esc(invoice.supplierName)} · CIF ${esc(invoice.supplierTaxId)}</p>
    ${table(["Descriere", "U.M.", "Cantitate", "Valoare brută (lei)"], invoice.lines.map((line) => [esc(line.description), esc(line.invoiceUnit), esc((line.invoiceQuantity / 1000).toLocaleString("ro-RO")), lei((grossOf(line) ?? 0) * (expense.kind === "reversal" ? -1 : 1))]))}
    <p><strong>Total ${lei(expense.amount)} lei</strong></p><p>Înregistrare internă pe baza documentului furnizorului. Documentul original se anexează separat.</p>`;
}

export async function accountingReport(kind: "week" | "month", value: string) {
  const range = kind === "week" ? weekRange(value) : monthRange(value);
  const DB = env.DB!;
  const activeSources = kind === "week" ? sources.slice(0, 1) : sources;
  const sizeQueries = activeSources.map((source) => DB.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(content AS BLOB))),0) AS bytes FROM ${source.table} WHERE issue_date BETWEEN ? AND ?`).bind(range.from, range.to));
  if (kind === "month") sizeQueries.push(DB.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(content AS BLOB))),0) AS bytes FROM expense_documents WHERE posting_day BETWEEN ? AND ?").bind(range.from, range.to));
  const sizes = await DB.batch<{ count: number; bytes: number }>(sizeQueries);
  if (sizes.reduce((sum, result) => sum + result.results[0].count, 0) > MAX_DOCUMENTS || sizes.reduce((sum, result) => sum + result.results[0].bytes, 0) > MAX_CONTENT_BYTES) {
    throw new Error("ACCOUNTING_REPORT_TOO_LARGE");
  }
  const [{ company }, series, ...results] = await Promise.all([
    loadSettings(),
    DB.prepare("SELECT doc_type AS type,year,prefix FROM document_series").all<{ type: string; year: number; prefix: string }>(),
    ...activeSources.map((source) => DB.prepare(`SELECT d.id,${source.type} AS type,d.year,d.number,d.issue_date AS issueDate,d.kind,d.content,o.year AS originalYear,o.number AS originalNumber FROM ${source.table} d LEFT JOIN ${source.table} o ON o.id=d.reversal_of WHERE d.issue_date BETWEEN ? AND ? ORDER BY d.issue_date,d.year,d.number LIMIT ${MAX_DOCUMENTS + 1}`).bind(range.from, range.to).all<DocumentRow>()),
  ]);
  const documents = results.flatMap((result) => result.results);
  if (documents.length > MAX_DOCUMENTS || documents.reduce((sum, document) => sum + contentBytes(document.content), 0) > MAX_CONTENT_BYTES) throw new Error("ACCOUNTING_REPORT_TOO_LARGE");
  const prefixes = new Map(series.results.map((row) => [`${row.type}:${row.year}`, row.prefix]));
  const number = (type: DocumentType, year: number, sequence: number) => formatDocumentNumber(prefixes.get(`${type}:${year}`) ?? DOCUMENT_TYPES[type], year, sequence);
  const consumption: BcReportDocument[] = documents.filter((document) => document.type === "consumption").map((document) => ({
    id: document.id, number: number(document.type, document.year, document.number), issueDate: document.issueDate, kind: document.kind, content: JSON.parse(document.content) as BcContent,
  }));
  if (kind === "week") return response(reportPage("Centralizator BC " + range.from, company, [consumptionSection(range.from, range.to, consumption)]));

  const [expenses, supplierInvoices, cashEntries, openingCash, cashDays, zReports, closes, pendingBatches, sales, expectedDays, outgoing] = await DB.batch<Record<string, unknown>>([
    DB.prepare(`SELECT id,invoice_id AS invoiceId,posting_day AS postingDay,kind,amount,content FROM expense_documents WHERE posting_day BETWEEN ? AND ? ORDER BY posting_day,created_at LIMIT ${MAX_DOCUMENTS + 1}`).bind(range.from, range.to),
    DB.prepare("SELECT id,supplier_name AS supplierName,series,number,issue_date AS issueDate,status,purpose,total,has_file AS hasFile FROM supplier_invoices WHERE issue_date BETWEEN ? AND ? OR received_date BETWEEN ? AND ? ORDER BY issue_date,id LIMIT 1501").bind(range.from, range.to, range.from, range.to),
    DB.prepare("SELECT id,day,kind,amount,document,note,ref_id AS refId,reversal_of AS reversalOf,created_at AS createdAt FROM cash_entries WHERE day BETWEEN ? AND ? ORDER BY day,created_at LIMIT 3001").bind(range.from, range.to),
    DB.prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM cash_entries WHERE day<?").bind(range.from),
    DB.prepare("SELECT day,status FROM cash_days WHERE day BETWEEN ? AND ? ORDER BY day").bind(range.from, range.to),
    DB.prepare("SELECT day,z_number AS zNumber,total,cash,card FROM z_reports WHERE day BETWEEN ? AND ? ORDER BY day").bind(range.from, range.to),
    DB.prepare("SELECT day,content FROM production_day_closes WHERE day BETWEEN ? AND ? AND status='closed' ORDER BY day").bind(range.from, range.to),
    DB.prepare("SELECT day,code FROM production_batches WHERE day BETWEEN ? AND ? AND status='open' ORDER BY day").bind(range.from, range.to),
    DB.prepare("SELECT o.date,i.ro,SUM(i.quantity) AS quantity,SUM(i.price*i.quantity) AS amount FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.date BETWEEN ? AND ? AND o.status='confirmed' AND o.delivery='delivered' GROUP BY o.date,i.product_id,i.ro ORDER BY o.date,i.ro").bind(range.from, range.to),
    DB.prepare("SELECT DISTINCT day FROM production_batches WHERE day BETWEEN ? AND ? AND status='closed'").bind(range.from, range.to),
    DB.prepare("SELECT issue_date AS issueDate,oblio_series AS series,oblio_number AS number,oblio_link AS link,status,total FROM sales_invoices WHERE issue_date BETWEEN ? AND ? ORDER BY issue_date,created_at LIMIT 1501").bind(range.from, range.to),
  ]);
  if (expenses.results.length + documents.length > MAX_DOCUMENTS || supplierInvoices.results.length > 1500 || outgoing.results.length > 1500 || cashEntries.results.length > 3000 ||
      expenses.results.reduce((sum, row) => sum + contentBytes(String(row.content)), 0) + documents.reduce((sum, row) => sum + contentBytes(row.content), 0) > MAX_CONTENT_BYTES) throw new Error("ACCOUNTING_REPORT_TOO_LARGE");
  const supplierRows = supplierInvoices.results as { id: string; supplierName: string; series: string; number: string; issueDate: string; status: string; purpose: string; total: number | null; hasFile: number }[];
  const closeRows = closes.results as { day: string; content: string }[];
  const warnings: string[] = [];
  const drafts = supplierRows.filter((invoice) => invoice.status === "draft");
  if (drafts.length) warnings.push(`${drafts.length} facturi furnizor în ciornă.`);
  const missingFiles = supplierRows.filter((invoice) => !invoice.hasFile);
  if (missingFiles.length) warnings.push(`${missingFiles.length} facturi furnizor fără original atașat.`);
  if (pendingBatches.results.length) warnings.push(`${pendingBatches.results.length} loturi de producție deschise.`);
  const pendingOutgoing = outgoing.results.filter((row) => !["issued", "stornoed"].includes(String(row.status)));
  if (pendingOutgoing.length) warnings.push(`${pendingOutgoing.length} facturi de vânzare în așteptare sau cu eroare.`);
  const closedDates = new Set(closeRows.map((row) => row.day));
  const missingCloses = expectedDays.results.filter((row) => !closedDates.has(String(row.day)));
  if (missingCloses.length) warnings.push(`${missingCloses.length} zile de producție fără închidere de bucătărie.`);
  if (!company) warnings.push("Completați datele firmei (Setări → Datele firmei).");
  const sections: string[] = [];
  const manifest = documents.map((document) => [esc(document.issueDate), esc(documentNames[document.type]), esc(number(document.type, document.year, document.number)), document.kind === "reversal" ? "Storno" : "Emitere"]);
  sections.push(`<h1>DOSAR CONTABIL · ${esc(value)}</h1><p>Perioada ${range.from} – ${range.to} · Termen de predare ${accountingDeadline(value)}</p>
    <h2>Verificări înainte de predare</h2><ul class="warning">${warnings.map((warning) => `<li>${esc(warning)}</li>`).join("") || "<li>Verificați documentele și anexele înainte de predare.</li>"}</ul>
    <p>Include documentele interne și centralizatoarele. Originalele facturilor și rapoartele originale ale casei de marcat/POS se anexează separat.</p>
    <h2>Opis documente interne (${documents.length})</h2>${table(["Data", "Tip", "Număr", "Operațiune"], manifest)}
    <h2>Registru anexe furnizori</h2>${table(["Data facturii", "Furnizor", "Document", "Total lei", "Stare", "Original"], supplierRows.map((invoice) => [esc(invoice.issueDate), esc(invoice.supplierName), esc(invoice.series + " " + invoice.number), invoice.total === null ? "—" : lei(invoice.total), invoice.status === "draft" ? "Ciornă" : invoice.purpose === "expense" ? "Cheltuială" : "Recepționat", invoice.hasFile ? `<a href="/api/invoices/file?id=${encodeURIComponent(invoice.id)}" target="_blank" rel="noreferrer">Deschide originalul</a>` : "Lipsește"]))}
    <h2>Facturi de vânzare existente</h2>${table(["Data", "Document", "Total lei", "Stare", "Document extern"], outgoing.results.map((row) => {
      const link = invoiceLink(String(row.link));
      const status = ({ issued: "Emisă", stornoed: "Stornată", pending: "În așteptare", failed: "Eroare" } as Record<string, string>)[String(row.status)] ?? "De verificat";
      return [esc(row.issueDate), esc(`${row.series} ${row.number}`), lei(Number(row.total)), status, link ? `<a href="${esc(link)}" target="_blank" rel="noreferrer">Deschide factura</a>` : "De verificat"];
    }))}`);
  for (const week of monthWeeks(value)) {
    sections.push(consumptionSection(week.from, week.to, consumption.filter((document) => document.issueDate >= week.from && document.issueDate <= week.to)));
  }
  sections.push(`<h1>ÎNCASĂRI DIN RAPOARTELE Z</h1>${table(["Data", "Nr. Z", "Numerar lei", "Card lei", "Total lei"], zReports.results.map((row) => [esc(row.day), esc(row.zNumber), lei(Number(row.cash)), lei(Number(row.card)), lei(Number(row.total))]))}
    <h2>Livrări și predări confirmate în aplicație</h2>${table(["Data comenzii", "Produs", "Porții", "Valoare produse lei"], sales.results.map((row) => [esc(row.date), esc(row.ro), esc(row.quantity), lei(Number(row.amount))]))}`);
  for (const close of closeRows) {
    const content = JSON.parse(close.content) as { rows: DayRow[] };
    sections.push(`<h1>ÎNCHIDERE BUCĂTĂRIE · ${close.day}</h1>${table(["Produs", "Inițial", "Produs", "Alocat comenzilor", "Personal", "Donație", "Casat", "Final"], content.rows.map((row) => [esc(row.ro), esc(row.opening), esc(row.produced), esc(row.sold), esc(row.staff), esc(row.donation), esc(row.waste), esc(row.closing)]))}`);
  }
  const expenseRows = expenses.results as ExpenseRow[];
  sections.push(`<h1>CENTRALIZATOR CHELTUIELI</h1>${table(["Data înregistrării", "Furnizor", "Document", "Operațiune", "Valoare lei"], expenseRows.map((row) => {
    const invoice = JSON.parse(row.content) as Invoice;
    return [esc(row.postingDay), esc(invoice.supplierName), esc(`${invoice.series} ${invoice.number}`), row.kind === "reversal" ? "Corecție" : "Înregistrare", lei(row.amount)];
  }))}<p><strong>Total înregistrat în perioadă ${lei(expenseRows.reduce((total, row) => total + row.amount, 0))} lei</strong></p>`);
  for (const expense of expenseRows) sections.push(expenseSection(expense));
  const entries = cashEntries.results as CashEntry[];
  const days = [...new Set([...entries.map((entry) => entry.day), ...cashDays.results.map((row) => String(row.day))])].sort();
  let balance = Number(openingCash.results[0].amount);
  for (const day of days) {
    const dayEntries = entries.filter((entry) => entry.day === day);
    const totals = cashDay([{ amount: balance }], dayEntries);
    sections.push(reportDocumentBody(renderCashRegisterHtml(day, company, dayEntries, totals, cashDays.results.some((row) => row.day === day && row.status === "closed"))));
    balance = totals.closing;
  }
  for (const document of documents) {
    const title = number(document.type, document.year, document.number);
    const options = { issueDate: document.issueDate, ...(document.originalYear !== null && document.originalNumber !== null ? { reversalOf: number(document.type, document.originalYear, document.originalNumber) } : {}) };
    if (document.type === "delivery_note") sections.push(noteSection(JSON.parse(document.content) as DeliveryNoteContent, title, document.issueDate, options.reversalOf));
    else {
      let html: string;
      if (document.type === "consumption") html = renderBcHtml(JSON.parse(document.content) as BcContent, title, options);
      else if (document.type === "nir") html = renderNirHtml(JSON.parse(document.content) as NirContent, title, { ...options, company });
      else if (document.type === "handover") html = renderHandoverHtml(JSON.parse(document.content) as HandoverContent, title, options);
      else html = renderWriteOffHtml(JSON.parse(document.content) as WriteOffContent, title, options);
      sections.push(reportDocumentBody(html));
    }
  }
  return response(reportPage("Dosar contabil " + value, company, sections));
}
