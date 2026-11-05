"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Wallet, Printer, Undo2, Lock, Save, AlertTriangle, RefreshCw, HandCoins } from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import { today, type Language } from "@/src/modules/shared/domain";
import type { CashEntry, Payment, PaymentStatus } from "@/src/modules/finance/domain";
import { readTremolZ, TremolZImportError } from "@/src/modules/finance/tremol-z";
import { FiscalDayPanel } from "./fiscal-workspace";
import WorkspaceDetails from "./workspace-details";

const lei = (bani: number) => (bani / 100).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " lei";
const toBani = (s: string) => (/^\d{1,7}([.,]\d{1,2})?$/.test(s.trim()) ? Math.round(Number(s.trim().replace(",", ".")) * 100) : NaN);
const fromBani = (b: number) => (b / 100).toFixed(2).replace(".", ",");

function useT(lang: Language) {
  return (k: string) => (messages[lang] as Record<string, string>)[k] ?? k;
}
async function call<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const v = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((v as { error?: string }).error ?? "SERVER_ERROR");
  return v as T;
}

/** Fizetés a rendelés részleteinél (v76): egyenleg, befizetések, új befizetés, sztornó. */
export function OrderPaymentPanel({ lang, orderId, canEdit, expectedMethod, onSaved, onCollectionLoaded }: { lang: Language; orderId: string; canEdit: boolean; expectedMethod?: string; onSaved: () => void; onCollectionLoaded?: (orderId: string, deferred: boolean) => void }) {
  const t = useT(lang);
  const [data, setData] = useState<{ collectionDeferred: boolean; total: number; revision: number; balance: { paid: number; due: number; status: PaymentStatus }; payments: Payment[] } | null>(null);
  const [method, setMethod] = useState<"cash" | "card">(expectedMethod === "card" ? "card" : "cash");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    call<NonNullable<typeof data>>("/api/finance/order?id=" + encodeURIComponent(orderId)).then(
      (v) => {
        setData(v);
        onCollectionLoaded?.(orderId, v.collectionDeferred);
        setAmount(fromBani(v.balance.due));
      },
      (e: Error) => setError(e.message),
    );
  }, [orderId, onCollectionLoaded]);
  useEffect(() => {
    load();
  }, [load]);
  async function post(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await call(path, body);
      load();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data) return error ? <p className="portal-alert">{t(error)}</p> : null;
  if (data.collectionDeferred && data.payments.length === 0) return null;
  const legacy = data.balance.status === "paid" && data.payments.length === 0;
  return (
    <section className="pay-panel">
      <div className="pay-head">
        <strong>
          <Wallet size={16} /> {t(data.collectionDeferred ? "simplePaymentHistory" : "payTitle")}
        </strong>
        <span className={"badge " + (data.balance.status === "paid" ? "ready" : data.balance.status === "partial" ? "cooking" : "queued")}>{t("payStatus_" + data.balance.status)}</span>
      </div>
      <p className="pay-sums">
        {t("payTotal")}: <b>{lei(data.total)}</b> · {t("payPaid")}: <b>{lei(data.balance.paid)}</b> · {t("payDue")}: <b>{lei(data.balance.due)}</b>
      </p>
      {data.collectionDeferred && <p className="pay-sums">{t("PAYMENT_MONTHLY_INVOICE")}</p>}
      {legacy && <small>{t("payLegacy")}</small>}
      {data.payments.length > 0 && (
        <details className="simple-history"><summary>{t("simplePaymentHistory")} ({data.payments.length})</summary><ul className="pay-list">
          {data.payments.map((p) => (
            <li key={p.id} className={p.reversedBy || p.reversalOf ? "is-reversed" : ""}>
              <span>
                {p.day} · {t("payMethod_" + p.method)} · {t(p.collectedBy === "courier" ? "payCourier" : "payOffice")} {p.collectorName}
                {p.note ? " · " + p.note : ""}
              </span>
              <b>{lei(p.amount)}</b>
              {canEdit && !p.reversedBy && !p.reversalOf && (
                <button
                  className="text-button"
                  disabled={busy}
                  title={t("payReverse")}
                  onClick={() => {
                    const reason = window.prompt(t("payReversePrompt"));
                    if (reason && reason.trim().length >= 3) void post("/api/finance/payment/reverse", { paymentId: p.id, reason: reason.trim() });
                  }}
                >
                  <Undo2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul></details>
      )}
      {canEdit && !data.collectionDeferred && data.balance.due > 0 && (
        <div className="pay-form simple-pay-fields">
          <label>{t("simpleMethod")}<select value={method} disabled={busy} onChange={(e) => setMethod(e.target.value as "cash" | "card")}>
            <option value="cash">{t("payMethod_cash")}</option>
            <option value="card">{t("payMethod_card")}</option>
          </select></label>
          <label>{t("payAmount")}<input inputMode="decimal" aria-label={t("payAmount")} value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} /></label>
          <button
            className="button"
            disabled={busy || !(toBani(amount) > 0)}
            onClick={() => void post("/api/finance/payment", { orderId, revision: data.revision, method, amount: toBani(amount), note: "" })}
          >
            <Save size={15} /> {t("payRecord")}
          </button>
        </div>
      )}
      {error && <p className="portal-alert">{t(error)}</p>}
    </section>
  );
}

type DayView = {
  date: string;
  isAdmin: boolean;
  cash: { entries: CashEntry[]; totals: { opening: number; income: number; expense: number; closing: number }; status: "open" | "closed"; revision: number; closedAt: string | null };
  couriers: { courierUserId: string; courierName: string; expected: number; count: number }[];
  handovers: { id: string; courierName: string; expected: number; counted: number; note: string; createdAt: string }[];
  z: { zNumber: string; total: number; cash: number; card: number; note: string; revision: number } | null;
  reconcile: { system: { cash: number; card: number; total: number }; diff: { cash: number; card: number; total: number; zSplit: number } | null };
  suppliers: {
    id: string;
    supplierName: string;
    series: string;
    number: string;
    issueDate: string;
    dueDate: string;
    total: number;
    paid: number;
    open: number;
    overdue: boolean;
    payments: { id: string; day: string; method: "cash" | "bank"; amount: number; reversalOf: string | null; reversedBy: string | null }[];
  }[];
};

/** Pénztár fül (v76): futárok készpénze, pénztárkönyv, Z-jelentés, beszállítói kifizetések. */
export default function CashWorkspace({ lang, initialDay }: { lang: Language; initialDay: string }) {
  const t = useT(lang);
  const [date, setDate] = useState(initialDay);
  const [view, setView] = useState<DayView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [handoverNote, setHandoverNote] = useState<Record<string, string>>({});
  const [entry, setEntry] = useState({ kind: "other_out", amount: "", document: "", note: "" });
  const [z, setZ] = useState({ zNumber: "", total: "", cash: "", card: "", note: "" });
  const [zImportMessage, setZImportMessage] = useState<{ key: string; error: boolean; date?: string }>();
  const [supPay, setSupPay] = useState<Record<string, { amount: string; method: "cash" | "bank" }>>({});
  const loadSequence = useRef(0);

  const load = useCallback((d: string) => {
    const sequence = ++loadSequence.current;
    setView(null);
    setZImportMessage(undefined);
    call<DayView>("/api/finance/day?date=" + d).then(
      (v) => {
        if (sequence !== loadSequence.current) return;
        setView(v);
        setError("");
        setCounted(Object.fromEntries(v.couriers.map((c) => [c.courierUserId, fromBani(c.expected)])));
        setZ(v.z ? { zNumber: v.z.zNumber, total: fromBani(v.z.total), cash: fromBani(v.z.cash), card: fromBani(v.z.card), note: v.z.note } : { zNumber: "", total: "", cash: "", card: "", note: "" });
        setSupPay({});
      },
      (e: Error) => {
        if (sequence === loadSequence.current) setError(e.message);
      },
    );
  }, []);
  useEffect(() => {
    load(date);
  }, [date, load]);
  async function post(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await call("/api/finance/" + path, body);
      load(date);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function importZ(file: File) {
    if (busy || view?.date !== date || date > today()) return;
    setBusy(true);
    setZImportMessage(undefined);
    try {
      const report = await readTremolZ(file);
      if (report.date !== date) {
        setZImportMessage({ key: "zImportDate", error: true, date: report.date });
        return;
      }
      const savedNumber = view.z?.zNumber;
      if (savedNumber && savedNumber.replace(/^0+(?=\d)/, "") !== report.zNumber.replace(/^0+(?=\d)/, "")) {
        setZImportMessage({ key: "zImportExisting", error: true });
        return;
      }
      setZ((draft) => ({ ...draft, zNumber: report.zNumber, total: fromBani(report.total), cash: fromBani(report.cash), card: fromBani(report.card) }));
      setZImportMessage({ key: "zImportReview", error: false });
    } catch (e) {
      setZImportMessage({ key: e instanceof TremolZImportError ? e.code : "zImportInvalid", error: true });
    } finally {
      setBusy(false);
    }
  }
  const isToday = date === today();
  const open = view?.cash.status === "open";
  const canAdd = isToday && open;
  const diffClass = (v: number) => (v === 0 ? "" : " cash-diff");

  return (
    <div className="cash-workspace">
      <div className="production-toolbar">
        <label>
          {t("simpleCashDate")}
          <input type="date" value={date} disabled={busy} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <button className="text-button" onClick={() => load(date)} disabled={busy}>
          <RefreshCw size={16} />
        </button>
        <a className="button secondary" href={"/api/finance/register?date=" + date} target="_blank" rel="noreferrer">
          <Printer size={16} /> {t("cashPrint")}
        </a>
        {view?.cash.status === "closed" && (
          <span className="badge ready">
            <Lock size={13} /> {t("cashDayClosed")}
          </span>
        )}
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {t(error)}
        </div>
      )}
      {view?.date === date && (
        <>


          <section className="panel cash-section">
            <h2>
              <Wallet size={18} /> {t("cashRegister")}
            </h2>
            <div className="cash-totals">
              <span>
                {t("cashOpening")} <b>{lei(view.cash.totals.opening)}</b>
              </span>
              <span>
                {t("cashIncome")} <b>{lei(view.cash.totals.income)}</b>
              </span>
              <span>
                {t("cashExpense")} <b>{lei(view.cash.totals.expense)}</b>
              </span>
              <span>
                {t("cashClosing")} <b>{lei(view.cash.totals.closing)}</b>
              </span>
            </div>
            {!view.cash.entries.length ? (
              <p className="quiet-empty">{t("cashEntriesNone")}</p>
            ) : (
              <ul className="pay-list">
                {view.cash.entries.map((e, i) => (
                  <li key={e.id}>
                    <span>
                      {i + 1}. {t("cashKind_" + e.kind)}
                      {e.document ? " · " + e.document : ""}
                      {e.note ? " · " + e.note : ""}
                    </span>
                    <b className={e.amount < 0 ? "cash-out" : ""}>{lei(e.amount)}</b>
                    {canAdd && ["deposit", "bank_deposit", "other_in", "other_out"].includes(e.kind) && !view.cash.entries.some((x) => x.reversalOf === e.id) && (
                      <button
                        className="text-button"
                        disabled={busy}
                        title={t("payReverse")}
                        onClick={() => {
                          const reason = window.prompt(t("cashReversePrompt"));
                          if (reason && reason.trim().length >= 3) void post("cash/reverse", { entryId: e.id, reason: reason.trim() });
                        }}
                      >
                        <Undo2 size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canAdd ? (
              <WorkspaceDetails title={t("simpleCashMovement")} hint={t("simpleCashMovementHint")}><div className="pay-form">
                <select value={entry.kind} disabled={busy} onChange={(e) => setEntry({ ...entry, kind: e.target.value })}>
                  {["deposit", "other_in", "bank_deposit", "other_out"].map((k) => (
                    <option key={k} value={k}>
                      {t("cashKind_" + k)}
                    </option>
                  ))}
                </select>
                <input inputMode="decimal" placeholder={t("payAmount")} value={entry.amount} disabled={busy} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} />
                <input placeholder={t("cashDocument")} value={entry.document} disabled={busy} onChange={(e) => setEntry({ ...entry, document: e.target.value })} />
                <input placeholder={t("payNote")} value={entry.note} disabled={busy} onChange={(e) => setEntry({ ...entry, note: e.target.value })} />
                <button
                  className="button"
                  disabled={busy || !(toBani(entry.amount) > 0) || !entry.note.trim()}
                  onClick={async () => {
                    if (await post("cash", { kind: entry.kind, amount: toBani(entry.amount), document: entry.document.trim(), note: entry.note.trim() })) setEntry({ ...entry, amount: "", document: "", note: "" });
                  }}
                >
                  <Save size={15} /> {t("cashAdd")}
                </button>
              </div></WorkspaceDetails>
            ) : (
              open && <small>{t("cashTodayOnly")}</small>
            )}
            <div className="production-footer">
              <span />
              {open && date <= today() && (
                <button className="button secondary" disabled={busy} onClick={() => window.confirm(t("cashCloseConfirm")) && void post("day/close", { date, revision: view.cash.revision })}>
                  <Lock size={15} /> {t("cashCloseDay")}
                </button>
              )}
              {!open && view.isAdmin && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt(t("cashReopenPrompt"));
                    if (reason && reason.trim().length >= 3) void post("day/reopen", { date, revision: view.cash.revision, reason: reason.trim() });
                  }}
                >
                  <Undo2 size={15} /> {t("cashReopen")}
                </button>
              )}
            </div>
          </section>

          <WorkspaceDetails title={t("cashCouriers")} hint={view.couriers.length ? view.couriers.length + " · " + lei(view.couriers.reduce((sum, row) => sum + row.expected, 0)) : t("simpleNoCourierCash")} attention={view.couriers.length > 0}>
            {!view.couriers.length && <p className="quiet-empty">{t("cashCouriersNone")}</p>}
            {view.couriers.map((c) => {
              const c2 = toBani(counted[c.courierUserId] ?? "");
              return (
                <div className="cash-row" key={c.courierUserId}>
                  <div>
                    <strong>{c.courierName || "—"}</strong>
                    <small>
                      {t("cashExpected")}: {lei(c.expected)} ({c.count})
                    </small>
                  </div>
                  <input className="production-num" inputMode="decimal" aria-label={t("cashCounted")} value={counted[c.courierUserId] ?? ""} disabled={busy || !canAdd} onChange={(e) => setCounted({ ...counted, [c.courierUserId]: e.target.value })} />
                  {c2 !== c.expected && (
                    <input className="cash-note" placeholder={t("cashHandoverNote")} value={handoverNote[c.courierUserId] ?? ""} disabled={busy || !canAdd} onChange={(e) => setHandoverNote({ ...handoverNote, [c.courierUserId]: e.target.value })} />
                  )}
                  <button
                    className="button"
                    disabled={busy || !canAdd || !(c2 >= 0) || (c2 !== c.expected && !(handoverNote[c.courierUserId] ?? "").trim())}
                    onClick={() => void post("handover", { courierUserId: c.courierUserId, expected: c.expected, counted: c2, note: handoverNote[c.courierUserId] ?? "" })}
                  >
                    <HandCoins size={15} /> {t("cashHandover")}
                  </button>
                </div>
              );
            })}
            {view.handovers.length > 0 && (
              <details>
                <summary>{t("cashHandoversToday")} ({view.handovers.length})</summary>
                <ul className="pay-list">
                  {view.handovers.map((h) => (
                    <li key={h.id}>
                      <span>
                        {h.courierName} · {t("cashExpected")} {lei(h.expected)}
                        {h.note ? " · " + h.note : ""}
                      </span>
                      <b className={diffClass(h.counted - h.expected)}>{lei(h.counted)}</b>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </WorkspaceDetails>

          <WorkspaceDetails title={t("zTitle")} hint={view.z ? "#" + view.z.zNumber : t("simpleZNeeded")} attention={!!view.reconcile.diff && Object.values(view.reconcile.diff).some((value) => value !== 0)}>
            <label className="cash-field">
              {t("zImportTremol")}
              <input type="file" accept=".p7b,.xml" disabled={busy || date > today()} onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file) void importZ(file);
              }} />
            </label>
            {zImportMessage && (
              <p role={zImportMessage.error ? "alert" : "status"} className={zImportMessage.error ? "error-banner" : undefined}>
                {t(zImportMessage.key).replace("{date}", zImportMessage.date ?? "")}
              </p>
            )}
            <div className="pay-form">
              <label className="cash-field">{t("zNumber")}<input value={z.zNumber} disabled={busy} onChange={(e) => setZ({ ...z, zNumber: e.target.value })} /></label>
              <label className="cash-field">{t("zTotal")}<input inputMode="decimal" value={z.total} disabled={busy} onChange={(e) => setZ({ ...z, total: e.target.value })} /></label>
              <label className="cash-field">{t("zCash")}<input inputMode="decimal" value={z.cash} disabled={busy} onChange={(e) => setZ({ ...z, cash: e.target.value })} /></label>
              <label className="cash-field">{t("zCard")}<input inputMode="decimal" value={z.card} disabled={busy} onChange={(e) => setZ({ ...z, card: e.target.value })} /></label>
              <label className="cash-field">{t("payNote")}<input value={z.note} disabled={busy} onChange={(e) => setZ({ ...z, note: e.target.value })} /></label>
              <button
                className="button"
                disabled={busy || !z.zNumber.trim() || [z.total, z.cash, z.card].some((v) => !(toBani(v) >= 0)) || date > today()}
                onClick={() => void post("z", { date, revision: view.z?.revision ?? 0, zNumber: z.zNumber.trim(), total: toBani(z.total), cash: toBani(z.cash), card: toBani(z.card), note: z.note.trim() })}
              >
                <Save size={15} /> {t("zSave")}
              </button>
            </div>
            <table className="production-table cash-z">
              <thead>
                <tr>
                  <th></th>
                  <th className="number">{t("payMethod_cash")}</th>
                  <th className="number">{t("payMethod_card")}</th>
                  <th className="number">{t("zTotal")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t("zTitle")}</td>
                  <td className="number">{view.z ? lei(view.z.cash) : "—"}</td>
                  <td className="number">{view.z ? lei(view.z.card) : "—"}</td>
                  <td className="number">{view.z ? lei(view.z.total) : "—"}</td>
                </tr>
                <tr>
                  <td>{t("zSystem")}</td>
                  <td className="number">{lei(view.reconcile.system.cash)}</td>
                  <td className="number">{lei(view.reconcile.system.card)}</td>
                  <td className="number">{lei(view.reconcile.system.total)}</td>
                </tr>
                {view.reconcile.diff && (
                  <tr>
                    <td>
                      <b>{t("zDiff")}</b>
                    </td>
                    <td className={"number" + diffClass(view.reconcile.diff.cash)}>{lei(view.reconcile.diff.cash)}</td>
                    <td className={"number" + diffClass(view.reconcile.diff.card)}>{lei(view.reconcile.diff.card)}</td>
                    <td className={"number" + diffClass(view.reconcile.diff.total)}>{lei(view.reconcile.diff.total)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {view.reconcile.diff && view.reconcile.diff.zSplit !== 0 && (
              <p className="production-short">
                <AlertTriangle size={14} /> {t("zSplitWarning")}
              </p>
            )}
          </WorkspaceDetails>

      <FiscalDayPanel key={date + ":" + (view?.z?.revision ?? 0)} lang={lang} date={date} />

          {view.isAdmin && (
            <WorkspaceDetails title={t("supTitle")} hint={view.suppliers.length ? view.suppliers.length + " · " + lei(view.suppliers.reduce((sum, row) => sum + row.open, 0)) : t("simpleNoSupplierDebt")} attention={view.suppliers.some((row) => row.overdue)}>
              {!view.suppliers.length && <p className="quiet-empty">{t("supNone")}</p>}
              {view.suppliers.map((s) => {
                const f = supPay[s.id] ?? { amount: fromBani(s.open), method: "bank" as const };
                const amount = toBani(f.amount);
                return (
                  <div className={"cash-row" + (s.overdue ? " is-overdue" : "")} key={s.id}>
                    <div>
                      <strong>
                        {s.supplierName} · {(s.series + " " + s.number).trim()}
                      </strong>
                      <small>
                        {s.issueDate} · {lei(s.total)} · {t("supOpen")}: <b>{lei(s.open)}</b>
                        {s.dueDate ? ` · ${t("supDueDate")}: ${s.dueDate}` : ""}
                        {s.overdue ? " · " + t("supOverdue") : ""}
                      </small>
                      {s.payments.map((p) => (
                        <small key={p.id} className={p.reversedBy || p.reversalOf ? "is-reversed" : ""}>
                          {p.day} · {t("payMethod_" + p.method)} · {lei(p.amount)}
                          {!p.reversedBy && !p.reversalOf && (
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => {
                                const reason = window.prompt(t("payReversePrompt"));
                                if (reason && reason.trim().length >= 3) void post("supplier-payment/reverse", { id: p.id, reason: reason.trim() });
                              }}
                            >
                              <Undo2 size={13} />
                            </button>
                          )}
                        </small>
                      ))}
                    </div>
                    {s.open > 0 && (
                      <>
                        <select value={f.method} disabled={busy} onChange={(e) => setSupPay({ ...supPay, [s.id]: { ...f, method: e.target.value as "cash" | "bank" } })}>
                          <option value="bank">{t("payMethod_bank")}</option>
                          <option value="cash">{t("payMethod_cash")}</option>
                        </select>
                        <input className="production-num" inputMode="decimal" value={f.amount} disabled={busy} onChange={(e) => setSupPay({ ...supPay, [s.id]: { ...f, amount: e.target.value } })} />
                        <button className="button" disabled={busy || !(amount > 0) || amount > s.open || (f.method === "cash" && !canAdd)} onClick={() => void post("supplier-payment", { invoiceId: s.id, amount, method: f.method, note: "" })}>
                          {t("supPay")}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </WorkspaceDetails>
          )}
        </>
      )}
    </div>
  );
}
