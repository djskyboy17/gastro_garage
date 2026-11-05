"use client";
import { useCallback, useEffect, useState } from "react";
import { Building2, ChevronLeft, ChevronRight, Save } from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import { today, type Language } from "@/src/modules/shared/domain";
import { addDays, validDay } from "@/src/modules/menu/domain";
import type { CompanyProfile } from "@/src/modules/delivery-notes/domain";
import DeliveryNotesPanel from "./delivery-notes-panel";

type SettingsView = { allDeliveries: boolean; legalFooter: string; settingsRevision: number; canConfigure: boolean; company: CompanyProfile; companyMissing: boolean };

/**
 * Beállítások → Avizok (v84): a saját cég adatai (az avizon „Furnizor”), az aviz-szabály és lábjegyzet, valamint a kiválasztott nap
 * avizjai. Aviz csak céges ügyfél kiszállított rendeléséhez kell; amíg nincs kiállítva, a rendelés nem indulhat el.
 */
export default function AvizSettingsWorkspace({ lang }: { lang: Language }) {
  const t = (k: string) => (messages[lang] as Record<string, string>)[k] ?? k;
  const [date, setDate] = useState(today());
  const [view, setView] = useState<SettingsView | null>(null);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [all, setAll] = useState(false);
  const [footer, setFooter] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  const load = useCallback(() => {
    fetch("/api/delivery-notes?date=" + today(), { cache: "no-store" })
      .then(async (r) => {
        const v = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((v as { error?: string }).error ?? "loadError");
        return v as SettingsView;
      })
      .then(
        (v) => {
          setView(v);
          setCompany(v.company);
          setAll(v.allDeliveries);
          setFooter(v.legalFooter);
        },
        (e: Error) => setError(e.message),
      );
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function post(path: string, body: unknown, done: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/delivery-notes/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const v = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(v.error ?? "saveError");
      setNotice(t(done));
      load();
      setVersion((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const edit = !!view?.canConfigure;
  const field = (key: keyof Omit<CompanyProfile, "revision">, label: string, wide = false) => (
    <label className="cash-field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      {t(label)}
      <input value={company?.[key] ?? ""} disabled={!edit || busy} maxLength={key === "address" || key === "workPoint" ? 300 : 200} onChange={(e) => company && setCompany({ ...company, [key]: e.target.value })} />
    </label>
  );

  return (
    <div className="cash-workspace">
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
      {view && company && (
        <section className="panel cash-section">
          <h2>
            <Building2 size={18} /> {t("companyTitle")}
          </h2>
          <p className="quiet-empty">{t("companyHint")}</p>
          {view.companyMissing && <p className="production-short">{t("COMPANY_PROFILE_REQUIRED")}</p>}
          <div className="bill-form">
            {field("name", "companyName")}
            {field("cui", "companyCui")}
            {field("regCom", "companyRegCom")}
            {field("phone", "companyPhone")}
            {field("address", "companyAddress", true)}
            {field("workPoint", "companyWorkPoint", true)}
            {edit && (
              <div className="production-actions">
                <button className="button" disabled={busy} onClick={() => void post("company", { revision: company.revision, name: company.name, cui: company.cui, regCom: company.regCom, address: company.address, workPoint: company.workPoint, phone: company.phone }, "companySaved")}>
                  <Save size={14} /> {t("companySave")}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
      {view && (
        <section className="panel cash-section">
          <h2>{t("avizSettingsTitle")}</h2>
          <p className="quiet-empty">{t("avizSettingsHint")}</p>
          <div className="bill-form">
            <label className="production-check" style={{ gridColumn: "1 / -1" }}>
              <input type="checkbox" checked={all} disabled={!edit || busy} onChange={(e) => setAll(e.target.checked)} />
              {t("avizSettingsAll")}
            </label>
            <label className="cash-field" style={{ gridColumn: "1 / -1" }}>
              {t("avizFooter")}
              <textarea rows={3} maxLength={500} value={footer} disabled={!edit || busy} onChange={(e) => setFooter(e.target.value)} />
              <small>{t("avizFooterHint")}</small>
            </label>
            {edit && (
              <div className="production-actions">
                <button className="button" disabled={busy || (all === view.allDeliveries && footer === view.legalFooter)} onClick={() => void post("settings", { revision: view.settingsRevision, allDeliveries: all, legalFooter: footer }, "avizSettingsSaved")}>
                  <Save size={14} /> {t("avizSettingsSave")}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
      <div className="production-toolbar">
        <button className="button secondary" aria-label={t("previous")} disabled={date <= addDays(today(), -90)} onClick={() => setDate(addDays(date, -1))}>
          <ChevronLeft size={16} />
        </button>
        <label>
          {t("avizesDay")}
          <input type="date" min={addDays(today(), -90)} max={addDays(today(), 90)} value={date} onChange={(e) => validDay(e.target.value) && setDate(e.target.value)} />
        </label>
        <button className="button secondary" aria-label={t("next")} disabled={date >= addDays(today(), 90)} onClick={() => setDate(addDays(date, 1))}>
          <ChevronRight size={16} />
        </button>
      </div>
      <DeliveryNotesPanel key={date + ":" + version} lang={lang} date={date} />
    </div>
  );
}
