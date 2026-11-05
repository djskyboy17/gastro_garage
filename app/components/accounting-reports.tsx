"use client";
import { useState } from "react";
import { Printer } from "lucide-react";
import { today, type Language } from "@/src/modules/shared/domain";
import { addDays } from "@/src/modules/menu/domain";
import { messages } from "@/src/modules/shared/i18n";

export default function AccountingReports({ lang }: { lang: Language }) {
  const t = (key: string) => messages[lang][key] ?? key;
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(() => addDays(today().slice(0, 7) + "-01", -1).slice(0, 7));
  return <div className="accounting-reports">
    <h2>{t("accountingReports")}</h2>
    <div className="simple-form-grid">
    <form className="simple-report-card monthly" action="/api/accounting/report" method="get" target="_blank">
      <h3>{t("simpleMonthlyReport")}</h3><p>{t("simpleMonthlyHint")}</p>
      <input type="hidden" name="kind" value="month" />
      <label>{t("accountingMonth")}<input type="month" name="value" min="2000-01" max="9998-12" required value={month} onChange={(e) => setMonth(e.target.value)} /></label>
      <button className="button" aria-label={t("accountingPrintMonth")}><Printer size={16} />{t("simplePrint")}</button>
    </form>
    <form className="simple-report-card" action="/api/accounting/report" method="get" target="_blank">
      <h3>{t("simpleWeeklyReport")}</h3><p>{t("simpleWeeklyHint")}</p>
      <input type="hidden" name="kind" value="week" />
      <label>{t("accountingWeekDay")}<input type="date" name="value" min="2000-01-01" max="9998-12-31" required value={day} onChange={(e) => setDay(e.target.value)} /></label>
      <button className="button secondary" aria-label={t("accountingPrintWeek")}><Printer size={16} />{t("simplePrint")}</button>
    </form>
    </div>
    <p>{t("accountingReportsHint")}</p>
  </div>;
}
