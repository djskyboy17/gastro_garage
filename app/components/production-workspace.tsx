"use client";
import { useCallback, useEffect, useState } from "react";
import { Factory, Printer, Undo2, Trash2, Save, PackageCheck, AlertTriangle, RefreshCw } from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import type { Language, Order } from "@/src/modules/shared/domain";
import type { OperationsData } from "@/src/modules/inventory/domain";
import { suggestedPortions, unbatchedReady, type ProductionDay, type ProductionRow } from "@/src/modules/production/domain";

/** Anyaglista a lezárás előtt (a szerver számolja a tétel receptpillanatképéből). */
type Preview = {
  issuedBefore: number;
  consumed: number;
  lines: { ingredientId: string; hu: string; ro: string; unit: string; quantity: number; available: number }[];
};
type Review = { row: ProductionRow; actual: number; preview: Preview; used: Record<string, string>; note: string };

const unitLabel = (u: string) => (u === "pcs" ? "db" : u);
const amount = (v: number, unit: string) =>
  unit === "g" || unit === "ml" ? (v >= 1000 ? (v / 1000).toLocaleString("hu-HU", { maximumFractionDigits: 3 }) + (unit === "g" ? " kg" : " l") : v + " " + unit) : v + " " + unitLabel(unit);

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const v = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((v as { error?: string }).error ?? "SERVER_ERROR");
  return v as T;
}

/**
 * Gyártási tételek (v73) – az iroda / admin rögzíti a Konyhai terv lapon. Ételenként napi egy tétel:
 * felvétel a javasolt (rendelt + ráhagyás) adaggal, a végén tényleges adag, anyaglista, lezárás bon de consummal, sztornó.
 */
export default function ProductionWorkspace({ lang, initialDay, onChanged }: { lang: Language; initialDay: string; onChanged: () => void }) {
  const t = (k: string) => (messages[lang] as Record<string, string>)[k] ?? k;
  const [date, setDate] = useState(initialDay);
  const [data, setData] = useState<ProductionDay | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [planned, setPlanned] = useState<Record<string, string>>({});
  const [actual, setActual] = useState<Record<string, string>>({});
  const [margin, setMargin] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  // v78: a „Nap lezárása recept szerint” eredménye (lezárt és kimaradt ételek).
  const [bulk, setBulk] = useState<{ closed: { name: string; actual: number }[]; skipped: { name: string; code: string }[] } | null>(null);

  const load = useCallback((day: string) => {
    getJson<ProductionDay>("/api/production?date=" + day).then(
      (d) => {
        setData(d);
        setMargin(String(d.marginBps / 100));
        setPlanned({});
        setActual({});
        setError("");
        setBulk(null);
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
      return v as { consumptionId?: string | null; closed?: { name: string; actual: number }[]; skipped?: { name: string; code: string }[] };
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  // v74: a javaslat a tegnapról megmaradt, ma még kiadható adagot levonja.
  const suggestion = (r: ProductionRow) => suggestedPortions(Math.max(0, r.ordered - r.opening), data?.marginBps ?? 0);
  const plannedOf = (r: ProductionRow) => planned[r.productId] ?? String(r.batch?.planned ?? suggestion(r));
  const locked = !!data?.dayClosed;
  // v78: lezárandó ételek – recepttel, rendeléssel vagy nyitott tétellel, még nem lezárva.
  const pendingCount = (data?.rows ?? []).filter((r) => r.hasRecipe && r.batch?.status !== "closed" && (r.ordered > 0 || r.batch)).length;
  const actualOf = (r: ProductionRow) => actual[r.productId] ?? String(r.batch?.actual ?? r.batch?.planned ?? r.ordered);
  const int = (s: string) => (/^\d{1,6}$/.test(s.trim()) ? Number(s.trim()) : null);

  async function openReview(r: ProductionRow) {
    const n = int(actualOf(r));
    if (!r.batch || n === null) return setError("VALIDATION");
    setBusy(true);
    try {
      const preview = await getJson<Preview>(`/api/production/preview?id=${r.batch.id}&actual=${n}`);
      setReview({ row: r, actual: n, preview, used: Object.fromEntries(preview.lines.map((l) => [l.ingredientId, String(l.quantity)])), note: "" });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (!review?.row.batch) return;
    const lines = review.preview.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: int(review.used[l.ingredientId] ?? "") }));
    if (lines.some((l) => l.quantity === null)) return setError("VALIDATION");
    const ok = await post("close", { id: review.row.batch.id, revision: review.row.batch.revision, actual: review.actual, note: review.note, lines });
    if (ok) setReview(null);
  }
  async function reverse(r: ProductionRow) {
    if (!r.batch) return;
    const reason = window.prompt(t("productionReversePrompt"));
    if (!reason || reason.trim().length < 3) return;
    await post("reverse", { id: r.batch.id, revision: r.batch.revision, reason: reason.trim() });
  }
  const errorText = error ? ((messages[lang] as Record<string, string>)[error] ?? t("saveError")) : "";
  const bcLink = (id: string) => "/api/production/bc?id=" + id;

  return (
    <section className="panel production-panel">
      <div className="panel-heading">
        <div>
          <h2>
            <Factory size={20} /> {t("batchesTitle")}
          </h2>
          <p>{t("productionIntro")}</p>
        </div>
      </div>
      <div className="production-toolbar">
        <label>
          {t("productionDay")}
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <label>
          {t("productionMargin")}
          <input inputMode="numeric" value={margin} onChange={(e) => setMargin(e.target.value)} />
        </label>
        <button
          className="button secondary"
          disabled={busy || !data || int(margin) === null || int(margin)! > 100 || int(margin)! * 100 === data.marginBps}
          onClick={() => data && void post("settings", { revision: data.settingsRevision, marginBps: int(margin)! * 100 })}
        >
          <Save size={16} /> {t("productionMarginSave")}
        </button>
        <button className="text-button" onClick={() => load(date)} disabled={busy}>
          <RefreshCw size={16} />
        </button>
        {!locked && pendingCount > 0 && (
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(t("productionCloseAllConfirm").replace("{n}", String(pendingCount)))) return;
              const v = await post("close-all", { date });
              if (v) setBulk({ closed: v.closed ?? [], skipped: v.skipped ?? [] });
            }}
          >
            <PackageCheck size={16} /> {t("productionCloseAll")} ({pendingCount})
          </button>
        )}
      </div>
      {bulk && (
        <div className={bulk.skipped.length ? "production-warning" : "portal-success"} role="status">
          <div>
            <strong>
              {t("productionCloseAllDone")}: {bulk.closed.length}
            </strong>
            {bulk.closed.length > 0 && <span>{bulk.closed.map((c) => c.name + " (" + c.actual + ")").join(", ")}</span>}
            {bulk.skipped.map((s) => (
              <small key={s.name}>
                {t("productionCloseAllSkipped")}: {s.name} – {(messages[lang] as Record<string, string>)[s.code] ?? s.code}
              </small>
            ))}
          </div>
        </div>
      )}
      {errorText && (
        <div role="alert" className="error-banner">
          {errorText}
        </div>
      )}
      {data && !data.rows.length && <p className="quiet-empty">{t("productionEmpty")}</p>}
      {data && data.rows.length > 0 && (
        <div className="table-wrap">
          <table className="production-table">
            <thead>
              <tr>
                <th>{t("productionDish")}</th>
                <th className="number">{t("productionOrdered")}</th>
                <th className="number">{t("productionPlanned")}</th>
                <th className="number">{t("productionActual")}</th>
                <th>{t("productionStatus")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const b = r.batch;
                const name = lang === "ro" ? r.ro : r.hu;
                return (
                  <tr key={r.productId}>
                    <td>
                      <strong>{name}</strong>
                      {b && (
                        <small>
                          {t("productionCode")}: {b.code}
                          {b.useBy ? ` · ${t("productionUseBy")}: ${b.useBy}` : ""}
                        </small>
                      )}
                      {r.opening > 0 && (
                        <small>
                          {t("productionOpening")}: {r.opening}
                        </small>
                      )}
                      {r.issued > 0 && (
                        <small>
                          {t("productionIssuedBefore")}: {r.issued}
                        </small>
                      )}
                      {r.handovers.length > 0 && (
                        <small className="production-docs">
                          {r.handovers.map((d) => (
                            <a key={d.id} href={"/api/production/doc?id=" + d.id} target="_blank" rel="noreferrer" className={d.status === "reversed" ? "is-reversed" : ""}>
                              <Printer size={13} /> {d.number}
                              {d.kind === "reversal" ? " (" + t("productionReversalDoc") + ")" : ""}
                            </a>
                          ))}
                        </small>
                      )}
                      {r.documents.length > 0 && (
                        <small className="production-docs">
                          {r.documents.map((d) => (
                            <a key={d.id} href={bcLink(d.id)} target="_blank" rel="noreferrer" className={d.status === "reversed" ? "is-reversed" : ""}>
                              <Printer size={13} /> {d.number}
                              {d.kind === "reversal" ? " (" + t("productionReversalDoc") + ")" : ""}
                            </a>
                          ))}
                        </small>
                      )}
                    </td>
                    <td className="number">
                      {r.ordered}
                      <small>
                        {t("productionSuggested")}: {suggestion(r)}
                      </small>
                    </td>
                    <td className="number">
                      {b?.status === "closed" ? (
                        b.planned
                      ) : (
                        <input className="production-num" inputMode="numeric" value={plannedOf(r)} disabled={!r.hasRecipe} onChange={(e) => setPlanned({ ...planned, [r.productId]: e.target.value })} />
                      )}
                    </td>
                    <td className="number">
                      {b?.status === "closed" ? (
                        <strong>{b.actual}</strong>
                      ) : b ? (
                        <input className="production-num" inputMode="numeric" value={actualOf(r)} onChange={(e) => setActual({ ...actual, [r.productId]: e.target.value })} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span className={"badge " + (!r.hasRecipe ? "failed" : b?.status === "closed" ? "ready" : b ? "cooking" : "queued")}>
                        {!r.hasRecipe ? t("productionNoRecipe") : b?.status === "closed" ? t("productionClosed") : b ? t("productionOpen") : t("productionNone")}
                      </span>
                    </td>
                    <td className="production-actions">
                      {!locked && r.hasRecipe && !b && (
                        <button className="button" disabled={busy || int(plannedOf(r)) === null} onClick={() => void post("save", { date, productId: r.productId, planned: int(plannedOf(r)), revision: null })}>
                          {t("productionCreate")}
                        </button>
                      )}
                      {!locked && b?.status === "open" && (
                        <>
                          <button
                            className="button secondary"
                            disabled={busy || int(plannedOf(r)) === null}
                            onClick={() => void post("save", { date, productId: r.productId, planned: int(plannedOf(r)), revision: b.revision })}
                          >
                            <Save size={15} /> {t("productionSavePlan")}
                          </button>
                          <button className="button" disabled={busy || int(actualOf(r)) === null} onClick={() => void openReview(r)}>
                            <PackageCheck size={15} /> {t("productionReview")}
                          </button>
                          {r.documents.length === 0 && (
                            <button className="danger-button" disabled={busy} title={t("productionDelete")} onClick={() => window.confirm(t("productionDeleteConfirm")) && void post("delete", { id: b.id, revision: b.revision })}>
                              <Trash2 size={15} />
                            </button>
                          )}
                        </>
                      )}
                      {!locked && b?.status === "closed" && (
                        <button className="button secondary" disabled={busy} onClick={() => void reverse(r)}>
                          <Undo2 size={15} /> {t("productionReverse")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {review && (
        <div className="production-review">
          <h3>
            {t("productionMaterials")}: {lang === "ro" ? review.row.ro : review.row.hu} · {review.preview.consumed} {t("productionMaterialsFor")}
          </h3>
          {review.preview.issuedBefore > 0 && <p className="ops-note">{t("productionMaterialsIssued")} ({review.preview.issuedBefore})</p>}
          {review.preview.lines.length === 0 ? (
            <p className="quiet-empty">{t("productionNoMaterials")}</p>
          ) : (
            <table className="production-table">
              <thead>
                <tr>
                  <th>{t("productionIngredient")}</th>
                  <th className="number">{t("productionRecipeQty")}</th>
                  <th className="number">{t("productionUsedQty")}</th>
                  <th className="number">{t("productionAvailable")}</th>
                </tr>
              </thead>
              <tbody>
                {review.preview.lines.map((l) => {
                  const used = int(review.used[l.ingredientId] ?? "");
                  const short = used !== null && used > l.available;
                  return (
                    <tr key={l.ingredientId}>
                      <td>{lang === "ro" ? l.ro : l.hu}</td>
                      <td className="number">{amount(l.quantity, l.unit)}</td>
                      <td className="number">
                        <input className="production-num" inputMode="numeric" value={review.used[l.ingredientId] ?? ""} onChange={(e) => setReview({ ...review, used: { ...review.used, [l.ingredientId]: e.target.value } })} /> {unitLabel(l.unit)}
                      </td>
                      <td className={"number" + (short ? " production-short" : "")}>
                        {short && <AlertTriangle size={14} />} {amount(l.available, l.unit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <label className="production-note">
            {t("productionNote")}
            <textarea value={review.note} maxLength={1000} onChange={(e) => setReview({ ...review, note: e.target.value })} />
          </label>
          <div className="production-actions">
            <button className="button" disabled={busy} onClick={() => void close()}>
              <PackageCheck size={16} /> {t("productionClose")}
            </button>
            <button className="button secondary" disabled={busy} onClick={() => setReview(null)}>
              {t("productionCancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Figyelmeztetés (nem tiltás): késznek jelölt ételek lezárt gyártási tétel nélkül az adott napon. */
export function ProductionWarning({ lang, orders, operations, day, onOpen }: { lang: Language; orders: Order[]; operations: OperationsData; day: string; onOpen?: () => void }) {
  const t = (k: string) => (messages[lang] as Record<string, string>)[k] ?? k;
  const list = unbatchedReady(orders, operations, day);
  if (!list.length) return null;
  return (
    <div className="production-warning" role="status">
      <AlertTriangle size={18} />
      <div>
        <strong>
          {t("productionWarning")} ({list.length})
        </strong>
        <span>{list.map((p) => (lang === "ro" ? p.ro : p.hu)).join(", ")}</span>
        <small>{t("productionWarningHint")}</small>
      </div>
      {onOpen && (
        <button className="text-button" onClick={onOpen}>
          {t("batchesTitle")}
        </button>
      )}
    </div>
  );
}
