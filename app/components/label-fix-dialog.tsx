"use client";
import { useEffect, useRef, useState } from "react";
import { Save, X } from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import type { Language } from "@/src/modules/shared/domain";
import { SHELF_LIFE_MAX, type LabelSettings, type MissingLabelData } from "@/src/modules/labels/domain";

type Row = { productId: string; shelfLifeDays: number | null; storageRo: string; storageHu: string };
type Data = { revision: number; settings: LabelSettings; products: Row[] };

/** Felugró ablak a Termékcímkék hiánylistájából: egy étel hiányzó címkeadatainak pótlása helyben. */
export function LabelFixDialog({
  productId,
  name,
  missing,
  lang,
  close,
  saved,
}: {
  productId: string;
  name: string;
  missing: MissingLabelData[];
  lang: Language;
  close: () => void;
  saved: () => void;
}) {
  const t = (k: string) => messages[lang][k] ?? k;
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const r = await fetch("/api/labels/settings", { cache: "no-store" }),
          d = (await r.json()) as Data & { error?: string };
        if (!r.ok) throw Error(d.error ?? "loadError");
        if (!ignore) setData(d);
      } catch (e) {
        if (!ignore) setError((e as Error).message);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);
  const row = data?.products.find((p) => p.productId === productId);
  const needsDish = missing.includes("shelfLife") || missing.includes("storage");
  const needsProducer = missing.includes("producer");
  const elsewhere = missing.filter((m) => m === "recipe" || m === "nutrition");
  const setting = (k: keyof LabelSettings, v: string) => data && setData({ ...data, settings: { ...data.settings, [k]: v } });
  const setRow = (patch: Partial<Row>) =>
    data && setData({ ...data, products: data.products.map((p) => (p.productId === productId ? { ...p, ...patch } : p)) });
  const complete =
    !!data &&
    (!missing.includes("shelfLife") || row?.shelfLifeDays != null) &&
    (!missing.includes("storage") || !!(row?.storageRo || data.settings.defaultStorageRo)) &&
    (!needsProducer || (!!data.settings.producerName.trim() && !!data.settings.producerAddress.trim()));
  async function save() {
    if (!data || !row) return;
    setBusy(true);
    setError("");
    try {
      // Csak ezt az egy ételt küldjük: a többi étel adata változatlan marad.
      const r = await fetch("/api/labels/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: data.revision,
          settings: data.settings,
          products: [{ productId: row.productId, shelfLifeDays: row.shelfLifeDays, storageRo: row.storageRo, storageHu: row.storageHu }],
        }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(d.error ?? "saveError");
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const input = (label: string, value: string, onChange: (v: string) => void, max = 300, placeholder?: string) => (
    <label className="field">
      <span>{label}</span>
      <input value={value} maxLength={max} placeholder={placeholder} disabled={busy} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
  return (
    <dialog
      ref={ref}
      className="modal label-fix-dialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-header">
        <h2>{t("labelFixTitle")}</h2>
        <button className="icon-button" aria-label={t("close")} onClick={close}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-content">
        <p className="label-fix-dish">{name}</p>
        {!data && !error && <p role="status">{t("loading")}</p>}
        {data && !row && <p role="alert" className="portal-alert">{t("labelFixInactive")}</p>}
        {data && row && (
          <>
            {needsDish && (
              <fieldset className="label-fix-group">
                <legend>{t("labelFixDish")}</legend>
                <label className="field">
                  <span>{t("labelShelfLifeDays")}</span>
                  <input
                    type="number"
                    min={0}
                    max={SHELF_LIFE_MAX}
                    step={1}
                    value={row.shelfLifeDays ?? ""}
                    disabled={busy}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : Math.max(0, Math.min(SHELF_LIFE_MAX, Math.round(Number(e.target.value))));
                      setRow({ shelfLifeDays: v === null || Number.isNaN(v) ? null : v });
                    }}
                  />
                  <small>{t("labelShelfLifeHint")}</small>
                </label>
                {input(t("labelStorageRo"), row.storageRo, (v) => setRow({ storageRo: v }), 300, data.settings.defaultStorageRo || undefined)}
                {input(t("labelStorageHu"), row.storageHu, (v) => setRow({ storageHu: v }), 300, data.settings.defaultStorageHu || undefined)}
              </fieldset>
            )}
            {needsProducer && (
              <fieldset className="label-fix-group">
                <legend>{t("labelFixProducer")}</legend>
                {input(t("labelProducerName"), data.settings.producerName, (v) => setting("producerName", v), 200)}
                {input(t("labelProducerAddress"), data.settings.producerAddress, (v) => setting("producerAddress", v))}
                {input(t("labelProducerExtra"), data.settings.producerExtra, (v) => setting("producerExtra", v), 200)}
              </fieldset>
            )}
          </>
        )}
        {elsewhere.length > 0 && (
          <p className="label-fix-elsewhere">
            {elsewhere.map((m) => t("labelMissing_" + m)).join(", ")}: {t("labelFixElsewhere")}
          </p>
        )}
        {error && <p role="alert" className="portal-alert">{t(error)}</p>}
        <div className="form-actions">
          <button className="button secondary" onClick={close}>
            {t("cancel")}
          </button>
          {(needsDish || needsProducer) && (
            <button className="button" disabled={busy || !complete || !row} onClick={() => void save()}>
              <Save size={16} />
              {t("labelFixSave")}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
