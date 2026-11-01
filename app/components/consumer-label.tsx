"use client";
import type { ReactNode } from "react";
import qrcode from "qrcode-generator";
import type { Language } from "@/src/modules/shared/domain";
import { decimal, displayDate, ingredientParts, type ConsumerLabel, type PublicLabel } from "@/src/modules/labels/domain";

/** QR-kód SVG-ként (M hibajavítás, a nyomtatón is éles). */
export function QrCode({ value, size = 96, title }: { value: string; size?: number; title?: string }) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount(),
    q = 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  return (
    <svg className="qr-code" width={size} height={size} viewBox={`0 0 ${n + q * 2} ${n + q * 2}`} shapeRendering="crispEdges" role="img" aria-label={title ?? value}>
      <rect width="100%" height="100%" fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** A címke tartalma; nyomtatáskor románul, a QR-oldalon a választott nyelven. */
export function LabelBody({ label, lang, t, aside }: { label: ConsumerLabel | PublicLabel; lang: Language; t: (k: string) => string; aside?: ReactNode }) {
  const n = label.nutritionPer100g;
  const rows: [string, string][] = n
    ? [
        ["labelEnergy", `${Math.round(n.energyKj / 100)} kJ / ${Math.round(n.energyKcal / 100)} kcal`],
        ["labelFat", decimal(n.fat) + " g"],
        ["labelSaturates", decimal(n.saturates) + " g"],
        ["labelCarbs", decimal(n.carbs) + " g"],
        ["labelSugars", decimal(n.sugars) + " g"],
        ["labelProtein", decimal(n.protein) + " g"],
        ["labelSalt", decimal(n.salt) + " g"],
      ]
    : [];
  return (
    <>
      <h3 className="label-name">{label.name[lang]}</h3>
      {lang === "ro" && label.name.hu && label.name.hu !== label.name.ro && <p className="label-name-alt">{label.name.hu}</p>}
      <p className="label-ingredients">
        <strong>{t("labelIngredients")}: </strong>
        {label.ingredients.length ? ingredientParts(label.ingredients, lang).map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>)) : t("labelNotGiven")}
      </p>
      {label.frozen && <p className="label-small">{t("labelFrozen")}</p>}
      <p className="label-allergens">
        <strong>{t("labelAllergens")}: </strong>
        {label.allergens.length ? <b>{label.allergens.map((a) => t(a)).join(", ")}</b> : label.ingredients.length ? t("labelNoAllergens") : t("labelNotGiven")}
      </p>
      <table className="label-nutrition">
        <caption>{t("labelNutrition")}</caption>
        <tbody>
          {rows.length ? (
            rows.map(([k, v]) => (
              <tr key={k} className={k === "labelSaturates" || k === "labelSugars" ? "sub" : ""}>
                <th>{t(k)}</th>
                <td>{v}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={2}>{t("labelNotGiven")}</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="label-facts-row">
      <dl className="label-facts">
        <div>
          <dt>{t("labelNet")}</dt>
          <dd>{label.netGrams} {label.netUnit ?? "g"}</dd>
        </div>
        <div>
          <dt>{t("labelProduced")}</dt>
          <dd>{displayDate(label.productionDate)}</dd>
        </div>
        <div className="label-useby">
          <dt>{t("labelUseBy")}</dt>
          <dd>{label.useBy ? displayDate(label.useBy) : t("labelNotGiven")}</dd>
        </div>
        <div>
          <dt>{t("labelLot")}</dt>
          <dd>{label.lot}</dd>
        </div>
      </dl>
      {aside}
      </div>
      <p className="label-small">
        <strong>{t("labelStorage")}: </strong>
        {label.storage[lang] || label.storage.ro || t("labelNotGiven")}
      </p>
      <p className="label-small">
        <strong>{t("labelProducer")}: </strong>
        {label.producer.name || t("labelNotGiven")}
        {label.producer.address && ", " + label.producer.address}
        {label.producer.extra && " · " + label.producer.extra}
      </p>
    </>
  );
}

/** Nyomtatható címke: 62 mm széles, adagonként egy oldal. */
export function PrintableLabel({ label, t }: { label: ConsumerLabel; t: (k: string) => string }) {
  return (
    <article className="consumer-label">
      <LabelBody
        label={label}
        lang="ro"
        t={t}
        aside={
          <div className="label-qr">
            <QrCode value={label.url} size={64} title={t("labelScan")} />
            <small>#{label.orderCode}</small>
          </div>
        }
      />
    </article>
  );
}
