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

/** Összetevők (allergének kiemelve). */
function Ingredients({ label, lang, t }: { label: ConsumerLabel | PublicLabel; lang: Language; t: (k: string) => string }) {
  return (
    <p className="label-ingredients">
      <strong>{t("labelIngredients")}: </strong>
      {label.ingredients.length ? ingredientParts(label.ingredients, lang).map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>)) : t("labelNotGiven")}
    </p>
  );
}
/** Átlagos tápérték 100 g-ban. */
function Nutrition({ label, t }: { label: ConsumerLabel | PublicLabel; t: (k: string) => string }) {
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
  );
}
const allergenText = (label: ConsumerLabel | PublicLabel, t: (k: string) => string) =>
  label.allergens.length ? label.allergens.map((a) => t(a)).join(", ") : label.ingredients.length ? t("labelNoAllergens") : t("labelNotGiven");

/** A címke tartalma a QR-oldalon (a választott nyelven, minden részlettel). */
export function LabelBody({ label, lang, t, aside }: { label: ConsumerLabel | PublicLabel; lang: Language; t: (k: string) => string; aside?: ReactNode }) {
  return (
    <>
      <h3 className="label-name">{label.name[lang]}</h3>
      {lang === "ro" && label.name.hu && label.name.hu !== label.name.ro && <p className="label-name-alt">{label.name.hu}</p>}
      <Ingredients label={label} lang={lang} t={t} />
      {label.frozen && <p className="label-small">{t("labelFrozen")}</p>}
      <p className="label-allergens">
        <strong>{t("labelAllergens")}: </strong>
        {label.allergens.length ? <b>{allergenText(label, t)}</b> : allergenText(label, t)}
      </p>
      <Nutrition label={label} t={t} />
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

/**
 * Nyomtatható címke (v85): 62 mm széles, adagonként egy oldal, mindig románul. Logó, román és magyar név, allergének kiemelve,
 * QR-kód (összetevők, tápérték, részletek), nettó mennyiség, tétel, gyártás, fogyaszthatóság, tárolás, gyártó és rendeléskód.
 * Az összetevők és a tápérték a beállítás szerint a nyomtatott címkén is szerepelhetnek.
 */
export function PrintableLabel({ label, t }: { label: ConsumerLabel; t: (k: string) => string }) {
  const producer = [label.producer.name, label.producer.address].filter(Boolean).join(", ");
  return (
    <article className="consumer-label label-v85">
      <img className="label-logo" src="/logo.png" alt="Gastro Garage" />
      {/* v85: a magyar név elöl, alatta dőlten a román (a román mindig rajta van). */}
      <h3 className="label-name">{label.name.hu || label.name.ro}</h3>
      {label.name.hu && label.name.hu !== label.name.ro && <p className="label-name-alt">{label.name.ro}</p>}
      <p className="label-allergens">
        {t("labelAllergens")}: {allergenText(label, t)}
      </p>
      {label.frozen && <p className="label-small">{t("labelFrozen")}</p>}
      {label.printDetails && (
        <>
          <Ingredients label={label} lang="ro" t={t} />
          <Nutrition label={label} t={t} />
        </>
      )}
      <div className="label-main">
        <div className="label-qr">
          <QrCode value={label.url} size={96} title={t("labelScan")} />
          <small>{t("labelQrHint")}</small>
        </div>
        <dl className="label-facts">
          <div>
            <dt>{t("labelNet")}:</dt>
            <dd>
              {label.netGrams} {label.netUnit ?? "g"}
            </dd>
          </div>
          <div>
            <dt>{t("labelLot")}:</dt>
            <dd>{label.lot}</dd>
          </div>
          <div>
            <dt>{t("labelProducedShort")}:</dt>
            <dd>{displayDate(label.productionDate)}</dd>
          </div>
          <div className="label-inline">
            <dt>{t("labelUseByShort")}:</dt>{" "}
            <dd>{label.useBy ? displayDate(label.useBy) : t("labelNotGiven")}</dd>
          </div>
          <div className="label-inline label-storage">
            <dt>{t("labelStorage")}:</dt>{" "}
            <dd>{label.storage.ro || t("labelNotGiven")}</dd>
          </div>
        </dl>
      </div>
      <footer className="label-producer">
        <span>
          {t("labelProducer")}: {producer || t("labelNotGiven")}
          {label.producer.extra && " • " + label.producer.extra}
        </span>
        <small>#{label.orderCode}</small>
      </footer>
    </article>
  );
}
