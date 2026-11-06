"use client";
import { useCallback, useEffect, useState } from "react";
import { Database, Download, RefreshCw } from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import type { Language } from "@/src/modules/shared/domain";

type Backup = { key: string; size: number; uploaded: string };

/** Könyvelés → Biztonsági mentések (v96): heti automatikus mentés, azonnali mentés, letöltés. */
export default function BackupsWorkspace({ lang }: { lang: Language }) {
  const t = (k: string) => (messages[lang] as Record<string, string>)[k] ?? k;
  const [list, setList] = useState<Backup[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetch("/api/backups", { cache: "no-store" })
      .then(async (r) => {
        const v = (await r.json().catch(() => ({}))) as { backups?: Backup[]; error?: string };
        if (!r.ok) throw new Error(v.error ?? "loadError");
        setList(v.backups ?? []);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  async function run() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/backups/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const v = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(v.error ?? "saveError");
      setNotice(t("backupDone"));
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const fmt = (iso: string) => new Intl.DateTimeFormat(lang === "hu" ? "hu-HU" : "ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  return (
    <div className="cash-workspace">
      <section className="panel cash-section">
        <h2>
          <Database size={18} /> {t("backups")}
        </h2>
        <p className="quiet-empty">{t("backupIntro")}</p>
        {error && <div role="alert" className="error-banner">{t(error)}</div>}
        {notice && <p role="status" className="portal-success">{notice}</p>}
        <div className="production-actions">
          <button className="button" disabled={busy} onClick={() => void run()}>
            <RefreshCw size={15} /> {busy ? t("backupRunning") : t("backupNow")}
          </button>
        </div>
        {list && !list.length && <p className="quiet-empty">{t("backupNone")}</p>}
        {list && list.length > 0 && (
          <div className="table-wrap">
            <table className="production-table">
              <tbody>
                {list.map((b) => (
                  <tr key={b.key}>
                    <td>{fmt(b.uploaded)}</td>
                    <td className="number">{(b.size / 1024 / 1024).toFixed(1)} MB</td>
                    <td className="production-actions">
                      <a className="button secondary" href={"/api/backups/file?key=" + encodeURIComponent(b.key)}>
                        <Download size={14} /> {t("backupDownload")}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="quiet-empty">{t("backupRestoreHint")}</p>
      </section>
    </div>
  );
}
