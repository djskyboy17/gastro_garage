"use client";
import { useEffect, useRef } from "react";
import { ChefHat, Leaf, X } from "lucide-react";
import { portionUnit, type Language } from "@/src/modules/shared/domain";
import type { PublicProduct } from "@/src/modules/portal/domain";
import { PublicDishInfoView } from "./dish-info";
import { ProductImage } from "./product-image";

type MenuProduct = PublicProduct & { remaining: number };

/** A nap menüje a portálon (v49, v54): leves + főétel egy áron. */
export type MenuSetOffer = { price: number; priceRevision: number; soup: MenuProduct; main: MenuProduct; remaining: number };

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
