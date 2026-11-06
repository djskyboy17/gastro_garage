"use client";
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import type { Language } from "@/src/modules/shared/domain";
import { SHELF_LIFE_MAX, type LabelSettings } from "@/src/modules/labels/domain";

type Row = { productId: string; hu: string; ro: string; shelfLifeDays: number | null; storageRo: string; storageHu: string };
type Data = { revision: number; settings: LabelSettings; products: Row[] };

export default function LabelsWorkspace({ lang }: { lang: Language }) {
  const t = (k: string) => messages[lang][k] ?? k;
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
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
  }, [version]);
  if (!data) return error ? <p role="alert" className="portal-alert">{t(error)}</p> : <p role="status">{t("loading")}</p>;
  const setting = (k: keyof LabelSettings, v: string | boolean) => setData({ ...data, settings: { ...data.settings, [k]: v } });
  const row = (id: string, patch: Partial<Row>) =>
    setData({ ...data, products: data.products.map((p) => (p.productId === id ? { ...p, ...patch } : p)) });
  async function save() {
    if (!data) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const r = await fetch("/api/labels/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: data.revision,
          settings: data.settings,
          products: data.products.map(({ productId, shelfLifeDays, storageRo, storageHu }) => ({ productId, shelfLifeDays, storageRo, storageHu })),
        }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(d.error ?? "saveError");
      setSaved(true);
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const field = (k: Exclude<keyof LabelSettings, "printDetails">, max: number) => (
    <label className="field">
      <span>{t("label" + k[0]!.toUpperCase() + k.slice(1))}</span>
      <input value={data.settings[k]} maxLength={max} disabled={busy} onChange={(e) => setting(k, e.target.value)} />
    </label>
  );
  return (
    <section className="labels-workspace" aria-label={t("labels")}>
      <p className="packing-intro">{t("labelSettingsIntro")}</p>
      <div className="panel labels-producer">
        <div className="form-grid">
          {field("producerName", 200)}
          {field("producerAddress", 300)}
          {field("producerExtra", 200)}
          {field("defaultStorageRo", 300)}
          {field("defaultStorageHu", 300)}
          <label className="production-check">
            <input type="checkbox" checked={data.settings.printDetails} disabled={busy} onChange={(e) => setting("printDetails", e.target.checked)} />
            {t("labelPrintDetails")}
          </label>
        </div>
      </div>
      <h2 className="settings-section-title">{t("labelDishes")}</h2>
      <p className="packing-hint">{t("labelShelfLifeHint")}</p>
      <div className="panel packing-table-wrap">
        <table className="packing-table labels-table">
          <thead>
            <tr>
              <th>{t("packingDish")}</th>
              <th>{t("labelShelfLifeDays")}</th>
              <th>{t("labelStorageRo")}</th>
              <th>{t("labelStorageHu")}</th>
            </tr>
          </thead>
          <tbody>
            {data.products.map((p) => (
              <tr key={p.productId}>
                <td>
                  <strong>{p[lang]}</strong>
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={SHELF_LIFE_MAX}
                    step={1}
                    aria-label={t("labelShelfLifeDays") + " – " + p[lang]}
                    value={p.shelfLifeDays ?? ""}
                    placeholder="2"
                    disabled={busy}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : Math.max(0, Math.min(SHELF_LIFE_MAX, Math.round(Number(e.target.value))));
                      row(p.productId, { shelfLifeDays: v === null || Number.isNaN(v) ? null : v });
                    }}
                  />
                </td>
                <td>
                  <input aria-label={t("labelStorageRo") + " – " + p[lang]} maxLength={300} placeholder={t("labelStorageDefaultPlaceholder")} value={p.storageRo} disabled={busy} onChange={(e) => row(p.productId, { storageRo: e.target.value })} />
                </td>
                <td>
                  <input aria-label={t("labelStorageHu") + " – " + p[lang]} maxLength={300} placeholder={t("labelStorageDefaultPlaceholder")} value={p.storageHu} disabled={busy} onChange={(e) => row(p.productId, { storageHu: e.target.value })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p role="alert" className="portal-alert">{t(error)}</p>}
      {saved && <p role="status" className="portal-success">{t("labelSaved")}</p>}
      <button className="button" disabled={busy} onClick={() => void save()}>
        <Save size={16} />
        {t("labelSave")}
      </button>
    </section>
  );
}
