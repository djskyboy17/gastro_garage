"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Banknote, CreditCard, Check, Plus, Minus, Trash2, Loader2, UtensilsCrossed } from "lucide-react";
import { CustomerPicker, type CustomerChoice } from "./customer-picker";
import { TimeInput24 } from "./time-input";
import { messages } from "@/src/modules/shared/i18n";
import { SET_CART_ID, type AppData, type Language } from "@/src/modules/shared/domain";
import type { BillingMode } from "@/src/modules/billing/domain";
import { menuSetError, type MenuData } from "@/src/modules/menu/domain";

export type OrderEntryPayload = {
  id: string; customerId?: string; newCustomer?: { name: string; address: string; phone: string };
  date: string; time: string; note: string; expectedPaymentMethod: "" | "cash" | "card";
  items: { productId: string; quantity: number }[]; menuRevision?: { day: number; price: number };
};
export default function OrderEntryForm({ data, lang, orderId, initialDate, busy, error, onCancel, onSave }: {
  data: AppData; lang: Language; orderId: string; initialDate: string; busy: boolean; error: string;
  onCancel: () => void; onSave: (body: OrderEntryPayload) => Promise<boolean>;
}) {
  const t = (key: string) => messages[lang][key] ?? key;
  const money = (bani: number) => (bani / 100).toLocaleString(lang === "hu" ? "hu-HU" : "ro-RO", { style: "currency", currency: "RON" });
  const [method, setMethod] = useState<"cash" | "card" | "">("");
  const [customer, setCustomer] = useState<CustomerChoice>(null);
  const [date, setDate] = useState(initialDate), [time, setTime] = useState("12:00"), [note, setNote] = useState("");
  const [menu, setMenu] = useState<MenuData | null>(null), [menuError, setMenuError] = useState(""), [menuRefresh, setMenuRefresh] = useState(0);
  const [menuQuantity, setMenuQuantity] = useState(1), [menuSelected, setMenuSelected] = useState(false), [lines, setLines] = useState<{ key: string; productId: string; quantity: number }[]>([]);
  const [validation, setValidation] = useState("");
  const [billing, setBilling] = useState<{ customerId: string; mode: BillingMode } | null>(null);
  const [billingError, setBillingError] = useState(""), [billingRefresh, setBillingRefresh] = useState(0);
  const customerId = customer?.mode === "existing" ? customer.id : "";
  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController(); setBillingError("");
    void (async () => {
      try {
        const response = await fetch("/api/billing/customer-mode?customerId=" + encodeURIComponent(customerId), { cache: "no-store", signal: controller.signal });
        const result = await response.json() as { mode: BillingMode; error?: string };
        if (!response.ok) throw new Error(result.error ?? "loadError");
        if (!controller.signal.aborted) setBilling({ customerId, mode: result.mode });
      } catch (e) { if (!controller.signal.aborted) setBillingError((e as Error).message); }
    })();
    return () => controller.abort();
  }, [customerId, billingRefresh]);
  const billingReady = !customerId || billing?.customerId === customerId;
  const invoiceMode = billingReady && customerId && billing?.mode !== "receipt" ? billing?.mode : null;
  const needsMethod = !!customer && billingReady && !invoiceMode;
  const paymentReady = billingReady && (!!invoiceMode || !!method);
  useEffect(() => {
    const controller = new AbortController(); setMenuError("");
    void (async () => {
      try {
        const response = await fetch("/api/menu", { cache: "no-store", signal: controller.signal });
        const result = await response.json() as MenuData & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "loadError");
        if (!controller.signal.aborted) setMenu(result);
      } catch (e) { if (!controller.signal.aborted) setMenuError((e as Error).message); }
    })();
    return () => controller.abort();
  }, [menuRefresh]);
  const day = menu?.days.find((day) => day.date === date);
  const soup = data.products.find((product) => product.id === day?.setSoupId);
  const main = data.products.find((product) => product.id === day?.setMainId);
  const hasMenu = !!(menu && day?.active && soup && main && menu.settings.setPrice > 0 &&
    !menuSetError({ soupId: soup.id, mainId: main.id }, data.products, menu.lines.filter((line) => line.date === date).map((line) => line.productId)));
  const conflict = lines.some((line) => !!line.productId && [soup?.id, main?.id].includes(line.productId));
  const invalidQuantity = menuSelected && (!Number.isInteger(menuQuantity) || menuQuantity < 1 || menuQuantity > 1000);
  const menuInvalid = menuSelected && (!hasMenu || conflict || invalidQuantity);
  const total = (hasMenu && menuSelected ? menuQuantity * menu!.settings.setPrice : 0) + lines.reduce((sum, line) => sum + (data.products.find((product) => product.id === line.productId)?.price ?? 0) * line.quantity, 0);
  const noItems = !menuSelected && !lines.some((line) => !!line.productId);
  const footerHint = !customer ? t("CUSTOMER_MISSING") : menuInvalid ? t(invalidQuantity ? "orderQuantityHint" : "orderMenuUnavailable") : noItems ? t("orderChooseItems") : "";
  const lineLimit = menuSelected ? 48 : 50;
  function addLine() { setLines((current) => [...current, { key: crypto.randomUUID(), productId: "", quantity: 1 }]); }
  function changeLine(key: string, patch: Partial<{ productId: string; quantity: number }>) { setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line)); }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return;
    if (!customer) { setValidation("CUSTOMER_MISSING"); return; }
    if (noItems || menuInvalid) { setValidation(menuInvalid ? "orderMenuUnavailable" : "orderChooseItems"); return; }
    if (!paymentReady) { setValidation("orderChoosePayment"); return; }
    setValidation("");
    await onSave({ id: orderId, ...(customer.mode === "existing" ? { customerId: customer.id } : { newCustomer: { name: customer.name, address: customer.address, phone: customer.phone } }), date, time, note,
      expectedPaymentMethod: invoiceMode ? "" : method, items: [...(menuSelected ? [{ productId: SET_CART_ID, quantity: menuQuantity }] : []), ...lines.map(({ productId, quantity }) => ({ productId, quantity }))],
      ...(menuSelected && day && menu ? { menuRevision: { day: day.revision, price: menu.settings.revision } } : {}),
    });
  }
  return <form className="order-entry-form" onSubmit={(event) => void submit(event)}>
    <div className="order-entry-scroll">
        <div className="field"><span className="field-label">{t("customer")}</span><CustomerPicker customers={data.customers} t={t} value={customer} onChange={(value) => { setCustomer(value); setMethod(""); setBilling(null); setBillingError(""); setValidation(""); }} /></div>
        <div className="form-grid order-date-grid">
          <label className="field"><span>{t("date")}</span><input type="date" required value={date} disabled={busy} onChange={(event) => { setDate(event.target.value); setValidation(""); }} /></label>
          <label className="field"><span>{t("time")}</span><TimeInput24 required value={time} disabled={busy} onChange={setTime} /></label>
        </div>
        <section className="order-daily-section" aria-label={t("dailyMenu")}>
          <button type="button" className={"order-daily-button" + (menuSelected ? " selected" : "")} disabled={busy || !hasMenu || conflict || menuQuantity >= 1000 || lines.length > 48} aria-pressed={menuSelected} onClick={() => { if (menuSelected) setMenuQuantity((quantity) => Math.min(1000, (quantity || 0) + 1)); else { setMenuQuantity(1); setMenuSelected(true); } }}>
            <UtensilsCrossed size={26} aria-hidden="true" /><span><strong>{t("dailyMenu")}</strong>{hasMenu && <small>{soup![lang]} · {main![lang]}</small>}</span><span className="order-daily-price">{hasMenu ? money(menu!.settings.setPrice) : "—"}</span><Plus size={22} aria-hidden="true" />
          </button>
          {!menu && !menuError && <small role="status">{t("loading")}</small>}
          {(menuError || (menu && !hasMenu)) && <p className="order-menu-hint">{t(menuError || "orderMenuUnavailable")} <button type="button" className="text-button" disabled={busy} onClick={() => setMenuRefresh((value) => value + 1)}>{t("refresh")}</button></p>}
          {conflict && <p className="order-menu-hint">{t("orderMenuConflict")}</p>}
          {menuSelected && <div className="order-menu-quantity">
            <span>{t("orderMenuPortions")}</span><button type="button" className="icon-button" aria-label={t("orderLessMenu")} disabled={busy} onClick={() => { if (menuQuantity <= 1) { setMenuSelected(false); setMenuQuantity(1); } else setMenuQuantity((quantity) => quantity - 1); }}><Minus size={20} /></button>
            <input type="number" min="1" max="1000" step="1" required aria-label={t("orderMenuPortions")} value={menuQuantity || ""} disabled={busy} onChange={(event) => setMenuQuantity(Number(event.target.value))} />
            <button type="button" className="icon-button" aria-label={t("orderMoreMenu")} disabled={busy || menuQuantity >= 1000} onClick={() => setMenuQuantity((quantity) => quantity + 1)}><Plus size={20} /></button>
            <button type="button" className="icon-button" aria-label={t("orderRemoveMenu")} disabled={busy} onClick={() => { setMenuSelected(false); setMenuQuantity(1); }}><Trash2 size={18} /></button>
          </div>}
        </section>
        <section className="order-other-section"><h3>{t("orderOtherItems")}</h3>
          {lines.map((line) => <div className="order-entry-line" key={line.key}>
            <label className="field"><span>{t("items")}</span><select required value={line.productId} disabled={busy} onChange={(event) => changeLine(line.key, { productId: event.target.value })}><option value="" disabled>{t("chooseProduct")}</option>{data.products.filter((product) => product.id === line.productId || (product.active && !lines.some((other) => other.productId === product.id) && !(menuSelected && [soup?.id, main?.id].includes(product.id)))).map((product) => <option key={product.id} value={product.id}>{product[lang]} · {money(product.price)}</option>)}</select></label>
            <label className="field"><span>{t("quantity")}</span><input type="number" required min="1" max="1000" step="1" value={line.quantity || ""} disabled={busy} onChange={(event) => changeLine(line.key, { quantity: Number(event.target.value) })} /></label>
            <button type="button" className="icon-button" aria-label={t("deleteLine")} disabled={busy} onClick={() => setLines((current) => current.filter((other) => other.key !== line.key))}><Trash2 size={18} /></button>
          </div>)}
          <button type="button" className="button secondary order-add-item" disabled={busy || lines.length >= lineLimit || lines.length >= data.products.filter((product) => product.active).length} onClick={addLine}><Plus size={20} />{t("orderAddOtherItem")}</button>
        </section>
        <label className="field order-final-note"><span>{t("note")}</span><textarea value={note} maxLength={1500} rows={2} disabled={busy} onChange={(event) => setNote(event.target.value)} /></label>
    </div>
    <div className="order-entry-footer">
      {(error || validation) && <p role="alert" className="order-entry-error">{t(error || validation)}{error === "MENU_PREVIEW_CHANGED" && <button type="button" className="text-button" onClick={() => setMenuRefresh((value) => value + 1)}>{t("refresh")}</button>}</p>}
      <div className="order-footer-total"><small>{footerHint}</small><strong>{t("amount")}: {menuInvalid ? "—" : money(total)}</strong></div>
      {customer && !billingReady && <p className="order-billing-hint" role="status">{billingError ? <>{t(billingError)} <button type="button" className="text-button" disabled={busy} onClick={() => setBillingRefresh((value) => value + 1)}>{t("refresh")}</button></> : t("loading")}</p>}
      {invoiceMode && <p className="order-billing-hint">{t("billingMode_" + invoiceMode)} · {t("orderInvoicePaymentSkipped")}</p>}
      {needsMethod && <fieldset className="order-entry-payment" disabled={busy}><legend>{t("expectedPaymentMethod")}</legend><div className="order-payment-choices">
        {(["card", "cash"] as const).map((value) => { const Icon = value === "card" ? CreditCard : Banknote; return <label key={value} className={"order-payment-choice" + (method === value ? " selected" : "")}>
          <input type="radio" name="expectedPaymentMethod" value={value} checked={method === value} required onChange={() => { setMethod(value); setValidation(""); }} />
          <Icon size={24} aria-hidden="true" /><strong>{t("payMethod_" + value)}</strong>{method === value && <Check size={20} aria-hidden="true" />}
        </label>; })}
      </div></fieldset>}
      <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={onCancel}>{t("cancel")}</button>
        <button type="submit" className="button" disabled={busy || !paymentReady || noItems || menuInvalid || !customer}>{busy ? <Loader2 size={20} className="spin" /> : <Check size={20} />}{t(busy ? "saving" : "orderContinue")}</button>
      </div>
    </div>
  </form>;
}
