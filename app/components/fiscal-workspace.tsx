"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { messages } from "@/src/modules/shared/i18n";
import { today, orderCode, type Language } from "@/src/modules/shared/domain";
import WorkspaceDetails from "./workspace-details";
import type { FiscalReceipt, FiscalOrderView, FiscalDayView, FiscalSettings } from "@/src/modules/fiscal/domain";

const money = (bani: number) => (bani / 100).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " lei";
async function call<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/fiscal/" + url, body === undefined ? { cache: "no-store", signal } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "SERVER_ERROR");
  return data as T;
}

export function OrderFiscalPanel({ lang, orderId, admin, onSaved, onEvidence, compact = false }:  { lang: Language; orderId: string; admin: boolean; compact?: boolean; onSaved: () => void; onEvidence?: (orderId: string, evidence: { deferred: boolean; issued: boolean; uncertain: boolean }) => void }) {
  const t = (key: string) => messages[lang][key] ?? key;
  const [view, setView] = useState<FiscalOrderView | null>(null), [method, setMethod] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [report, setReport] = useState<{ jobId: string; status: string; receiptNumber: string; deviceSerial: string; totalBani: number } | null>(null);
  const [refresh, setRefresh] = useState(0), requestId = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void call<FiscalOrderView>("order?id=" + encodeURIComponent(orderId), undefined, controller.signal).then((data) => { if (!controller.signal.aborted) { setView(data); setMethod(data.expectedPaymentMethod); onEvidence?.(orderId, { deferred: data.collectionDeferred, issued: data.receipts.some(r => r.mode === "live" && r.state === "issued"), uncertain: data.receipts.some(r => r.state === "uncertain") }); } }).catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [orderId, refresh, onEvidence]);
  async function post(path: string, data: unknown) {
    setBusy(true); setError("");
    try { await call(path, data); setRefresh((n) => n + 1); onSaved(); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  async function prepare() {
    if (!view) return;
    requestId.current ??= crypto.randomUUID();
    if (await post("prepare", { id: requestId.current, orderId, revision: view.revision, settingsRevision: view.settings.revision })) requestId.current = null;
  }
  const actionable = view?.receipts.filter((receipt) => ["prepared", "uncertain"].includes(receipt.state)) ?? [];
  const history = view?.receipts.filter((receipt) => !["prepared", "uncertain"].includes(receipt.state)) ?? [];
  const needsAttention = actionable.some((receipt) => receipt.mode === "live" || receipt.state === "uncertain");
  const attentionReceipt = actionable.find((receipt) => receipt.state === "uncertain") ?? actionable.find((receipt) => receipt.mode === "live");
  const receiptCard = (receipt: FiscalReceipt) => (<article key={receipt.id} className="fiscal-receipt">
        <strong>{t("fiscal_state_" + receipt.state)}</strong> · {receipt.day} · {t("payMethod_" + receipt.method)} · {money(receipt.total)}
        <p>{receipt.mode === "simulation" ? t("fiscalSimulation") : receipt.deviceSerial} {receipt.receiptNumber && " · #" + receipt.receiptNumber}</p>
        {receipt.resolution && <p>{receipt.resolution}</p>}
        {admin && receipt.mode === "live" && ["issued", "not_issued"].includes(receipt.state) && receipt.resolution.length >= 10 && <a className="button secondary" href={"/api/fiscal/resolution?id=" + receipt.id} download>{t("fiscalResolutionDownload")}</a>}
        {!view?.collectionDeferred && receipt.state === "prepared" && receipt.mode === "live" && receipt.day === today() && Date.parse(receipt.expiresAt) > Date.now() && <a className="button secondary" href={"/api/fiscal/job?id=" + receipt.id} download>{t("fiscalDownload")}</a>}
        {receipt.mode === "simulation" && receipt.state === "prepared" && <div className="pay-form">
          <button className="button secondary" disabled={busy} onClick={() => void post("simulate", { id: receipt.id, revision: receipt.revision, outcome: "issued" })}>{t("fiscalSimulateOk")}</button>
          <button className="button secondary" disabled={busy} onClick={() => void post("simulate", { id: receipt.id, revision: receipt.revision, outcome: "uncertain" })}>{t("fiscalSimulateLost")}</button>
        </div>}
        {admin && ["prepared", "uncertain"].includes(receipt.state) && <ReceiptResolution key={receipt.id + ":" + receipt.revision} receipt={receipt} lang={lang} busy={busy} submit={(body) => post("resolve", body)} />}
      </article>);
  const locked = view?.receipts.some((receipt) => receipt.mode === "live" && receipt.state !== "not_issued");
  if (view?.collectionDeferred && view.receipts.length === 0) return compact ? <p className="compact-billing"><strong>{t("compactMonthly")}</strong></p> : null;
  const prepared = view?.receipts.find(r => r.mode === "live" && r.state === "prepared" && r.day === today() && Date.parse(r.expiresAt) > Date.now());
  const issued = view?.receipts.find(r => r.mode === "live" && r.state === "issued");
  return <section className={"pay-panel fiscal-panel" + (compact ? " compact-fiscal" : "")}>
    {compact && view && !view.collectionDeferred && <div className="compact-fiscal-main">
      <p>{t("expectedPaymentMethod")}: <strong>{t(view.expectedPaymentMethod ? "payMethod_" + view.expectedPaymentMethod : "fiscalUnknownMethod")}</strong></p>
      {issued ? <strong>✓ {t("fiscal_state_issued")} · #{issued.receiptNumber}</strong> : prepared ? <a className="button" href={"/api/fiscal/job?id=" + prepared.id} download>{t("fiscalDownload")}</a> : <button className="button" disabled={busy || locked || !view.expectedPaymentMethod} onClick={() => void prepare()}>{t(view.settings.mode === "simulation" ? "fiscalPrepareTest" : "fiscalPrepare")}</button>}
    </div>}

    {actionable.some((receipt) => receipt.state === "uncertain") && <p role="alert" className="portal-alert">{t("fiscal_state_uncertain")}</p>}
    <WorkspaceDetails title={t("simpleReceipt")} hint={view ? (attentionReceipt ? t("fiscal_state_" + attentionReceipt.state) : view.settings.mode === "simulation" ? t("simpleReceiptTest") : view.receipts.length ? t("fiscal_state_" + view.receipts[0].state) : t("simpleReceiptNone")) : t("loading")} attention={(compact ? actionable.some(r => r.state === "uncertain") : needsAttention) || !!error || !!report}>
    {error && <p role="alert" className="portal-alert">{t(error)} <button className="text-button" onClick={() => { setError(""); setRefresh((n) => n + 1); }}>{t("refresh")}</button></p>}
    {!view ? <p>{t("loading")}</p> : <>
      {view.collectionDeferred ? <p>{t("PAYMENT_MONTHLY_INVOICE")}</p> : <>
      <div className="pay-form"><label className="cash-field">{t("expectedPaymentMethod")}<select value={method} disabled={busy || locked} onChange={(e) => setMethod(e.target.value)}>
        <option value="">{t("fiscalUnknownMethod")}</option><option value="cash">{t("payMethod_cash")}</option><option value="card">{t("payMethod_card")}</option>
      </select></label>{method !== view.expectedPaymentMethod && <button className="button secondary" disabled={busy || locked} onClick={() => void post("method", { orderId, revision: view.revision, method })}>{t("fiscalSaveMethod")}</button>}</div>
      <p>{t("fiscalMethodHint")}</p>
      <p><strong>{t(view.settings.mode === "simulation" ? "fiscalSimulation" : "fiscalLive")}</strong> {view.settings.deviceSerial}</p>
      {!compact && <button className="button" disabled={busy || locked || !view.expectedPaymentMethod || method !== view.expectedPaymentMethod} onClick={() => void prepare()}>{t(view.settings.mode === "simulation" ? "fiscalPrepareTest" : "fiscalPrepare")}</button>}
      </>}

      {actionable.map(receiptCard)}
      {!!history.length && <details className="simple-history"><summary>{t("simpleReceiptHistory")} ({history.length})</summary>{history.map(receiptCard)}</details>}
      <details className="simple-history" open={actionable.some((receipt) => receipt.mode === "live") || !!report || undefined}><summary>{t("simpleReceiptImport")}</summary>
      <label className="cash-field">{t("fiscalImport")}<input type="file" accept=".gastroresult,application/json" disabled={busy} onChange={(e) => {
        const file = e.target.files?.[0]; e.target.value = ""; setReport(null); if (!file) return;
        if (file.size > 12000) { setError("fiscalFileError"); return; }
        void file.text().then((raw) => { const value = JSON.parse(raw); if (!value || value.version !== 2 || !view.receipts.some((row) => row.id === value.jobId) || !["issued", "uncertain"].includes(value.status)) throw new Error("fiscalFileError"); setError(""); setReport(value); }).catch(() => setError("fiscalFileError"));
      }} /></label>
      <small>{t("fiscalImportHint")}</small>
      {report && <div className="fiscal-receipt"><p>{report.deviceSerial} · #{report.receiptNumber || "—"} · {money(report.totalBani)} · {t("fiscal_state_" + report.status)}</p><button className="button" disabled={busy} onClick={async () => { const receipt = view.receipts.find((row) => row.id === report.jobId); if (receipt && await post("result", { id: receipt.id, revision: receipt.revision, outcome: report.status, report })) setReport(null); }}>{t("fiscalApproveImport")}</button></div>}
      </details>
    </>}
    </WorkspaceDetails>
  </section>;
}

function ReceiptResolution({ receipt, lang, busy, submit }: { receipt: FiscalReceipt; lang: Language; busy: boolean; submit: (body: unknown) => Promise<boolean> }) {
  const t = (key: string) => messages[lang][key] ?? key;
  const [outcome, setOutcome] = useState("uncertain"), [reason, setReason] = useState(""), [number, setNumber] = useState(""), [counter, setCounter] = useState("");
  return <details><summary>{t("fiscalResolve")}</summary><p>{t("fiscalResolutionHint")}</p><div className="pay-form">
    <label className="cash-field">{t("fiscalOutcome")}<select value={outcome} disabled={busy} onChange={(e) => setOutcome(e.target.value)}>{["uncertain", "issued", "not_issued"].map((state) => <option key={state} value={state}>{t("fiscal_state_" + state)}</option>)}</select></label>
    {outcome === "issued" && receipt.mode === "live" && <><label className="cash-field">{t("fiscalReceiptNumber")}<input value={number} maxLength={4} inputMode="numeric" onChange={(e) => setNumber(e.target.value)} /></label><label className="cash-field">{t("fiscalCounter")}<input value={counter} maxLength={7} inputMode="numeric" onChange={(e) => setCounter(e.target.value)} /></label></>}
    <label className="cash-field fiscal-reason">{t("fiscalReason")}<textarea value={reason} maxLength={1000} disabled={busy} onChange={(e) => setReason(e.target.value)} /></label>
    <button className="button secondary" disabled={busy || reason.trim().length < 10} onClick={() => void submit({ id: receipt.id, revision: receipt.revision, outcome, reason, receiptNumber: number, ...(counter ? { receiptCounter: Number(counter) } : {}) })}>{t("fiscalResolveSave")}</button>
  </div></details>;
}

export function FiscalDayPanel({ lang, date }: { lang: Language; date: string }) {
  const t = (key: string) => messages[lang][key] ?? key;
  const [view, setView] = useState<FiscalDayView | null>(null), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController(); setView(null);
    void call<FiscalDayView>("day?date=" + date, undefined, controller.signal).then((data) => { if (!controller.signal.aborted) { setView(data); setError(""); } }).catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [date, refresh]);
  const hasDifference = !!view?.z && (view.totals.cash !== view.z.cash || view.totals.card !== view.z.card || view.totals.total !== view.z.total);
  return <section className="panel cash-section fiscal-panel">
    {error && <p role="alert">{t(error)} <button className="text-button" onClick={reload}>{t("refresh")}</button></p>}
    {view?.unresolved.map((receipt) => <p key={receipt.id} role="alert" className="portal-alert">{t("fiscalUnresolved")}: {t("simplePendingOrder")} #{orderCode(receipt.orderId)} · {receipt.day} · {t("fiscal_state_" + receipt.state)}</p>)}
    <WorkspaceDetails title={t("simpleReceiptCompare")} hint={view ? t("fiscalIssuedCount") + ": " + view.totals.count + " · " + money(view.totals.total) : t("loading")} attention={hasDifference || !!view?.unresolved.length}>
    <p>{date}</p>
    <button className="text-button" onClick={reload}>{t("refresh")}</button>
    {view && <>
      <p>{t("fiscalCash")}: {money(view.totals.cash)} · {t("fiscalCard")}: {money(view.totals.card)} · {t("fiscalTotal")}: {money(view.totals.total)}</p>
      {view.z ? <p className={hasDifference ? "portal-alert" : "ops-note"}>{t("fiscalZDifference")} · {t("fiscalCash")}: <b>{money(view.totals.cash - view.z.cash)}</b> · {t("fiscalCard")}: <b>{money(view.totals.card - view.z.card)}</b> · {t("fiscalTotal")}: <b>{money(view.totals.total - view.z.total)}</b></p> : <p>{t("fiscalNoZ")}</p>}
      <p>{t("fiscalDayHint")}</p><p>{t("fiscalTestCount")}: {view.simulations}</p>
      {view.isAdmin && <FiscalSettingsEditor key={view.settings.revision} settings={view.settings} lang={lang} onSaved={reload} />}
    </>}
    </WorkspaceDetails>
  </section>;
}

function FiscalSettingsEditor({ settings, lang, onSaved }: { settings: FiscalSettings; lang: Language; onSaved: () => void }) {
  const t = (key: string) => messages[lang][key] ?? key;
  const [mode, setMode] = useState(settings.mode), [serial, setSerial] = useState(settings.deviceSerial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault(); if (mode === "live" && !window.confirm(t("fiscalLiveConfirm"))) return;
    setBusy(true); setError("");
    try { await call("settings", { revision: settings.revision, mode, deviceSerial: serial }); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <details><summary>{t("fiscalSettings")}</summary><p>{t("fiscalSettingsHint")}</p><form className="pay-form" onSubmit={(e) => void save(e)}>
    <label className="cash-field">{t("fiscalMode")}<select value={mode} disabled={busy} onChange={(e) => setMode(e.target.value as FiscalSettings["mode"])}><option value="simulation">{t("fiscalModeTest")}</option><option value="live">{t("fiscalModeLive")}</option></select></label>
    <label className="cash-field">{t("fiscalSerial")}<input value={serial} disabled={busy} required={mode === "live"} pattern="[A-Za-z0-9]{4,20}" maxLength={20} onChange={(e) => setSerial(e.target.value)} /></label>
    <button className="button secondary" disabled={busy}>{t("fiscalSettingsSave")}</button>
    {error && <p role="alert">{t(error)}</p>}
  </form></details>;
}
