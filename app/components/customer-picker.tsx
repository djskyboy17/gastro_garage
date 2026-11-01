"use client";
import { useMemo, useState } from "react";
import { Search, UserPlus, Check, X } from "lucide-react";
import { normalizeSearch, type AppData } from "@/src/modules/shared/domain";

type Customer = AppData["customers"][number];
/** v56: az új rendelés ügyfele – meglévő (azonosító) vagy helyben felvett új ügyfél. */
export type CustomerChoice = { mode: "existing"; id: string } | { mode: "new"; name: string; address: string; phone: string } | null;

const digits = (v: string) => v.replace(/\D/g, "");
const looksLikePhone = (v: string) => digits(v).length >= 4 && /^[\d\s+()/-]+$/.test(v.trim());

/**
 * Ügyfélválasztó a telefonos rendeléshez (v56): keresés név, cím vagy telefonszám alapján (ékezet és szóköz
 * nélkül is), vagy új ügyfél felvétele ugyanitt. Ha az új ügyfél telefonszáma már szerepel, felajánlja a meglévőt.
 */
export function CustomerPicker({ customers, t, value, onChange }: { customers: Customer[]; t: (k: string) => string; value: CustomerChoice; onChange: (v: CustomerChoice) => void }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = normalizeSearch(query.trim()), qd = digits(query);
    if (!q) return [];
    return customers
      .filter((c) => normalizeSearch(c.name + " " + c.address).includes(q) || (qd.length >= 3 && digits(c.phone).includes(qd)))
      .slice(0, 8);
  }, [customers, query]);
  const selected = value?.mode === "existing" ? customers.find((c) => c.id === value.id) : undefined;

  if (selected)
    return (
      <div className="customer-picked">
        <Check size={18} />
        <div>
          <strong>{selected.name}</strong>
          <span>{[selected.address, selected.phone].filter(Boolean).join(" · ")}</span>
        </div>
        <button type="button" className="text-button" onClick={() => onChange(null)}>{t("customerChange")}</button>
      </div>
    );

  if (value?.mode === "new") {
    const same = digits(value.phone).length >= 6 ? customers.find((c) => digits(c.phone) === digits(value.phone)) : undefined;
    const set = (patch: Partial<{ name: string; address: string; phone: string }>) => onChange({ ...value, ...patch });
    return (
      <div className="customer-new">
        <div className="customer-new-head">
          <strong><UserPlus size={17} /> {t("newCustomer")}</strong>
          <button type="button" className="text-button" onClick={() => onChange(null)}><X size={15} /> {t("customerBackToSearch")}</button>
        </div>
        <div className="form-grid">
          <label className="field"><span>{t("customerName")}</span><input required maxLength={200} value={value.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></label>
          <label className="field"><span>{t("phone")}</span><input type="tel" maxLength={40} value={value.phone} onChange={(e) => set({ phone: e.target.value })} /></label>
        </div>
        <label className="field"><span>{t("address")}</span><input required maxLength={500} value={value.address} onChange={(e) => set({ address: e.target.value })} /></label>
        {same && (
          <p className="customer-duplicate">
            {t("customerPhoneExists")}: <strong>{same.name}</strong>
            <button type="button" className="button secondary" onClick={() => onChange({ mode: "existing", id: same.id })}>{t("customerUseExisting")}</button>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="customer-search">
      <label className="search-box standalone customer-search-box">
        <Search size={17} />
        <input
          placeholder={t("customerSearchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("customerSearchPlaceholder")}
        />
      </label>
      {query.trim() && (
        <div className="customer-results" role="listbox" aria-label={t("customer")}>
          {matches.map((c) => (
            <button type="button" role="option" aria-selected={false} key={c.id} onClick={() => onChange({ mode: "existing", id: c.id })}>
              <strong>{c.name}</strong>
              <span>{[c.address, c.phone].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
          {!matches.length && <p className="customer-no-result">{t("customerNoResult")}</p>}
        </div>
      )}
      <button
        type="button"
        className="button secondary customer-add"
        onClick={() => onChange({ mode: "new", name: looksLikePhone(query) ? "" : query.trim(), address: "", phone: looksLikePhone(query) ? query.trim() : "" })}
      >
        <UserPlus size={16} /> {t("customerAddNew")}
      </button>
    </div>
  );
}
