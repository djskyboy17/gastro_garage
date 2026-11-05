"use client";
import { useEffect, useState } from "react";
import { messages } from "@/src/modules/shared/i18n";
import type { Language } from "@/src/modules/shared/domain";
import type { AccountingView } from "@/src/modules/accounting/domain";
import AccountingReports from "./accounting-reports";
import WorkspaceDetails from "./workspace-details";

export default function AccountingWorkspace({ lang }: { lang: Language }) {
  const t = (key: string) => messages[lang][key] ?? key;
  const [view, setView] = useState<AccountingView | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setView(null);
    setError("");
    void (async () => {
      try {
        const response = await fetch("/api/accounting", { cache: "no-store", signal: controller.signal });
        const data = await response.json() as AccountingView & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "loadError");
        if (controller.signal.aborted) return;
        setView(data);
        setNote(data.profile?.exemptionNote ?? "");
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
    })();
    return () => controller.abort();
  }, [refresh]);
  async function save() {
    if (!view || busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch("/api/accounting/profile", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: view.profile?.revision ?? 0, exemptionNote: note }) });
      const data = await response.json() as AccountingView & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "saveError");
      setView(data);
      setNote(data.profile?.exemptionNote ?? "");
      setSaved(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel cash-section accounting-workspace" aria-label={t("accountingTitle")}>
    {error && <p role="alert" className="error-banner">{t(error)} <button className="text-button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>{t("refresh")}</button></p>}
    {saved && <p role="status">{t("accountingSaved")}</p>}
    {!view && !error && <p role="status">{t("loading")}</p>}
    {view && <>
      <AccountingReports lang={lang} />
      <p>{view.profile ? `${t("accountingAppliedOn")} · ${view.profile.appliedOn}` : t("accountingNotApplied")}</p>
      <WorkspaceDetails title={t("simpleAccountingSettings")} hint={t("simpleAccountingSettingsHint")}>
      <p><strong>{t("accountingTaxStatus")}</strong></p>
      <ul>
        <li>{t("accountingGross")} · {view.settings.costBasis === "gross" ? "✓" : "—"}</li>
        <li>{t("accountingHandover")} · {view.settings.handoverEnabled ? "✓" : "—"}</li>
        <li>{t("accountingDelivery")} · ✓</li>
      </ul>
      <label className="cash-field">{t("accountingExemptionNote")}<textarea maxLength={500} disabled={busy} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <p>{t("accountingExemptionHint")}</p>
      <button className="button" disabled={busy} onClick={() => void save()}>{t(view.profile ? "accountingSave" : "accountingApply")}</button>
      <p>{t("accountingHistoryHint")}</p>
      <p>{t("accountingBillingHint")}</p>
      </WorkspaceDetails>
    </>}
  </section>;
}
