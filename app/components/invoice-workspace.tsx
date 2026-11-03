"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, FileUp, PenLine, RefreshCw, ArrowLeft, Save, PackageCheck, Trash2, AlertTriangle, CheckCircle2, ExternalLink, Printer, Undo2 } from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import { today, type Language } from "@/src/modules/shared/domain";
import type { Ingredient } from "@/src/modules/inventory/domain";
import {
  INVOICE_FILE_MAX_BYTES,
  parseMoney,
  parseQuantity,
  parseVatRate,
  parseInvoiceDate,
  validTaxId,
  defaultFactor,
  baseQuantityOf,
  costOf,
  grossOf,
  prorate,
  totalsCheck,
  type CostBasis,
  type Invoice,
  type InvoiceKind,
  type InvoicesData,
} from "@/src/modules/invoices/domain";

/** Űrlapsor: a pénz- és mennyiségmezők szövegként, ahogy a felhasználó beírja (román tizedesvesszővel is). */
type FormLine = {
  id: string;
  description: string;
  quantity: string;
  invoiceUnit: string;
  lineNet: string;
  vatRate: string;
  lineGross: string;
  deposit: 0 | 1;
  skip: 0 | 1;
  ingredientId: string;
  baseQuantity: string;
  /** v72: ténylegesen átvett mennyiség (üres = a számlázott). */
  receivedQuantity: string;
  expires: string;
  batch: string;
};
type Form = {
  kind: InvoiceKind;
  supplierName: string;
  supplierTaxId: string;
  series: string;
  number: string;
  issueDate: string;
  currency: string;
  subtotal: string;
  vatTotal: string;
  sgrTotal: string;
  total: string;
  note: string;
  dueDate: string;
  lines: FormLine[];
};

const moneyText = (v: number | null) => (v === null ? "" : (v / 100).toFixed(2).replace(".", ","));
const quantityText = (v: number) => String(v / 1000).replace(".", ",");
const rateText = (v: number | null) => (v === null ? "" : String(v / 100).replace(".", ","));

function toForm(i: Invoice): Form {
  return {
    kind: i.kind,
    supplierName: i.supplierName,
    supplierTaxId: i.supplierTaxId,
    series: i.series,
    number: i.number,
    issueDate: i.issueDate,
    currency: i.currency,
    subtotal: moneyText(i.subtotal),
    vatTotal: moneyText(i.vatTotal),
    sgrTotal: moneyText(i.sgrTotal),
    total: moneyText(i.total),
    note: i.note,
    dueDate: i.dueDate ?? "",
    lines: i.lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: quantityText(l.invoiceQuantity),
      invoiceUnit: l.invoiceUnit,
      lineNet: moneyText(l.lineNet),
      vatRate: rateText(l.vatRate),
      lineGross: moneyText(l.lineGross),
      deposit: l.deposit ? 1 : 0,
      skip: l.skip ? 1 : 0,
      ingredientId: l.ingredientId ?? "",
      baseQuantity: l.baseQuantity ? String(l.baseQuantity) : "",
      receivedQuantity: l.receivedQuantity === null || l.receivedQuantity === undefined ? "" : String(l.receivedQuantity),
      expires: l.expires,
      batch: l.batch,
    })),
  };
}
const emptyLine = (): FormLine => ({ id: crypto.randomUUID(), description: "", quantity: "1", invoiceUnit: "kg", lineNet: "", vatRate: "", lineGross: "", deposit: 0, skip: 0, ingredientId: "", baseQuantity: "", receivedQuantity: "", expires: "", batch: "" });

/** Pénzmező: üres → null; érvénytelen → hiba (a mentés nem megy tovább). */
function money(value: string, field: string, required = false): number | null {
  if (!value.trim()) {
    if (required) throw new Error(field);
    return null;
  }
  const v = parseMoney(value);
  if (v === null) throw new Error(field);
  return v;
}
function toBody(id: string, revision: number, f: Form) {
  return {
    id,
    revision,
    kind: f.kind,
    supplierName: f.supplierName.trim(),
    supplierTaxId: f.supplierTaxId.trim().toUpperCase(),
    series: f.series.trim(),
    number: f.number.trim(),
    issueDate: f.issueDate,
    currency: (f.currency.trim() || "RON").toUpperCase(),
    subtotal: money(f.subtotal, "subtotal"),
    vatTotal: money(f.vatTotal, "vatTotal"),
    sgrTotal: money(f.sgrTotal, "sgrTotal") ?? 0,
    total: money(f.total, "total"),
    note: f.note.trim(),
    dueDate: f.dueDate,
    lines: f.lines.map((l) => {
      const quantity = parseQuantity(l.quantity || "0");
      const vatRate = l.vatRate.trim() ? parseVatRate(l.vatRate) : null;
      const base = l.baseQuantity.trim() ? parseQuantity(l.baseQuantity) : 0;
      if (quantity === null || quantity < 0) throw new Error("quantity");
      if (l.vatRate.trim() && vatRate === null) throw new Error("vatRate");
      if (base === null || base < 0) throw new Error("baseQuantity");
      const received = l.receivedQuantity.trim() ? parseQuantity(l.receivedQuantity) : null;
      if (l.receivedQuantity.trim() && (received === null || received < 0)) throw new Error("receivedQuantity");
      return {
        id: l.id,
        description: l.description.trim(),
        invoiceQuantity: quantity,
        invoiceUnit: l.invoiceUnit.trim(),
        lineNet: money(l.lineNet, "lineNet"),
        vatRate,
        lineGross: money(l.lineGross, "lineGross"),
        deposit: l.deposit,
        skip: l.skip,
        ingredientId: l.ingredientId || null,
        baseQuantity: Math.round(base / 1000),
        receivedQuantity: received === null ? null : Math.round(received / 1000),
        expires: l.expires,
        batch: l.batch.trim(),
      };
    }),
  };
}

/** A Számlák lap adatai a szerverről. */
async function fetchInvoices(): Promise<InvoicesData> {
  const r = await fetch("/api/invoices", { cache: "no-store" });
  const d = (await r.json()) as InvoicesData & { error?: string };
  if (!r.ok) throw new Error(d.error ?? "loadError");
  return d;
}

/** Fotó lekicsinyítése a böngészőben (olvasható marad: legfeljebb 2200 px), JPEG, a méretkorlát alá. */
async function prepareFile(file: File): Promise<string> {
  const toBase64 = async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > INVOICE_FILE_MAX_BYTES) throw new Error("INVOICE_FILE_TOO_LARGE");
    return toBase64(file);
  }
  const bitmap = await createImageBitmap(file);
  for (const side of [2200, 1800, 1400]) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.75, 0.62]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= INVOICE_FILE_MAX_BYTES) {
        bitmap.close();
        return toBase64(blob);
      }
    }
  }
  bitmap.close();
  throw new Error("INVOICE_FILE_TOO_LARGE");
}

/**
 * Beszerzés → Számlák (v65): román Factură / Bon Fiscal beolvasása AI-val (Gemini) vagy kézzel, átnézés, alapanyaghoz rendelés
 * és bevételezés a raktárba. Az AI eredményét mindig embernek kell jóváhagynia.
 */
export default function InvoiceWorkspace({ lang, ingredients, isAdmin, onReceived }: { lang: Language; ingredients: Ingredient[]; isAdmin: boolean; onReceived: () => void }) {
  const t = (k: string) => messages[lang][k] ?? k;
  const locale = lang === "hu" ? "hu-HU" : "ro-RO";
  const ron = (v: number | null) => (v === null ? "—" : new Intl.NumberFormat(locale, { style: "currency", currency: "RON" }).format(v / 100));
  const [data, setData] = useState<InvoicesData | null>(null),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [selectedId, setSelectedId] = useState(""),
    [form, setForm] = useState<Form | null>(null),
    [dirty, setDirty] = useState(false),
    [receivedDate, setReceivedDate] = useState(today()),
    [allExpires, setAllExpires] = useState(""),
    [mismatchReason, setMismatchReason] = useState(""),
    [committee, setCommittee] = useState<string | null>(null),
    [errorField, setErrorField] = useState(""),
    [retryFile, setRetryFile] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null),
    fileRef = useRef<HTMLInputElement>(null);
  const sortedIngredients = useMemo(() => [...ingredients].sort((a, b) => a[lang].localeCompare(b[lang], locale)), [ingredients, lang, locale]);

  const load = useCallback(async () => {
    try {
      const d = await fetchInvoices();
      setData(d);
      return d;
    } catch (e) {
      setError(e instanceof Error ? e.message : "loadError");
      return null;
    }
  }, []);
  useEffect(() => {
    let ignore = false;
    fetchInvoices()
      .then((d) => {
        if (!ignore) setData(d);
      })
      .catch((e: unknown) => {
        if (!ignore) setError(e instanceof Error ? e.message : "loadError");
      });
    return () => {
      ignore = true;
    };
  }, []);
  const selected = data?.invoices.find((i) => i.id === selectedId) ?? null;
  const open = (invoice: Invoice) => {
    setSelectedId(invoice.id);
    setForm(toForm(invoice));
    setDirty(false);
    setError("");
    setSuccess("");
    setReceivedDate(today());
    setAllExpires("");
    setMismatchReason("");
  };

  async function post(path: string, body: unknown) {
    const r = await fetch("/api/invoices/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = (await r.json().catch(() => ({}))) as { error?: string; id?: string; revision?: number };
    if (!r.ok) throw new Error(d.error ?? "saveError");
    return d;
  }
  async function scan(base64: string | undefined, ai: boolean) {
    setBusy(true);
    setError("");
    setSuccess("");
    setStatus(ai ? "invoiceReading" : "saving");
    try {
      const d = await post("scan", { id: crypto.randomUUID(), ...(base64 ? { data: base64 } : {}), ai });
      setRetryFile(null);
      const fresh = await load();
      const invoice = fresh?.invoices.find((i) => i.id === d.id);
      if (invoice) open(invoice);
    } catch (e) {
      const code = e instanceof Error ? e.message : "saveError";
      setError(code);
      // AI-hiba esetén ugyanazzal a fájllal kézzel is felvehető.
      if (code.startsWith("INVOICE_AI_") && base64) setRetryFile(base64);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }
  async function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      setStatus("invoicePreparing");
      const base64 = await prepareFile(file);
      await scan(base64, Boolean(data?.aiEnabled));
    } catch (e) {
      setStatus("");
      setError(e instanceof Error && e.message.startsWith("INVOICE_") ? e.message : "INVOICE_FILE_FORMAT");
    }
  }
  /** Mentés; igaz, ha sikerült (a friss változat a listában). */
  async function save(): Promise<Invoice | null> {
    if (!selected || !form) return null;
    let body;
    try {
      body = toBody(selected.id, selected.revision, form);
    } catch (e) {
      setError("INVOICE_FORM_NUMBER");
      setErrorField(e instanceof Error ? e.message : "");
      return null;
    }
    const d = await post("save", body);
    const fresh = await load();
    const invoice = fresh?.invoices.find((i) => i.id === selected.id) ?? null;
    if (invoice && d.revision !== undefined) {
      setForm(toForm(invoice));
      setDirty(false);
    }
    return invoice;
  }
  async function run(action: "save" | "receive" | "discard") {
    if (!selected || !form) return;
    if (action === "discard" && !window.confirm(t("invoiceDiscardConfirm"))) return;
    setBusy(true);
    setError("");
    setErrorField("");
    setSuccess("");
    try {
      if (action === "discard") {
        await post("discard", { id: selected.id, revision: selected.revision });
        setSelectedId("");
        setForm(null);
        await load();
        setSuccess("invoiceDiscarded");
        return;
      }
      const invoice = dirty || action === "save" ? await save() : selected;
      if (!invoice) return;
      if (action === "receive") {
        await post("receive", { id: invoice.id, revision: invoice.revision, receivedDate, mismatchReason: mismatchReason.trim() });
        const fresh = await load();
        const done = fresh?.invoices.find((i) => i.id === invoice.id);
        if (done) open(done);
        onReceived();
        setSuccess("invoiceReceivedOk");
      } else setSuccess("invoiceSaved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "saveError");
    } finally {
      setBusy(false);
    }
  }
  /** v72: NIR sztornó (admin): indoklás kell; a számla újra piszkozat lesz, a raktári tételek visszakerülnek. */
  async function reverse() {
    if (!selected) return;
    const reason = window.prompt(t("invoiceReversePrompt"))?.trim();
    if (!reason) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await post("reverse", { id: selected.id, revision: selected.revision, reason });
      const fresh = await load();
      const again = fresh?.invoices.find((i) => i.id === selected.id);
      if (again) open(again);
      onReceived();
      setSuccess("invoiceReversedOk");
    } catch (e) {
      setError(e instanceof Error ? e.message : "saveError");
    } finally {
      setBusy(false);
    }
  }
  async function saveBasis(costBasis: CostBasis, nirCommittee?: string) {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      await post("settings", { revision: data.settingsRevision, costBasis, ...(nirCommittee !== undefined ? { nirCommittee } : {}) });
      setCommittee(null);
      await load();
      setSuccess("invoiceSettingsSaved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "saveError");
    } finally {
      setBusy(false);
    }
  }

  const update = (patch: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setDirty(true);
  };
  const updateLine = (id: string, patch: Partial<FormLine>) => {
    setForm((f) => {
      if (!f) return f;
      return {
        ...f,
        lines: f.lines.map((l) => {
          if (l.id !== id) return l;
          const next = { ...l, ...patch };
          // Alapanyag választásakor, ha az átváltás egyértelmű, a raktári mennyiség magától kitöltődik.
          if (patch.ingredientId !== undefined) {
            const ingredient = ingredients.find((i) => i.id === patch.ingredientId);
            const factor = ingredient ? defaultFactor(next.invoiceUnit, ingredient) : null;
            const q = parseQuantity(next.quantity);
            if (factor && q !== null) next.baseQuantity = String(baseQuantityOf(q, factor));
          }
          return next;
        }),
      };
    });
    setDirty(true);
  };
  const lineAmounts = (l: FormLine) => ({ lineNet: parseMoney(l.lineNet), lineGross: parseMoney(l.lineGross), vatRate: l.vatRate.trim() ? parseVatRate(l.vatRate) : null });
  const unitLabel = (id: string) => t(ingredients.find((i) => i.id === id)?.unit ?? "");
  const errorText = error ? (messages[lang][error] ?? t("saveError")) : "";

  // ——— Lista ———
  if (!selected || !form)
    return (
      <div className="invoice-workspace">
        <div className="invoice-actions">
          <button type="button" className="button" disabled={busy} onClick={() => cameraRef.current?.click()}>
            <Camera size={18} />
            {t("invoicePhoto")}
          </button>
          <button type="button" className="button secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
            <FileUp size={18} />
            {t("invoiceUpload")}
          </button>
          <button type="button" className="button secondary" disabled={busy} onClick={() => void scan(undefined, false)}>
            <PenLine size={18} />
            {t("invoiceManual")}
          </button>
          <button type="button" className="text-button" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={15} />
            {t("refresh")}
          </button>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <p className="ops-note">{data && !data.aiEnabled ? t("invoiceAiDisabled") : t("invoiceIntro")}</p>
        {status && <p className="invoice-status" role="status"><RefreshCw size={16} className="spin" />{t(status)}</p>}
        {errorText && (
          <div className="portal-alert" role="alert">
            <AlertTriangle size={18} />
            <span>{errorText}</span>
            {retryFile && <button type="button" className="button secondary" disabled={busy} onClick={() => void scan(retryFile, false)}>{t("invoiceManualWithFile")}</button>}
          </div>
        )}
        {success && <p className="portal-success" role="status"><CheckCircle2 size={18} />{t(success)}</p>}
        {isAdmin && data && (
          <div className="invoice-settings">
            <label>
              {t("invoiceCostBasis")}
              <select value={data.costBasis} disabled={busy} onChange={(e) => void saveBasis(e.target.value as CostBasis)}>
                <option value="net">{t("invoiceCostNet")}</option>
                <option value="gross">{t("invoiceCostGross")}</option>
              </select>
            </label>
            <small>{t("invoiceCostBasisHint")}</small>
            <label className="invoice-committee">
              {t("invoiceCommittee")}
              <textarea value={committee ?? data.nirCommittee ?? ""} rows={3} maxLength={1000} disabled={busy} placeholder={t("invoiceCommitteeHint")} onChange={(e) => setCommittee(e.target.value)} />
            </label>
            {committee !== null && <button type="button" className="button secondary" disabled={busy} onClick={() => void saveBasis(data.costBasis, committee)}>{t("invoiceSave")}</button>}
          </div>
        )}
        {data && !data.invoices.length && <p className="quiet-empty">{t("invoiceEmpty")}</p>}
        {data && data.invoices.length > 0 && (
          <div className="table-wrap panel">
            <table>
              <thead>
                <tr>
                  <th>{t("invoiceDate")}</th>
                  <th>{t("invoiceSupplier")}</th>
                  <th>{t("invoiceNumber")}</th>
                  <th className="number">{t("invoiceTotal")}</th>
                  <th>{t("status")}</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id} className="invoice-row" onClick={() => open(i)}>
                    <td>{i.issueDate || i.createdAt.slice(0, 10)}</td>
                    <td>
                      <button type="button" className="text-button" onClick={(e) => { e.stopPropagation(); open(i); }}>
                        {i.supplierName || t("invoiceUnknownSupplier")}
                      </button>
                      <small>{t(i.kind === "bon_fiscal" ? "invoiceKindBon" : "invoiceKindFactura")}{i.source === "ai" ? " · AI" : ""}</small>
                    </td>
                    <td>{[i.series, i.number].filter(Boolean).join(" ") || "—"}{i.nirs?.some((n) => n.kind === "receipt" && n.status === "issued") && <small>{i.nirs.filter((n) => n.kind === "receipt" && n.status === "issued").map((n) => n.number).join(", ")}</small>}</td>
                    <td className="number">{ron(i.total)}</td>
                    <td><span className={"badge " + (i.status === "received" ? "delivered" : "pending")}>{t(i.status === "received" ? "invoiceStatusReceived" : "invoiceStatusDraft")}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );

  // ——— Részletek ———
  const readonly = selected.status !== "draft";
  const basis = data?.costBasis ?? "net";
  const header = { total: parseMoney(form.total), sgrTotal: parseMoney(form.sgrTotal) ?? 0 };
  const check = totalsCheck(header, form.lines.map(lineAmounts));
  const taxWarning = form.supplierTaxId.trim() && !validTaxId(form.supplierTaxId.trim().toUpperCase());
  const receivable = form.lines.filter((l) => !l.skip);
  const duplicates = (selected.duplicates ?? []).map((id) => data?.invoices.find((i) => i.id === id)).filter((i): i is Invoice => !!i);
  const nirs = selected.nirs ?? [];
  // v72: a raktárba kerülő érték az átvett mennyiségre vetítve (ha az eltér a számlázottól).
  const stockCost = (l: FormLine) => {
    const base = parseQuantity(l.baseQuantity || "0") ?? 0,
      received = l.receivedQuantity.trim() ? (parseQuantity(l.receivedQuantity) ?? base) : base;
    return prorate(costOf(lineAmounts(l), basis), base, received);
  };
  const stockValue = receivable.reduce((s, l) => s + (stockCost(l) ?? 0), 0);
  const field = (key: keyof Form, label: string, props: Record<string, unknown> = {}) => (
    <label>
      {label}
      <input value={form[key] as string} disabled={readonly || busy} onChange={(e) => update({ [key]: e.target.value } as Partial<Form>)} {...props} />
    </label>
  );
  return (
    <div className="invoice-workspace">
      <div className="invoice-actions">
        <button type="button" className="text-button" disabled={busy} onClick={() => { if (!dirty || window.confirm(t("invoiceLeaveConfirm"))) { setSelectedId(""); setForm(null); setError(""); } }}>
          <ArrowLeft size={16} />
          {t("invoiceBack")}
        </button>
        <span className={"badge " + (readonly ? "delivered" : "pending")}>{t(readonly ? "invoiceStatusReceived" : "invoiceStatusDraft")}</span>
        {selected.source === "ai" && <small className="invoice-ai-note">{t("invoiceAiCheck")}</small>}
      </div>
      {errorText && <div className="portal-alert" role="alert"><AlertTriangle size={18} /><span>{errorText}{error === "INVOICE_FORM_NUMBER" && errorField ? " (" + t("invoiceField_" + errorField) + ")" : ""}</span></div>}
      {success && <p className="portal-success" role="status"><CheckCircle2 size={18} />{t(success)}</p>}
      {!readonly && (selected.duplicates ?? []).length > 0 && (
        <div className="portal-alert" role="alert"><AlertTriangle size={18} /><span>{t("invoiceDuplicateWarning")}{duplicates.length ? ": " + duplicates.map((i) => (i.issueDate || i.createdAt.slice(0, 10)) + " · " + t(i.status === "received" ? "invoiceStatusReceived" : "invoiceStatusDraft")).join("; ") : ""}</span></div>
      )}
      {!readonly && form.currency.trim().toUpperCase() !== "RON" && <div className="portal-alert" role="alert"><AlertTriangle size={18} /><span>{t("INVOICE_CURRENCY")}</span></div>}
      {nirs.length > 0 && (
        <div className="invoice-nirs panel">
          <strong>{t("invoiceNirs")}</strong>
          {nirs.map((n) => (
            <span key={n.id} className={"invoice-nir" + (n.status === "reversed" ? " reversed" : "")}>
              <a href={"/api/invoices/nir?id=" + n.id} target="_blank" rel="noreferrer"><Printer size={14} />{n.number}</a>
              <small>{n.issueDate} · {t(n.kind === "reversal" ? "invoiceNirReversal" : n.status === "reversed" ? "invoiceNirReversed" : "invoiceNirIssued")}</small>
            </span>
          ))}
          {isAdmin && readonly && nirs.some((n) => n.kind === "receipt" && n.status === "issued") && (
            <button type="button" className="danger-button" disabled={busy} onClick={() => void reverse()}><Undo2 size={15} />{t("invoiceReverse")}</button>
          )}
        </div>
      )}
      <div className="invoice-detail">
        <div className="invoice-file panel">
          {selected.hasFile ? (
            <a href={"/api/invoices/file?id=" + selected.id} target="_blank" rel="noreferrer" className="invoice-file-link">
              {selected.fileMime?.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={"/api/invoices/file?id=" + selected.id} alt={t("invoiceFile")} />
              ) : (
                <span className="invoice-pdf"><FileUp size={28} />PDF</span>
              )}
              <span className="invoice-open"><ExternalLink size={14} />{t("invoiceOpenFile")}</span>
            </a>
          ) : (
            <p className="quiet-empty">{t("invoiceNoFile")}</p>
          )}
        </div>
        <div className="invoice-form">
          <section className="panel invoice-section">
            <h2>{t("invoiceHeader")}</h2>
            <div className="invoice-grid">
              <label>
                {t("invoiceKind")}
                <select value={form.kind} disabled={readonly || busy} onChange={(e) => update({ kind: e.target.value as InvoiceKind })}>
                  <option value="factura">{t("invoiceKindFactura")}</option>
                  <option value="bon_fiscal">{t("invoiceKindBon")}</option>
                </select>
              </label>
              {field("supplierName", t("invoiceSupplier"), { maxLength: 200 })}
              <label>
                {t("invoiceTaxId")}
                <input value={form.supplierTaxId} disabled={readonly || busy} maxLength={20} onChange={(e) => update({ supplierTaxId: e.target.value })} />
                {taxWarning && <small className="invoice-warning">{t("invoiceTaxIdInvalid")}</small>}
              </label>
              {field("series", t("invoiceSeries"), { maxLength: 40 })}
              {field("number", t("invoiceNumber"), { maxLength: 40 })}
              <label>
                {t("invoiceDate")}
                <input type="date" value={form.issueDate} disabled={readonly || busy} onChange={(e) => update({ issueDate: e.target.value })} />
              </label>
              {field("subtotal", t("invoiceSubtotal"), { inputMode: "decimal" })}
              {field("vatTotal", t("invoiceVat"), { inputMode: "decimal" })}
              {field("sgrTotal", t("invoiceSgr"), { inputMode: "decimal" })}
              {field("total", t("invoiceTotal"), { inputMode: "decimal" })}
              {field("currency", t("invoiceCurrency"), { maxLength: 3 })}
              <label>
                {t("invoiceDueDate")}
                <input type="date" value={form.dueDate} disabled={readonly || busy} onChange={(e) => update({ dueDate: e.target.value })} />
              </label>
            </div>
            {!check.ok && check.difference !== null && (
              <p className="invoice-warning"><AlertTriangle size={15} />{t("invoiceTotalsMismatch")}: {ron(check.linesTotal)} / {ron(header.total)} ({ron(check.difference)})</p>
            )}
          </section>
          <section className="panel invoice-section">
            <div className="invoice-lines-head">
              <h2>{t("invoiceLines")}</h2>
              {!readonly && (
                <label className="invoice-all-expires">
                  {t("invoiceExpiresAll")}
                  <input type="date" value={allExpires} disabled={busy} onChange={(e) => setAllExpires(e.target.value)} />
                  <button type="button" className="button secondary" disabled={busy || !parseInvoiceDate(allExpires)} onClick={() => { setForm((f) => (f ? { ...f, lines: f.lines.map((l) => (l.skip || l.expires ? l : { ...l, expires: allExpires })) } : f)); setDirty(true); }}>
                    {t("invoiceApply")}
                  </button>
                </label>
              )}
            </div>
            {form.lines.map((l, index) => {
              const amounts = lineAmounts(l);
              const cost = stockCost(l);
              const lot = selected.lines.find((s) => s.id === l.id)?.lotId;
              return (
                <div className={"invoice-line" + (l.skip ? " skipped" : "")} key={l.id}>
                  <div className="invoice-line-top">
                    <span className="invoice-line-n">{index + 1}</span>
                    <input className="invoice-line-desc" value={l.description} disabled={readonly || busy} maxLength={300} aria-label={t("invoiceDescription")} onChange={(e) => updateLine(l.id, { description: e.target.value })} />
                    <label className="invoice-skip">
                      <input type="checkbox" checked={l.skip === 1} disabled={readonly || busy} onChange={(e) => updateLine(l.id, { skip: e.target.checked ? 1 : 0 })} />
                      {t(l.deposit ? "invoiceDepositLine" : "invoiceSkip")}
                    </label>
                    {!readonly && (
                      <button type="button" className="icon-button" aria-label={t("deleteLine")} disabled={busy} onClick={() => { setForm((f) => (f ? { ...f, lines: f.lines.filter((x) => x.id !== l.id) } : f)); setDirty(true); }}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                  <div className="invoice-line-grid">
                    <label>{t("invoiceQuantity")}<input value={l.quantity} inputMode="decimal" disabled={readonly || busy} onChange={(e) => updateLine(l.id, { quantity: e.target.value })} /></label>
                    <label>{t("invoiceUnit")}<input value={l.invoiceUnit} maxLength={20} disabled={readonly || busy} onChange={(e) => updateLine(l.id, { invoiceUnit: e.target.value })} /></label>
                    <label>{t("invoiceLineNet")}<input value={l.lineNet} inputMode="decimal" disabled={readonly || busy} onChange={(e) => updateLine(l.id, { lineNet: e.target.value })} /></label>
                    <label>{t("invoiceVatRate")}<input value={l.vatRate} inputMode="decimal" disabled={readonly || busy} onChange={(e) => updateLine(l.id, { vatRate: e.target.value })} /></label>
                    <label>{t("invoiceLineGross")}<input value={l.lineGross} inputMode="decimal" placeholder={moneyText(grossOf(amounts))} disabled={readonly || busy} onChange={(e) => updateLine(l.id, { lineGross: e.target.value })} /></label>
                  </div>
                  {!l.skip && (
                    <div className="invoice-line-grid stock">
                      <label className="wide">
                        {t("invoiceIngredient")}
                        <select value={l.ingredientId} disabled={readonly || busy} onChange={(e) => updateLine(l.id, { ingredientId: e.target.value })}>
                          <option value="">—</option>
                          {sortedIngredients.map((i) => <option key={i.id} value={i.id}>{i[lang]} ({t(i.unit)})</option>)}
                        </select>
                      </label>
                      <label>{t("invoiceBaseQuantity")}{l.ingredientId ? " (" + unitLabel(l.ingredientId) + ")" : ""}<input value={l.baseQuantity} inputMode="numeric" disabled={readonly || busy} onChange={(e) => updateLine(l.id, { baseQuantity: e.target.value })} /></label>
                      <label>{t("invoiceReceivedQuantity")}<input value={l.receivedQuantity} inputMode="numeric" placeholder={l.baseQuantity} disabled={readonly || busy} onChange={(e) => updateLine(l.id, { receivedQuantity: e.target.value })} /></label>
                      <label>{t("invoiceExpires")}<input type="date" value={l.expires} disabled={readonly || busy} onChange={(e) => updateLine(l.id, { expires: e.target.value })} /></label>
                      <label>{t("invoiceBatch")}<input value={l.batch} maxLength={100} placeholder={form.series + form.number} disabled={readonly || busy} onChange={(e) => updateLine(l.id, { batch: e.target.value })} /></label>
                      <p className="invoice-cost">{t(basis === "net" ? "invoiceCostNet" : "invoiceCostGross")}: <b>{ron(cost)}</b>{lot ? " · " + t("invoiceLotCreated") : ""}</p>
                    </div>
                  )}
                </div>
              );
            })}
            {!readonly && (
              <button type="button" className="button secondary" disabled={busy || form.lines.length >= 100} onClick={() => { setForm((f) => (f ? { ...f, lines: [...f.lines, emptyLine()] } : f)); setDirty(true); }}>
                {t("invoiceAddLine")}
              </button>
            )}
          </section>
          <section className="panel invoice-section">
            <label className="invoice-note">
              {t("note")}
              <textarea value={form.note} maxLength={1000} disabled={readonly || busy} onChange={(e) => update({ note: e.target.value })} />
            </label>
            <p className="invoice-summary">
              {t("invoiceStockLines")}: <b>{receivable.length}</b> · {t(basis === "net" ? "invoiceCostNet" : "invoiceCostGross")}: <b>{ron(stockValue)}</b>
            </p>
            {readonly ? (
              <p className="ops-note">{t("invoiceReceivedOn")}: {selected.receivedDate}</p>
            ) : (
              <div className="invoice-buttons">
                {!check.ok && (
                  <label className="invoice-reason">
                    {t("invoiceMismatchReason")}
                    <input value={mismatchReason} maxLength={500} disabled={busy} placeholder={t("invoiceMismatchReasonHint")} onChange={(e) => setMismatchReason(e.target.value)} />
                  </label>
                )}
                <label>
                  {t("invoiceReceivedDate")}
                  <input type="date" value={receivedDate} max={today()} disabled={busy} onChange={(e) => setReceivedDate(e.target.value)} />
                </label>
                <button type="button" className="button secondary" disabled={busy} onClick={() => void run("save")}><Save size={17} />{t("invoiceSave")}</button>
                <button type="button" className="button" disabled={busy || !receivable.length} onClick={() => void run("receive")}><PackageCheck size={17} />{t("invoiceReceive")}</button>
                {!nirs.length && <button type="button" className="danger-button" disabled={busy} onClick={() => void run("discard")}><Trash2 size={15} />{t("invoiceDiscard")}</button>}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
