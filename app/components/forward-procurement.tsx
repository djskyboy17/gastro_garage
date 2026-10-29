"use client";
import { useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Plus } from "lucide-react";
import { forwardProcurement } from "@/src/modules/inventory/domain";
import { inboundSchedule } from "@/src/modules/purchasing/domain";
import { today, type AppData, type Language } from "@/src/modules/shared/domain";

const addDays = (date: string, days: number) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Előretekintő beszerzés: a következő napok rendeléseihez mikorra, mi hiányzik a raktárból. */
export default function ForwardProcurement({
  data,
  lang,
  t,
  fmt,
  money,
  busy,
  onCreate,
}: {
  data: AppData;
  lang: Language;
  t: (key: string) => string;
  fmt: (quantity: number, unit: string) => string;
  money: (bani: number) => string;
  busy: boolean;
  onCreate: (lines: { ingredientId: string; quantity: number }[], due: string) => void;
}) {
  const [horizon, setHorizon] = useState(14);
  const start = today();
  const days = forwardProcurement(data.orders, data.operations, start, horizon, inboundSchedule(data.purchasing));
  const ingredient = (id: string) => data.operations.ingredients.find((i) => i.id === id);
  const product = (id: string) => data.products.find((p) => p.id === id);
  const longDate = (date: string) =>
    new Intl.DateTimeFormat(lang === "hu" ? "hu-HU" : "ro-RO", { weekday: "long", month: "long", day: "numeric", timeZone: "Europe/Bucharest" }).format(new Date(date + "T12:00:00Z"));
  const short = days.filter((d) => d.shortage.length > 0);
  return (
    <section className="panel forward-plan">
      <div className="panel-heading">
        <h2>
          <CalendarClock size={18} />
          {t("forwardTitle")}
        </h2>
        <label className="forward-horizon">
          {t("forwardHorizon")}
          <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
            {[7, 14, 30].map((n) => (
              <option key={n} value={n}>
                {n} {t("forwardDays")}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="panel-subtitle">{t("forwardHint")}</p>
      {!days.length && <p className="quiet-empty">{t("forwardEmpty")}</p>}
      {days.length > 0 && !short.length && (
        <p className="ops-success forward-ok">
          <CheckCircle2 size={17} />
          {t("forwardAllCovered")}
        </p>
      )}
      <div className="forward-days">
        {days.map((d) => {
          // [FELTÉTELEZÉS] Az alapanyagnak a gyártási nap előtti napon kell beérkeznie.
          const due = d.date > start ? addDays(d.date, -1) : start;
          return (
            <article key={d.date} className={"forward-day" + (d.shortage.length ? " has-shortage" : "")}>
              <header>
                <div>
                  <strong>{longDate(d.date)}</strong>
                  <small>
                    {d.orders} {t("forwardOrders")} · {d.portions} {t("forwardPortions")}
                  </small>
                </div>
                <span className={"badge " + (d.shortage.length ? "failed" : "ready")}>
                  {d.shortage.length ? d.shortage.length + " " + t("forwardMissingItems") : t("forwardCovered")}
                </span>
              </header>
              {d.missing.length > 0 && (
                <p className="forward-warning">
                  <AlertCircle size={16} />
                  {t("forwardNoRecipe")}: {d.missing.map((id) => product(id)?.[lang] ?? id).join(", ")}
                </p>
              )}
              {d.shortage.length > 0 && (
                <>
                  <ul>
                    {d.shortage.map((s) => {
                      const i = ingredient(s.ingredientId);
                      return (
                        <li key={s.ingredientId}>
                          <span>
                            <strong>{i?.[lang] ?? s.ingredientId}</strong>
                            <small>
                              {s.packs} × {i ? fmt(i.packQuantity, i.unit) : ""}
                              {i?.supplier ? " · " + i.supplier : ""}
                            </small>
                          </span>
                          <span className="forward-qty">
                            <strong>{i ? fmt(s.quantity, i.unit) : s.quantity}</strong>
                            <small>{money(s.estimatedCost)}</small>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <footer>
                    <span>
                      {t("estimatedCost")}: <strong>{money(d.shortage.reduce((n, s) => n + s.estimatedCost, 0))}</strong>
                    </span>
                    <button
                      type="button"
                      className="button"
                      disabled={busy || !data.purchasing.suppliers.length || d.shortage.length > 25}
                      onClick={() => onCreate(d.shortage.map((s) => ({ ingredientId: s.ingredientId, quantity: s.quantity })), due)}
                    >
                      <Plus size={15} />
                      {t("forwardCreate")}
                    </button>
                  </footer>
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
