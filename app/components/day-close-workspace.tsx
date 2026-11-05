"use client";
import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Printer, Undo2, Save, AlertTriangle, RefreshCw, Lock } from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import type { Language } from "@/src/modules/shared/domain";
import { lastUsableDay, planDayClose, type DayInput, type DayRow } from "@/src/modules/production/finished";
import type { DayCloseView } from "@/src/modules/production/day-close";

type Draft = Record<string, { staff: string; waste: string; donation: string; wasteNote: string }>;
const emptyDraft = { staff: "", waste: "", donation: "", wasteNote: "" };
const num = (s: string) => (s.trim() === "" ? 0 : /^\d{1,6}$/.test(s.trim()) ? Number(s.trim()) : NaN);

/**
 * Napi zárás (v74) – a konyha a nap végén ételenként rögzíti a dolgozói étkezést, a selejtet (indokkal) és az adományt;
 * a másnapra maradó adagot a rendszer számolja. Lezáráskor a selejtről napi proces-verbal készül. Visszanyitás: csak admin.
 */
export default function DayCloseWorkspace({ lang, initialDay, admin, onChanged }: { lang: Language; initialDay: string; admin: boolean; onChanged: () => void }) {
  const t = (k: string) => (messages[lang] as Record<string, string>)[k] ?? k;
  const [date, setDate] = useState(initialDay);
  const [view, setView] = useState<DayCloseView | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [committee, setCommittee] = useState("");
  const [handover, setHandover] = useState(false);

  const load = useCallback((day: string) => {
    fetch("/api/production/day?date=" + day, { cache: "no-store" })
      .then(async (r) => {
        const v = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((v as { error?: string }).error ?? "SERVER_ERROR");
        return v as DayCloseView;
      })
      .then(
        (v) => {
          setView(v);
          setDraft({});
          setCommittee(v.writeOffCommittee);
          setHandover(v.handoverEnabled);
          setError("");
        },
        (e: Error) => setError(e.message),
      );
  }, []);
  useEffect(() => {
    load(date);
  }, [date, load]);

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/production/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const v = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((v as { error?: string }).error ?? "SERVER_ERROR");
      load(date);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputs: DayInput[] = view
    ? view.products.map((p) => {
        const d = draft[p.productId] ?? emptyDraft;
        return { productId: p.productId, staff: num(d.staff), waste: num(d.waste), donation: num(d.donation), wasteNote: d.wasteNote };
      })
    : [];
  const invalid = inputs.some((i) => [i.staff, i.waste, i.donation].some((v) => Number.isNaN(v)));
  const plan = view && !invalid ? planDayClose(view.date, view.products, view.lots, inputs) : null;
  const rows: DayRow[] = view?.status === "closed" ? (view.rows ?? []) : (plan?.rows ?? []);
  const rowErrors = new Map((plan?.errors ?? []).map((e) => [e.productId, e.code]));
  const expiring = (productId: string) => !!view && view.lots.some((l) => l.productId === productId && l.remaining > 0 && l.day <= view.date && lastUsableDay(l) === view.date);
  const blocked = !view || view.status === "closed" || view.openBatches.length > 0 || !!view.pendingDay || invalid || (plan?.errors.length ?? 0) > 0 || busy;
  const errorText = error ? ((messages[lang] as Record<string, string>)[error] ?? t("saveError")) : "";
  const set = (productId: string, key: keyof Draft[string], value: string) => setDraft({ ...draft, [productId]: { ...(draft[productId] ?? emptyDraft), [key]: value } });
  const name = (r: { hu: string; ro: string }) => (lang === "ro" ? r.ro : r.hu);

  return (
    <section className="panel production-panel production-workspace">
      <div className="panel-heading">
        <div>
          <h2>
            <ClipboardCheck size={20} /> {t("dayCloseTitle")}
          </h2>
          <p>{t("dayCloseIntro")}</p>
        </div>
      </div>
      <div className="production-toolbar">
        <label>
          {t("productionDay")}
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <button className="text-button" onClick={() => load(date)} disabled={busy}>
          <RefreshCw size={16} />
        </button>
        {view?.status === "closed" && (
          <span className="badge ready">
            <Lock size={13} /> {t("dayCloseClosed")}
          </span>
        )}
      </div>
      {errorText && (
        <div role="alert" className="error-banner">
          {errorText}
        </div>
      )}
      {view && view.status === "open" && view.openBatches.length > 0 && (
        <div className="production-warning">
          <AlertTriangle size={18} />
          <div>
            <strong>{t("dayCloseOpenBatches")}</strong>
            <span>{view.openBatches.map(name).join(", ")}</span>
          </div>
        </div>
      )}
      {view && view.status === "open" && view.pendingDay && (
        <div className="production-warning">
          <AlertTriangle size={18} />
          <div>
            <strong>{t("dayClosePending")}</strong>
            <button className="text-button" onClick={() => setDate(view.pendingDay!)}>
              {view.pendingDay}
            </button>
          </div>
        </div>
      )}
      {view && !rows.length && <p className="quiet-empty">{t("dayCloseEmpty")}</p>}
      {view && rows.length > 0 && (
        <div className="table-wrap">
          <table className="production-table">
            <thead>
              <tr>
                <th>{t("dayCloseDish")}</th>
                <th className="number">{t("dayCloseOpening")}</th>
                <th className="number">{t("dayCloseProduced")}</th>
                <th className="number">{t("dayCloseSold")}</th>
                <th className="number">{t("dayCloseStaff")}</th>
                <th className="number">{t("dayCloseWaste")}</th>
                <th className="number">{t("dayCloseDonation")}</th>
                <th className="number">{t("dayCloseClosing")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const closed = view.status === "closed";
                const d = draft[r.productId] ?? emptyDraft;
                const err = rowErrors.get(r.productId);
                const field = (key: "staff" | "waste" | "donation") =>
                  closed ? r[key] : <input className="production-num" inputMode="numeric" placeholder="0" value={d[key]} onChange={(e) => set(r.productId, key, e.target.value)} />;
                return (
                  <tr key={r.productId} className={err ? "production-row-error" : ""}>
                    <td>
                      <strong>{name(r)}</strong>
                      {!closed && expiring(r.productId) && <small className="production-short">{t("dayCloseExpiring")}</small>}
                      {err && <small className="production-short">{(messages[lang] as Record<string, string>)[err] ?? err}</small>}
                      {closed && r.waste > 0 && r.wasteNote && <small>{r.wasteNote}</small>}
                    </td>
                    <td className="number">{r.opening}</td>
                    <td className="number">{r.produced}</td>
                    <td className="number">{r.sold}</td>
                    <td className="number">{field("staff")}</td>
                    <td className="number">
                      {field("waste")}
                      {!closed && num(d.waste) > 0 && (
                        <input className="production-reason" placeholder={t("dayCloseWasteNote")} maxLength={500} value={d.wasteNote} onChange={(e) => set(r.productId, "wasteNote", e.target.value)} />
                      )}
                    </td>
                    <td className="number">{field("donation")}</td>
                    <td className={"number" + (r.closing < 0 ? " production-short" : "")}>
                      <strong>{r.closing}</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {admin && view?.consumptionId && <p><a className="button secondary" href={"/api/production/bc?id="+view.consumptionId} target="_blank" rel="noreferrer"><Printer size={16}/>{t("dailyConsumptionDocument")}</a></p>}
      <div className="production-footer">
        {view?.documents.length ? (
          <span className="production-docs">
            {view.documents.map((doc) => (
              <a key={doc.id} href={"/api/production/doc?id=" + doc.id} target="_blank" rel="noreferrer" className={doc.status === "reversed" ? "is-reversed" : ""}>
                <Printer size={13} /> {doc.number}
                {doc.kind === "reversal" ? " (" + t("productionReversalDoc") + ")" : ""}
              </a>
            ))}
          </span>
        ) : (
          <span />
        )}
        {view?.status === "open" && (
          <button className="button" disabled={blocked} onClick={() => window.confirm(t("dayCloseConfirm")) && void post("day/close", { date, revision: view.revision, materialToken: view.materialToken, inputs })}>
            <Lock size={16} /> {t("dayCloseButton")}
          </button>
        )}
        {view?.canReopen && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt(t("dayCloseReopenPrompt"));
              if (reason && reason.trim().length >= 3) void post("day/reopen", { date, revision: view.revision, reason: reason.trim() });
            }}
          >
            <Undo2 size={16} /> {t("dayCloseReopen")}
          </button>
        )}
      </div>
      {admin && view && (
        <details className="production-settings">
          <summary>{t("dayCloseSettings")}</summary>
          <label>
            {t("dayCloseCommittee")}
            <textarea value={committee} maxLength={1000} onChange={(e) => setCommittee(e.target.value)} />
          </label>
          <label className="production-check">
            <input type="checkbox" checked={handover} onChange={(e) => setHandover(e.target.checked)} />
            {t("dayCloseHandover")}
          </label>
          <button className="button secondary" disabled={busy} onClick={() => void post("settings", { revision: view.settingsRevision, writeOffCommittee: committee, handoverEnabled: handover })}>
            <Save size={15} /> {t("dayCloseSaveSettings")}
          </button>
        </details>
      )}
    </section>
  );
}
