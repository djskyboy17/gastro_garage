"use client";
import { useMemo, useState } from "react";
import { messages } from "@/src/modules/shared/i18n";
import { today, type Language } from "@/src/modules/shared/domain";
import { addDays } from "@/src/modules/menu/domain";
import type { OperationsData } from "@/src/modules/inventory/domain";
import type { StocktakeData } from "@/src/modules/stocktake/domain";

/**
 * Gyorsleltár (v102): egy táblázat a raktárban lévő összes tételről; a számolt mennyiség kg / l / db-ban, tizedesvesszővel.
 * Csak a kitöltött sorok számítanak. Egy gomb: leltár létrehozása, mentése és – adminnál – könyvelése egymás után
 * (a meglévő, idempotens leltár-végpontokkal; a készletmozgás-védelem és a sztornó változatlan).
 */
const REASONS = ["quickReason_measure", "quickReason_spoiled", "quickReason_missing", "quickReason_surplus"] as const;
const factor = (unit: string) => (unit === "g" || unit === "ml" ? 1000 : 1);
const bigUnit = (unit: string) => (unit === "g" ? "kg" : unit === "ml" ? "l" : "db");
const show = (base: number, unit: string) => (base / factor(unit)).toLocaleString("hu-HU", { maximumFractionDigits: 3 });

export default function QuickCount({ ops, lang, admin, done }: { ops: OperationsData; lang: Language; admin: boolean; done: (id: string) => Promise<void> }) {
  const t = (k: string) => (messages[lang] as Record<string, string>)[k] ?? k;
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [search, setSearch] = useState("");
  const [expiring, setExpiring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const soon = addDays(today(), 7);
  const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const rows = useMemo(
    () =>
      ops.lots
        .filter((l) => l.remaining > 0)
        .map((l) => ({ lot: l, ing: ops.ingredients.find((i) => i.id === l.ingredientId) }))
        .filter(({ lot, ing }) => (!expiring || lot.expires <= soon) && (!search.trim() || norm(`${ing?.hu ?? ""} ${ing?.ro ?? ""} ${lot.batch} ${lot.supplier}`).includes(norm(search.trim()))))
        .sort((a, b) => (a.ing?.[lang] ?? "").localeCompare(b.ing?.[lang] ?? "") || a.lot.expires.localeCompare(b.lot.expires)),
    [ops, expiring, search, soon, lang],
  );
  const parsed = (lotId: string, unit: string) => {
    const v = (values[lotId] ?? "").trim().replace(",", ".");
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * factor(unit)) : NaN;
  };
  const filled = ops.lots.filter((l) => (values[l.id] ?? "").trim());
  const invalid = filled.some((l) => Number.isNaN(parsed(l.id, ops.ingredients.find((i) => i.id === l.ingredientId)?.unit ?? "g")));

  async function call(path: string, body: unknown) {
    const r = await fetch("/api/stocktake/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const v = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new Error(v.error ?? "saveError");
  }
  async function revisionOf(id: string) {
    const r = await fetch("/api/stocktake", { cache: "no-store" });
    const d = (await r.json()) as StocktakeData;
    const doc = d.stocktakes.find((s) => s.id === id);
    if (!doc) throw new Error("NOT_FOUND");
    return doc.revision;
  }
  async function submit() {
    if (!filled.length || invalid) return;
    setBusy(true);
    setError("");
    const id = crypto.randomUUID();
    try {
      await call("create", { id, title: t("quickCountTitleAuto") + " " + today(), lotIds: filled.map((l) => l.id) });
      await call("save", {
        id,
        revision: await revisionOf(id),
        lines: filled.map((l) => {
          const unit = ops.ingredients.find((i) => i.id === l.ingredientId)?.unit ?? "g";
          const extra = (notes[l.id] ?? "").trim();
          return { lotId: l.id, counted: parsed(l.id, unit), note: (t(reason) + (extra ? " – " + extra : "")).slice(0, 1000) };
        }),
      });
      if (admin) await call("post", { id, revision: await revisionOf(id) });
      setValues({});
      setNotes({});
      await done(id);
    } catch (e) {
      setError((e as Error).message);
      await done(id).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel quick-count">
      <h2>{t("quickCountTitle")}</h2>
      <p className="ops-note">{t(admin ? "quickCountHint" : "quickCountHintDraft")}</p>
      <div className="quick-count-tools">
        <input type="search" placeholder={t("stocktakeSearch")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <label>
          <input type="checkbox" checked={expiring} onChange={(e) => setExpiring(e.target.checked)} /> {t("quickCountExpiring")}
        </label>
      </div>
      <div className="table-wrap">
        <table className="quick-count-table">
          <thead>
            <tr>
              <th>{t("ingredients")}</th>
              <th>{t("expires")}</th>
              <th className="number">{t("quickCountSystem")}</th>
              <th>{t("quickCountCounted")}</th>
              <th className="number">{t("stocktakeDifference")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ lot, ing }) => {
              const unit = ing?.unit ?? "g";
              const counted = parsed(lot.id, unit);
              const delta = counted === null || Number.isNaN(counted) ? null : counted - lot.remaining;
              return (
                <tr key={lot.id} className={delta ? "is-diff" : ""}>
                  <td>
                    <strong>{ing?.[lang] ?? "—"}</strong>
                    <small>{lot.batch} · {lot.supplier}</small>
                  </td>
                  <td className={lot.expires < today() ? "count-negative" : ""}>{lot.expires}</td>
                  <td className="number">{show(lot.remaining, unit)} {bigUnit(unit)}</td>
                  <td>
                    <div className="quick-count-input">
                      <input inputMode="decimal" aria-label={t("quickCountCounted")} value={values[lot.id] ?? ""} disabled={busy} onChange={(e) => setValues({ ...values, [lot.id]: e.target.value })} />
                      <span>{bigUnit(unit)}</span>
                    </div>
                    {!!delta && <input className="quick-count-note" placeholder={t("quickCountNote")} maxLength={200} value={notes[lot.id] ?? ""} disabled={busy} onChange={(e) => setNotes({ ...notes, [lot.id]: e.target.value })} />}
                  </td>
                  <td className={"number " + (delta && delta < 0 ? "count-negative" : delta ? "count-positive" : "")}>{delta === null ? "" : (delta > 0 ? "+" : "") + show(delta, unit) + " " + bigUnit(unit)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="quick-count-footer">
        <label>
          {t("quickCountReason")}
          <select value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {t(r)}
              </option>
            ))}
          </select>
        </label>
        <button className="button" disabled={busy || !filled.length || invalid} onClick={() => void submit()}>
          {busy ? t("saving") : t(admin ? "quickCountSubmit" : "quickCountSubmitDraft")} ({filled.length})
        </button>
      </div>
      {invalid && <p className="portal-alert">{t("quickCountInvalid")}</p>}
      {error && <p role="alert" className="portal-alert">{t(error)}</p>}
    </section>
  );
}
