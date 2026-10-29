"use client";
import {
  hasFrozen,
  ingredientText,
  nutrientKeys,
  parseNutrition,
  type DishInfo,
  type Nutrition,
} from "@/src/modules/inventory/nutrition";
import type { Language } from "@/src/modules/shared/domain";

/** Századokból megjelenítés: 625 → „6,25”. */
function hundredths(value: number, lang: Language, digits = 1) {
  return new Intl.NumberFormat(lang === "hu" ? "hu-HU" : "ro-RO", {
    maximumFractionDigits: digits,
  }).format(value / 100);
}

/** Ételinformáció: összetevők, allergének, tápérték 100 g-ra (ANPC 201/2022). */
export function DishInfoView({
  info,
  lang,
  t,
}: {
  info: DishInfo;
  lang: Language;
  t: (key: string) => string;
}) {
  return (
    <div className="dish-info">
      <h3>{t("dishInfo")}</h3>
      <p>
        <strong>{t("ingredientList")}: </strong>
        {ingredientText(info.ingredients, lang) || "—"}
      </p>
      <p>
        <strong>{t("allergens")}: </strong>
        {info.allergens.length ? <b>{info.allergens.map(t).join(", ")}</b> : t("noAllergens")}
      </p>
      {info.nutritionPer100g ? (
        <table className="nutrition-table">
          <caption>{t("nutritionPer100g")}</caption>
          <tbody>
            {nutrientKeys.map((k) => (
              <tr key={k}>
                <td>{t("nutrient_" + k)}</td>
                <td>{hundredths(info.nutritionPer100g![k], lang, k.startsWith("energy") ? 0 : 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="warning-text">
          {t("nutritionMissing")}{" "}
          {[...info.missing.map((m) => m[lang]), ...info.missingPreparations.map(() => t("missingPreparation"))].join(", ")}
        </p>
      )}
      {hasFrozen(info.ingredients) && <p className="ops-note">{t("frozenNote")}</p>}
      <p className="ops-note">{t("dishInfoHint")}</p>
    </div>
  );
}

/** Tápérték-mezők az alapanyag-űrlapokon (tizedes értékek; a szerver századokat kap). */
export function NutritionFields({
  t,
  initial,
}: {
  t: (key: string) => string;
  initial?: string | null;
}) {
  const n = parseNutrition(initial ?? "");
  return (
    <fieldset className="nutrition-fields">
      <legend>{t("nutritionInput")}</legend>
      <p className="ops-note">{t("nutritionInputHint")}</p>
      <div className="form-grid">
        {nutrientKeys.map((k) => (
          <div className="field" key={k}>
            <label htmlFor={"nutrition-" + k}>{t("nutrient_" + k)}</label>
            <input
              id={"nutrition-" + k}
              name={"nutrition-" + k}
              type="number"
              min="0"
              max="100000"
              step="0.01"
              defaultValue={n ? String(n[k] / 100) : ""}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/** A tápérték-mezők kiolvasása: mind üres → `null`; különben az üresek 0-nak számítanak. */
export function readNutrition(form: FormData): Nutrition | null {
  const raw = nutrientKeys.map((k) => String(form.get("nutrition-" + k) ?? "").trim());
  if (raw.every((v) => v === "")) return null;
  return Object.fromEntries(
    nutrientKeys.map((k, i) => [k, Math.round(Number((raw[i] || "0").replace(",", ".")) * 100)]),
  ) as Nutrition;
}
