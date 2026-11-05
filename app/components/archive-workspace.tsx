"use client";
import { useCallback, useEffect, useState } from "react";
import { Archive, ExternalLink, Download, RefreshCw, Search } from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import { today, type Language } from "@/src/modules/shared/domain";
import { ARCHIVE_TYPES } from "@/src/modules/archive/domain";

type Row = { id: string; type: string; number: string; partner: string; partnerName: string; issueDate: string; mime: string; size: number; version: number };
type View = { rows: Row[]; missing: number; total: number; configured: boolean };
const size = (b: number) => (b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " kB");

/** Archívum fül (v82): keresés év, hónap, típus és partner / szám szerint; megnyitás és letöltés; hiányzók archiválása. */
export default function ArchiveWorkspace({ lang }: { lang: Language }) {
  const t = (k: string) => (messages[lang] as Record<string, string>)[k] ?? k;
  const [year, setYear] = useState(today().slice(0, 4));
  const [month, setMonth] = useState("");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    const p = new URLSearchParams({ year, month, type, q });
    fetch("/api/archive?" + p.toString(), { cache: "no-store" })
      .then(async (r) => {
        const v = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((v as { error?: string }).error ?? "loadError");
        return v as View;
      })
      .then(
        (v) => {
          setView(v);
          setError("");
        },
        (e: Error) => setError(e.message),
      );
  }, [year, month, type, q]);
  useEffect(() => {
    load();
  }, [load]);
  async function sweep() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/archive/sweep", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const v = (await r.json().catch(() => ({}))) as { error?: string; stored?: number; failed?: unknown[] };
      if (!r.ok) throw new Error(v.error ?? "saveError");
      setNotice(`${t("archiveSweepDone")}: ${v.stored ?? 0}${v.failed?.length ? " · " + t("archiveSweepFailed") + ": " + v.failed.length : ""}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const years = Array.from({ length: 6 }, (_, i) => String(Number(today().slice(0, 4)) - i));
  return (
    <div className="cash-workspace">
      <div className="production-toolbar">
        <label>
          {t("archiveYear")}
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <label>
          {t("archiveMonth")}
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">{t("archiveAll")}</option>
            {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          {t("archiveType")}
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t("archiveAll")}</option>
            {ARCHIVE_TYPES.map((x) => (
              <option key={x} value={x}>
                {t("archiveType_" + x)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            <Search size={13} /> {t("archiveSearch")}
          </span>
          <input value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button className="text-button" disabled={busy} onClick={load}>
          <RefreshCw size={16} />
        </button>
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
        <section className="panel cash-section">
          <h2>
            <Archive size={18} /> {t("archive")}
          </h2>
          <div className="cash-totals">
            <span>
              <b>{view.total}</b> {t("archiveTotal")}
            </span>
            <span>
              {t("archiveMissing")}: <b>{view.missing}</b>
            </span>
            {view.missing > 0 && view.configured && (
              <button className="button secondary" disabled={busy} onClick={() => void sweep()}>
                <Archive size={14} /> {t("archiveSweep")}
              </button>
            )}
          </div>
          {!view.rows.length ? (
            <p className="quiet-empty">{t("archiveNone")}</p>
          ) : (
            <div className="table-wrap">
              <table className="production-table">
                <thead>
                  <tr>
                    <th>{t("archiveDate")}</th>
                    <th>{t("archiveType")}</th>
                    <th>{t("archiveNumber")}</th>
                    <th>{t("archivePartner")}</th>
                    <th className="number">{t("archiveSize")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.issueDate}</td>
                      <td>{t("archiveType_" + r.type)}</td>
                      <td>
                        {r.number}
                        {r.version > 1 ? ` (v${r.version})` : ""}
                      </td>
                      <td>
                        {r.partner}
                        {r.partnerName && <small>{r.partnerName}</small>}
                      </td>
                      <td className="number">{size(r.size)}</td>
                      <td className="production-actions">
                        <a className="button secondary" href={"/api/archive/file?id=" + r.id} target="_blank" rel="noreferrer">
                          <ExternalLink size={14} /> {t("archiveOpen")}
                        </a>
                        <a className="button secondary" href={"/api/archive/file?download=1&id=" + r.id}>
                          <Download size={14} /> {t("archiveDownload")}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
