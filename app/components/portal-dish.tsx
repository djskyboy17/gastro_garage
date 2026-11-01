"use client";
import { useEffect, useRef } from "react";
import { ChefHat, Info, Leaf, Minus, Plus, X } from "lucide-react";
import { portionUnit, type Language } from "@/src/modules/shared/domain";
import type { PublicProduct } from "@/src/modules/portal/domain";
import { PublicDishInfoView } from "./dish-info";
import { ProductImage } from "./product-image";

type MenuProduct = PublicProduct & { remaining: number };

/** Étlapkártya (v44): nagy kép, „i” gomb az összetevőkhöz és allergénekhez, jól látható kosár gomb vagy darabszámláló. */
export function DishCard({
  product: p,
  lang,
  t,
  money,
  inCart,
  canAdd,
  disabled,
  add,
  remove,
  showInfo,
}: {
  product: MenuProduct;
  lang: Language;
  t: (k: string) => string;
  money: (n: number) => string;
  inCart: number;
  canAdd: boolean;
  disabled: boolean;
  add: () => void;
  remove: () => void;
  showInfo: () => void;
}) {
  const description = lang === "hu" ? p.descriptionHu : p.descriptionRo;
  const soldOut = p.remaining <= 0;
  return (
    <article className={"portal-dish" + (inCart ? " in-cart" : "")}>
      <div className={"portal-dish-art " + p.category + (p.hasImage === 1 ? " has-photo" : "")}>
        <ProductImage product={p} alt={p[lang]} />
        {p.hasImage !== 1 && (p.category === "vegetarian" ? <Leaf size={40} /> : <ChefHat size={40} />)}
        <span className="portal-dish-chip">{t(p.category)}</span>
        <button type="button" className="portal-info-button" aria-label={t("dishInfo") + " · " + p[lang]} onClick={showInfo}>
          <Info size={20} />
        </button>
        {inCart > 0 && <span className="portal-dish-count">{inCart}</span>}
      </div>
      <div className="portal-dish-body">
        <h3>{p[lang]}</h3>
        {description && <p className="portal-dish-desc">{description}</p>}
        <div className="portal-dish-meta">
          <span>{p.portion} {portionUnit(p.category)}</span>
          <span className={"portal-availability" + (p.remaining <= 5 ? " low" : "")}>
            {soldOut ? t("portalUnavailable") : t("menuRemaining") + ": " + p.remaining}
          </span>
          <button type="button" className="portal-info-link" onClick={showInfo}>
            {t("allergens")} · {t("ingredientList")}
          </button>
        </div>
        <div className="portal-dish-buy">
          <strong>{money(p.price)}</strong>
          {inCart > 0 ? (
            <div className="portal-stepper" role="group" aria-label={p[lang]}>
              <button type="button" aria-label={t("portalDecrease") + " · " + p[lang]} disabled={disabled} onClick={remove}>
                <Minus size={18} />
              </button>
              <span aria-live="polite">{inCart}</span>
              <button type="button" aria-label={t("portalIncrease") + " · " + p[lang]} disabled={disabled || !canAdd} onClick={add}>
                <Plus size={18} />
              </button>
            </div>
          ) : (
            <button type="button" className="portal-add" disabled={disabled || !canAdd} onClick={add}>
              <Plus size={20} />
              {t("portalAdd")}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** A nap menüje a portálon (v49): leves + főétel + desszert egy áron. */
export type MenuSetOffer = { price: number; priceRevision: number; soup: MenuProduct; main: MenuProduct; dessert: MenuProduct; remaining: number };

/** Napi menü kártya: a három étel (mindegyikhez „i” gomb), a menüár és a kosár gomb vagy darabszámláló. */
export function SetCard({
  set,
  lang,
  t,
  money,
  inCart,
  canAdd,
  disabled,
  add,
  remove,
  showInfo,
}: {
  set: MenuSetOffer;
  lang: Language;
  t: (k: string) => string;
  money: (n: number) => string;
  inCart: number;
  canAdd: boolean;
  disabled: boolean;
  add: () => void;
  remove: () => void;
  showInfo: (productId: string) => void;
}) {
  const parts: [string, MenuProduct][] = [
    ["soup", set.soup],
    ["main", set.main],
    ["dessert", set.dessert],
  ];
  return (
    <article className={"portal-dish portal-set" + (inCart ? " in-cart" : "")}>
      <div className="portal-set-head">
        <span className="portal-dish-chip static">{t("dailyMenu")}</span>
        <h3>{t("dailyMenuTitle")}</h3>
        {inCart > 0 && <span className="portal-dish-count">{inCart}</span>}
      </div>
      <ul className="portal-set-parts">
        {parts.map(([category, p]) => (
          <li key={category}>
            <small>{t(category)}</small>
            <span>
              {p[lang]} <em>· {p.portion} {portionUnit(p.category)}</em>
            </span>
            <button type="button" className="portal-info-button static" aria-label={t("dishInfo") + " · " + p[lang]} onClick={() => showInfo(p.id)}>
              <Info size={18} />
            </button>
          </li>
        ))}
      </ul>
      <div className="portal-dish-body">
        <div className="portal-dish-meta">
          <span className={"portal-availability" + (set.remaining <= 5 ? " low" : "")}>
            {set.remaining <= 0 ? t("portalUnavailable") : t("menuRemaining") + ": " + set.remaining}
          </span>        </div>
        <div className="portal-dish-buy">
          <strong>{money(set.price)}</strong>
          {inCart > 0 ? (
            <div className="portal-stepper" role="group" aria-label={t("dailyMenu")}>
              <button type="button" aria-label={t("portalDecrease") + " · " + t("dailyMenu")} disabled={disabled} onClick={remove}>
                <Minus size={18} />
              </button>
              <span aria-live="polite">{inCart}</span>
              <button type="button" aria-label={t("portalIncrease") + " · " + t("dailyMenu")} disabled={disabled || !canAdd} onClick={add}>
                <Plus size={18} />
              </button>
            </div>
          ) : (
            <button type="button" className="portal-add" disabled={disabled || !canAdd} onClick={add}>
              <Plus size={20} />
              {t("portalAdd")}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** Felugró ablak: kép, leírás, összetevők, allergének, tápérték. */
export function DishInfoDialog({
  product: p,
  lang,
  t,
  money,
  close,
}: {
  product: MenuProduct;
  lang: Language;
  t: (k: string) => string;
  money: (n: number) => string;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  const description = lang === "hu" ? p.descriptionHu : p.descriptionRo;
  return (
    <dialog
      ref={ref}
      className="portal-info-dialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className={"portal-info-hero " + p.category + (p.hasImage === 1 ? " has-photo" : "")}>
        <ProductImage product={p} alt={p[lang]} />
        {p.hasImage !== 1 && (p.category === "vegetarian" ? <Leaf size={48} /> : <ChefHat size={48} />)}
        <button type="button" className="portal-info-close" aria-label={t("close")} onClick={close}>
          <X size={22} />
        </button>
      </div>
      <div className="portal-info-content">
        <p className="portal-dish-chip static">{t(p.category)}</p>
        <h2>{p[lang]}</h2>
        {description && <p>{description}</p>}
        <p className="portal-info-facts">
          <strong>{money(p.price)}</strong>
          <span>{p.portion} {portionUnit(p.category)}</span>
        </p>
        <div className="portal-allergen-chips">
          <strong>{t("allergens")}:</strong>
          {p.allergens ? p.allergens.split(",").map((a) => <span key={a}>{t(a)}</span>) : <span className="none">{t("noAllergens")}</span>}
        </div>
        <PublicDishInfoView info={p.info} lang={lang} t={t} open />
      </div>
    </dialog>
  );
}
