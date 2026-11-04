"use client";
import { useCallback, useEffect, useState } from "react";
import { FileText, RefreshCw, Send, Undo2, ExternalLink, Save, Eye, Wallet, PlugZap, AlertTriangle } from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import { today, type Language } from "@/src/modules/shared/domain";
import type { BillingProfile, BillingSettings, InvoiceSnapshot } from "@/src/modules/billing/domain";

const lei = (bani: number) => (bani / 100).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " lei";
const toBani = (s: string) => (/^\d{1,7}([.,]\d{1,2})?$/.test(s.trim()) ? Math.round(Number(s.trim().replace(",", ".")) * 100) : NaN);
const useT = (lang: Language) => (k: string) => (messages[lang] as Record<string, string>)[k] ?? k;
async function call<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const v = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((v as { error?: string }).error ?? "SERVER_ERROR");
  return v as T;
}

type InvoiceSummary = {
  id: string;
  kind: "order" | "monthly" | "storno";
  customerId: string;
  customerName: string;
  period: string;
  status: "pending" | "failed" | "issued" | "stornoed";
  total: number;
  issueDate: string;
  dueDate: string;
  series: string;
  number: string;
  link: string;
  spv: "none" | "processing" | "accepted" | "error";
  spvText: string;
  lastError: string;
  stornoOf: string | null;
  stornoedBy: string | null;
  orders: { id: string; code: string; date: string }[];
  notes: string[];
  paid: number;
  open: number;
  overdue: boolean;
};

/** Számla-előnézet (tételek, TVA, végösszeg). */
function SnapshotView({ s, t }: { s: InvoiceSnapshot; t: (k: string) => string }) {
  return (
    <div className="bill-preview">
      <p>
        <b>{s.buyer.name}</b> {s.buyer.cif && "· " + s.buyer.cif} · {t("billingDue")}: {s.dueDate}
      </p>
      <table className="production-table">
        <tbody>
          {s.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.name}</td>
              <td className="number">{l.quantity} ×</td>
              <td className="number">{lei(l.unitPrice)}</td>
              <td className="number">{l.vatBps / 100}%</td>
              <td className="number">{lei(l.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {s.vat.map((v) => (
            <tr key={v.bps}>
              <td colSpan={4}>
                {t("billingVat")} {v.bps / 100}%
              </td>
              <td className="number">{lei(v.vat)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={4}>
              <b>{t("billingTotal")}</b>
            </td>
            <td className="number">
              <b>{lei(s.total)}</b>
            </td>
          </tr>
        </tfoot>
      </table>
      {s.notes.length > 0 && (
        <small>
          {t("billingNotes")}: {s.notes.join(", ")}
        </small>
      )}
    </div>
  );
}

function InvoiceRow({ inv, t, busy, admin, act }: { inv: InvoiceSummary; t: (k: string) => string; busy: boolean; admin: boolean; act: (path: string, body: unknown) => Promise<boolean> }) {
  const [pay, setPay] = useState("");
  const [ref, setRef] = useState("");
  return (
    <div className={"cash-row" + (inv.overdue ? " is-overdue" : "")}>
      <div>
        <strong>
          {inv.series ? `${inv.series} ${inv.number}` : "—"} · {inv.customerName} · {t("billingKind_" + inv.kind)}
          {inv.period ? " " + inv.period : ""}
        </strong>
        <small>
          <span className={"badge " + (inv.status === "issued" ? "ready" : inv.status === "failed" ? "failed" : inv.status === "pending" ? "cooking" : "queued")}>{t("billingStatus_" + inv.status)}</span> {inv.issueDate} · {lei(inv.total)}
          {inv.kind !== "storno" && inv.status === "issued" && (
            <>
              {" "}
              · {t("billingOpen")}: <b>{lei(inv.open)}</b> · {t("billingDue")}: {inv.dueDate}
              {inv.overdue ? " · " + t("billingOverdue") : ""}
            </>
          )}
        </small>
        {(inv.status === "issued" || inv.status === "stornoed") && <small className={inv.spv === "error" ? "production-short" : ""}>{t("billingSpv_" + inv.spv)}{inv.spvText ? " – " + inv.spvText : ""}</small>}
        {inv.lastError && inv.status !== "issued" && (
          <small className="production-short">
            <AlertTriangle size={12} /> {t(inv.lastError.split(":")[0]!)} {inv.lastError.includes(":") ? inv.lastError.slice(inv.lastError.indexOf(":")) : ""}
          </small>
        )}
        <small>
          #{inv.orders.map((o) => o.code).join(", #")}
          {inv.notes.length ? " · " + inv.notes.join(", ") : ""}
        </small>
      </div>
      <div className="production-actions">
        {inv.link && (
          <a className="button secondary" href={inv.link} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> {t("billingOpenDoc")}
          </a>
        )}
        {(inv.status === "pending" || inv.status === "failed") && (
          <button className="button" disabled={busy} onClick={() => void act("send", { id: inv.id })}>
            <Send size={14} /> {t("billingRetry")}
          </button>
        )}
        {(inv.status === "issued" || inv.status === "stornoed") && inv.spv !== "accepted" && (
          <button className="button secondary" disabled={busy} onClick={() => void act("spv", { id: inv.id })}>
            <RefreshCw size={14} /> {t("billingSpvAction")}
          </button>
        )}
        {inv.status === "issued" && inv.kind !== "storno" && (
          <button className="button secondary" disabled={busy} onClick={() => void act("collect-sync", { id: inv.id })}>
            <Wallet size={14} /> {t("billingCollectSync")}
          </button>
        )}
        {admin && inv.status === "issued" && inv.kind !== "storno" && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt(t("billingStornoPrompt"));
              if (reason && reason.trim().length >= 3) void act("storno", { id: inv.id, reason: reason.trim(), clientKey: crypto.randomUUID() });
            }}
          >
            <Undo2 size={14} /> {t("billingStorno")}
          </button>
        )}
      </div>
      {inv.status === "issued" && inv.kind !== "storno" && inv.open > 0 && (
        <div className="pay-form">
          <label className="cash-field">
            {t("billingPay")}
            <input inputMode="decimal" value={pay} disabled={busy} onChange={(e) => setPay(e.target.value)} />
          </label>
          <label className="cash-field">
            {t("billingPayReference")}
            <input value={ref} disabled={busy} onChange={(e) => setRef(e.target.value)} />
          </label>
          <button
            className="button"
            disabled={busy || !(toBani(pay) > 0) || toBani(pay) > inv.open}
            onClick={async () => {
              if (await act("payment", { invoiceId: inv.id, amount: toBani(pay), reference: ref.trim() })) {
                setPay("");
                setRef("");
              }
            }}
          >
            <Save size={14} /> {t("billingPayRecord")}
          </button>
        </div>
      )}
    </div>
  );
}

type BillingView = {
  period: string;
  isAdmin: boolean;
  settings: BillingSettings;
  liveConfigured: boolean;
  cashCollectTypes: string[];
  customers: { id: string; name: string }[];
  profiles: (BillingProfile & { error: string | null })[];
  candidates: { customerId: string; name: string; orders: number; total: number; error: string | null }[];
  invoices: InvoiceSummary[];
  receivables: InvoiceSummary[];
};
const emptyProfile = (customerId: string, name: string): BillingProfile => ({ customerId, kind: "company", mode: "monthly", name, cif: "", regCom: "", address: "", city: "", county: "", country: "România", email: "", paymentDays: 15, revision: 0 });

/** Számlázás fül (v77): havi gyűjtőszámlák, számlák és SPV, nyitott vevői tartozások, ügyfél számlázási adatai, Oblio-beállítás. */
export default function BillingWorkspace({ lang }: { lang: Language }) {
  const t = useT(lang);
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [view, setView] = useState<BillingView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ customerId: string; snapshot: InvoiceSnapshot; key: string } | null>(null);
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [settings, setSettings] = useState<BillingSettings | null>(null);

  const load = useCallback((p: string) => {
    call<BillingView>("/api/billing?period=" + p).then(
      (v) => {
        setView(v);
        setSettings(v.settings);
        setError("");
      },
      (e: Error) => setError(e.message),
    );
  }, []);
  useEffect(() => {
    load(period);
  }, [period, load]);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const v = await call<{ invoice?: InvoiceSummary; companies?: string[]; series?: string[] }>("/api/billing/" + path, body);
      if (v.invoice?.lastError && v.invoice.status !== "issued") setError(v.invoice.lastError.split(":")[0]!);
      if (v.companies) setNotice(t("billingCheckOk") + ": " + v.companies.join(", ") + (v.series?.length ? " · " + v.series.join(", ") : ""));
      load(period);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function openPreview(customerId: string) {
    setBusy(true);
    setError("");
    try {
      const v = await call<{ snapshot: InvoiceSnapshot }>(`/api/billing/preview?kind=monthly&customerId=${encodeURIComponent(customerId)}&period=${period}`);
      setPreview({ customerId, snapshot: v.snapshot, key: crypto.randomUUID() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const pf = (k: keyof BillingProfile, v: string | number) => profile && setProfile({ ...profile, [k]: v });

  return (
    <div className="cash-workspace">
      <div className="production-toolbar">
        <label>
          {t("billingMonth")}
          <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
        </label>
        <button className="text-button" onClick={() => load(period)} disabled={busy}>
          <RefreshCw size={16} />
        </button>
        {view && <span className={"badge " + (view.settings.mode === "live" ? "ready" : "cooking")}>{view.settings.mode === "live" ? t("billingLive") : t("billingSimulated")}</span>}
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {t(error)}
        </div>
      )}
      {notice && (
        <p role="status" className="portal-success">
          {notice}
        </p>
      )}
      {view && (
        <>
          <section className="panel cash-section">
            <h2>
              <FileText size={18} /> {t("billingMonthly")}
            </h2>
            {!view.candidates.length && <p className="quiet-empty">{t("billingMonthlyNone")}</p>}
            {view.candidates.map((c) => (
              <div className="cash-row" key={c.customerId}>
                <div>
                  <strong>{c.name}</strong>
                  <small>
                    {c.orders} {t("billingOrders")} · {lei(c.total)}
                  </small>
                  {c.error && <small className="production-short">{t(c.error)}</small>}
                </div>
                <button className="button secondary" disabled={busy || !!c.error} onClick={() => void openPreview(c.customerId)}>
                  <Eye size={14} /> {t("billingPreview")}
                </button>
              </div>
            ))}
            {preview && (
              <div className="production-review">
                <SnapshotView s={preview.snapshot} t={t} />
                <div className="production-actions">
                  <button
                    className="button"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm(t("billingIssueConfirm"))) return;
                      if (await act("approve", { kind: "monthly", customerId: preview.customerId, period, clientKey: preview.key })) setPreview(null);
                    }}
                  >
                    <Send size={15} /> {t("billingIssue")}
                  </button>
                  <button className="button secondary" disabled={busy} onClick={() => setPreview(null)}>
                    {t("productionCancel")}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="panel cash-section">
            <h2>
              <FileText size={18} /> {t("billingInvoices")}
            </h2>
            {!view.invoices.length && <p className="quiet-empty">{t("billingInvoicesNone")}</p>}
            {view.invoices.map((inv) => (
              <InvoiceRow key={inv.id} inv={inv} t={t} busy={busy} admin={view.isAdmin} act={act} />
            ))}
          </section>

          <section className="panel cash-section">
            <h2>
              <Wallet size={18} /> {t("billingReceivables")}
            </h2>
            {!view.receivables.length && <p className="quiet-empty">{t("billingReceivablesNone")}</p>}
            {view.receivables
              .filter((r) => !view.invoices.some((i) => i.id === r.id))
              .map((inv) => (
                <InvoiceRow key={inv.id} inv={inv} t={t} busy={busy} admin={view.isAdmin} act={act} />
              ))}
          </section>

          <section className="panel cash-section">
            <h2>{t("billingProfiles")}</h2>
            <label className="cash-field">
              {t("billingProfileCustomer")}
              <select
                value={profile?.customerId ?? ""}
                onChange={(e) => {
                  const id = e.target.value;
                  const c = view.customers.find((x) => x.id === id);
                  setProfile(id ? (view.profiles.find((p) => p.customerId === id) ?? emptyProfile(id, c?.name ?? "")) : null);
                }}
              >
                <option value="">{t("billingProfileChoose")}</option>
                {view.customers.map((c) => {
                  const p = view.profiles.find((x) => x.customerId === c.id);
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {p ? " · " + t("billingMode_" + p.mode) : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            {profile && (
              <div className="bill-form">
                <label className="cash-field">
                  {t("billingProfileKind")}
                  <select value={profile.kind} onChange={(e) => pf("kind", e.target.value)}>
                    <option value="company">{t("billingKindCompany")}</option>
                    <option value="person">{t("billingKindPerson")}</option>
                  </select>
                </label>
                <label className="cash-field">
                  {t("billingProfileMode")}
                  <select value={profile.mode} onChange={(e) => pf("mode", e.target.value)}>
                    {["receipt", "per_order", "monthly"].map((m) => (
                      <option key={m} value={m}>
                        {t("billingMode_" + m)}
                      </option>
                    ))}
                  </select>
                </label>
                {(
                  [
                    ["name", "billingProfileName"],
                    ...(profile.kind === "company"
                      ? [
                          ["cif", "billingProfileCif"],
                          ["regCom", "billingProfileRegCom"],
                        ]
                      : []),
                    ["address", "billingProfileAddress"],
                    ["city", "billingProfileCity"],
                    ["county", "billingProfileCounty"],
                    ["country", "billingProfileCountry"],
                    ["email", "billingProfileEmail"],
                  ] as [keyof BillingProfile, string][]
                ).map(([k, label]) => (
                  <label className="cash-field" key={k}>
                    {t(label)}
                    <input value={String(profile[k])} onChange={(e) => pf(k, e.target.value)} />
                  </label>
                ))}
                <label className="cash-field">
                  {t("billingProfileDays")}
                  <input inputMode="numeric" value={String(profile.paymentDays)} onChange={(e) => pf("paymentDays", Math.max(0, Math.min(120, Number(e.target.value) || 0)))} />
                </label>
                <button
                  className="button"
                  disabled={busy}
                  onClick={async () => {
                    const { customerId, revision, kind, mode, name, cif, regCom, address, city, county, country, email, paymentDays } = profile;
                    if (await act("profile", { customerId, revision, kind, mode, name, cif, regCom, address, city, county, country, email, paymentDays })) setProfile(null);
                  }}
                >
                  <Save size={14} /> {t("billingProfileSave")}
                </button>
              </div>
            )}
          </section>

          {view.isAdmin && settings && (
            <details className="panel cash-section">
              <summary>
                <b>{t("billingSettings")}</b>
              </summary>
              <div className="bill-form">
                <label className="cash-field">
                  {t("billingSettingsMode")}
                  <select value={settings.mode} onChange={(e) => setSettings({ ...settings, mode: e.target.value as BillingSettings["mode"] })}>
                    <option value="simulated">{t("billingModeSimulated")}</option>
                    <option value="live">{t("billingModeLive")}</option>
                  </select>
                </label>
                <label className="cash-field">
                  {t("billingSettingsCif")}
                  <input value={settings.companyCif} onChange={(e) => setSettings({ ...settings, companyCif: e.target.value })} />
                </label>
                <label className="cash-field">
                  {t("billingSettingsSeries")}
                  <input value={settings.seriesName} onChange={(e) => setSettings({ ...settings, seriesName: e.target.value })} />
                </label>
                <label className="cash-field">
                  {t("billingSettingsStornoSeries")}
                  <input value={settings.stornoSeriesName} onChange={(e) => setSettings({ ...settings, stornoSeriesName: e.target.value })} />
                </label>
                <label className="cash-field">
                  {t("billingSettingsVatFood")}
                  <input inputMode="numeric" value={String(settings.vatFoodBps / 100)} onChange={(e) => setSettings({ ...settings, vatFoodBps: Math.round((Number(e.target.value.replace(",", ".")) || 0) * 100) })} />
                </label>
                <label className="cash-field">
                  {t("billingSettingsVatDelivery")}
                  <input inputMode="numeric" value={String(settings.vatDeliveryBps / 100)} onChange={(e) => setSettings({ ...settings, vatDeliveryBps: Math.round((Number(e.target.value.replace(",", ".")) || 0) * 100) })} />
                </label>
                <label className="cash-field">
                  {t("billingSettingsCash")}
                  <select value={settings.cashCollectType} onChange={(e) => setSettings({ ...settings, cashCollectType: e.target.value })}>
                    {view.cashCollectTypes.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cash-field">
                  {t("billingSettingsReceiptSeries")}
                  <input value={settings.receiptSeries} onChange={(e) => setSettings({ ...settings, receiptSeries: e.target.value })} />
                </label>
                <label className="production-check">
                  <input type="checkbox" checked={!!settings.autoSpv} onChange={(e) => setSettings({ ...settings, autoSpv: e.target.checked ? 1 : 0 })} />
                  {t("billingSettingsAutoSpv")}
                </label>
                {settings.mode === "live" && !view.liveConfigured && <small className="production-short">{t("billingSecretsMissing")}</small>}
                <div className="production-actions">
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      const { revision, mode, companyCif, seriesName, stornoSeriesName, vatFoodBps, vatDeliveryBps, cashCollectType, receiptSeries, autoSpv } = settings;
                      void act("settings", { revision, mode, companyCif, seriesName, stornoSeriesName, vatFoodBps, vatDeliveryBps, cashCollectType, receiptSeries, autoSpv: !!autoSpv });
                    }}
                  >
                    <Save size={14} /> {t("billingSettingsSave")}
                  </button>
                  <button className="button secondary" disabled={busy} onClick={() => void act("check", { mode: settings.mode })}>
                    <PlugZap size={14} /> {t("billingSettingsCheck")}
                  </button>
                </div>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

/** Számla a rendelés részleteinél (v77): állapot, előnézet és kiállítás „számla minden rendelésnél” módban. */
export function OrderInvoicePanel({ lang, orderId, onSaved }: { lang: Language; orderId: string; onSaved: () => void }) {
  const t = useT(lang);
  const [data, setData] = useState<{ mode: string; profileError: string | null; invoice: InvoiceSummary | null } | null>(null);
  const [preview, setPreview] = useState<{ snapshot: InvoiceSnapshot; key: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    call<NonNullable<typeof data>>("/api/billing/order?id=" + encodeURIComponent(orderId)).then(setData, (e: Error) => setError(e.message));
  }, [orderId]);
  useEffect(() => {
    load();
  }, [load]);
  if (!data) return error ? <p className="portal-alert">{t(error)}</p> : null;
  const inv = data.invoice;
  return (
    <section className="pay-panel">
      <div className="pay-head">
        <strong>
          <FileText size={16} /> {t("billingOrderPanel")}
        </strong>
        {inv && <span className={"badge " + (inv.status === "issued" ? "ready" : inv.status === "failed" ? "failed" : "cooking")}>{t("billingStatus_" + inv.status)}</span>}
      </div>
      {inv ? (
        <p className="pay-sums">
          {inv.series ? `${inv.series} ${inv.number}` : "—"} · {lei(inv.total)} · {t("billingSpv_" + inv.spv)}{" "}
          {inv.link && (
            <a href={inv.link} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> {t("billingOpenDoc")}
            </a>
          )}
        </p>
      ) : data.mode === "receipt" ? (
        <small>{t("billingOrderReceipt")}</small>
      ) : data.mode === "monthly" ? (
        <small>{t("billingOrderMonthly")}</small>
      ) : data.profileError ? (
        <small className="production-short">{t(data.profileError)}</small>
      ) : (
        <>
          <small>{t("billingOrderNone")}</small>
          {preview ? (
            <>
              <SnapshotView s={preview.snapshot} t={t} />
              <div className="production-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm(t("billingIssueConfirm"))) return;
                    setBusy(true);
                    setError("");
                    try {
                      const v = await call<{ invoice: InvoiceSummary }>("/api/billing/approve", { kind: "order", orderId, clientKey: preview.key });
                      if (v.invoice.lastError && v.invoice.status !== "issued") setError(v.invoice.lastError.split(":")[0]!);
                      setPreview(null);
                      load();
                      onSaved();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Send size={14} /> {t("billingIssue")}
                </button>
                <button className="button secondary" disabled={busy} onClick={() => setPreview(null)}>
                  {t("productionCancel")}
                </button>
              </div>
            </>
          ) : (
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                setError("");
                try {
                  const v = await call<{ snapshot: InvoiceSnapshot }>("/api/billing/preview?kind=order&orderId=" + encodeURIComponent(orderId));
                  setPreview({ snapshot: v.snapshot, key: crypto.randomUUID() });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Eye size={14} /> {t("billingPreview")}
            </button>
          )}
        </>
      )}
      {error && <p className="portal-alert">{t(error)}</p>}
    </section>
  );
}
