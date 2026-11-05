"use client";
import { useCallback, useEffect, useState } from "react";
import { FileText, Printer, Undo2 } from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import type { Language } from "@/src/modules/shared/domain";
import type { DeliveryNoteRef } from "@/src/modules/delivery-notes/domain";

type NotesDay = {
  date: string;
  allDeliveries: boolean;
  vehicles?: string[];
  settingsRevision: number;
  canManage: boolean;
  canConfigure: boolean;
  orders: { id: string; code: string; time: string; customerName: string; mode: string; delivery: string; revision: number; flagged: boolean; required: boolean; issuable: boolean; notes: DeliveryNoteRef[] }[];
};

/**
 * Avizok a Csomagolás fülön (v75): rendelésenként „Aviz” gomb – az első megnyomás kiállítja és megnyitja nyomtatásra,
 * az ismételt ugyanazt nyitja meg. A nap összes avizja egyben is nyomtatható. Sztornó: iroda; beállítás: admin.
 */
export default function DeliveryNotesPanel({ lang, date }: { lang: Language; date: string }) {
  const t = (k: string) => (messages[lang] as Record<string, string>)[k] ?? k;
  const [data, setData] = useState<NotesDay | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [vehicle, setVehicle] = useState("");

  const load = useCallback(() => {
    fetch("/api/delivery-notes?date=" + encodeURIComponent(date), { cache: "no-store" })
      .then(async (r) => {
        const v = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((v as { error?: string }).error ?? "loadError");
        return v as NotesDay;
      })
      .then(
        (v) => {
          setData(v);
          setError("");
        },
        (e: Error) => setError(e.message),
      );
  }, [date]);
  useEffect(() => {
    load();
  }, [load]);

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/delivery-notes/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const v = (await r.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!r.ok) throw new Error(v.error ?? "saveError");
      load();
      return v;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function issue(orderId: string) {
    // Az ablakot a kattintásban nyitjuk meg (különben a böngésző letiltja), és a kiállítás után töltjük be.
    const win = window.open("", "_blank");
    const cars = data?.vehicles ?? [];
    const v = await post("issue", { orderId, ...(cars.length ? { vehicle: vehicle || cars[0] } : {}) });
    if (v?.id && win) win.location.href = "/api/delivery-notes/print?id=" + v.id;
    else win?.close();
  }

  const rows = data?.orders.filter((o) => o.required || o.notes.length) ?? [];
  const anyIssued = rows.some((o) => o.notes.some((n) => n.kind === "issue" && n.status === "issued"));
  return (
    <section className="panel notes-panel packing-no-print">
      <div className="panel-heading">
        <div>
          <h2>
            <FileText size={18} /> {t("notesTitle")}
          </h2>
          <p>{t("notesIntro")}</p>
        </div>
        <a className={"button secondary" + (anyIssued ? "" : " is-disabled")} aria-disabled={!anyIssued} href={anyIssued ? "/api/delivery-notes/print?date=" + date : undefined} target="_blank" rel="noreferrer">
          <Printer size={16} /> {t("notesPrintDay")}
        </a>
      </div>
      {error && (
        <p role="alert" className="portal-alert">
          {(messages[lang] as Record<string, string>)[error] ?? t("saveError")}
        </p>
      )}
      {data && (data.vehicles?.length ?? 0) > 1 && rows.length > 0 && (
        <label className="cash-field">
          {t("avizVehicle")}
          <select value={vehicle || data.vehicles![0]} disabled={busy} onChange={(e) => setVehicle(e.target.value)}>
            {data.vehicles!.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      )}
      {data && !rows.length && <p className="quiet-empty">{t("notesNone")}</p>}
      {rows.length > 0 && (
        <ul className="notes-list">
          {rows.map((o) => {
            const active = o.notes.find((n) => n.kind === "issue" && n.status === "issued");
            return (
              <li key={o.id}>
                <div>
                  <strong>
                    #{o.code} · {o.time} · {o.customerName}
                  </strong>
                  <span className="production-docs">
                    {o.notes.map((n) => (
                      <a key={n.id} href={"/api/delivery-notes/print?id=" + n.id} target="_blank" rel="noreferrer" className={n.status === "reversed" ? "is-reversed" : ""}>
                        <Printer size={13} /> {n.number}
                        {n.kind === "reversal" ? " (" + t("notesReversal") + ")" : ""}
                      </a>
                    ))}
                    {!o.required && !active && <small>{t("notesNotNeeded")}</small>}
                  </span>
                </div>
                <div className="production-actions">
                  {active ? (
                    <a className="button secondary" href={"/api/delivery-notes/print?id=" + active.id} target="_blank" rel="noreferrer">
                      <Printer size={15} /> {t("notesOpen")}
                    </a>
                  ) : (
                    o.required &&
                    o.issuable && (
                      <button className="button" disabled={busy} onClick={() => void issue(o.id)}>
                        <FileText size={15} /> {t("notesIssue")}
                      </button>
                    )
                  )}
                  {active && data?.canManage && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(t("notesReversePrompt"));
                        if (reason && reason.trim().length >= 3) void post("reverse", { id: active.id, reason: reason.trim() });
                      }}
                    >
                      <Undo2 size={15} /> {t("notesReverse")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** „Aviz kell” jelölés a rendelés részleteinél (iroda). */
export function DeliveryNoteFlag({ lang, orderId, revision, value, onSaved }: { lang: Language; orderId: string; revision: number; value: boolean; onSaved: () => void }) {
  const t = (k: string) => (messages[lang] as Record<string, string>)[k] ?? k;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <label className="notes-flag">
      <input
        type="checkbox"
        checked={value}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setError("");
          const r = await fetch("/api/delivery-notes/require", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, revision, required: e.target.checked }) });
          const v = (await r.json().catch(() => ({}))) as { error?: string };
          setBusy(false);
          if (!r.ok) setError(v.error ?? "saveError");
          else onSaved();
        }}
      />
      {t("notesRequiredFlag")}
      {error && <small className="production-short">{(messages[lang] as Record<string, string>)[error] ?? t("saveError")}</small>}
    </label>
  );
}

/** A közös avizszabály a Beállítások oldalon szerkeszthető. */
export function DeliveryNoteSettings({ lang }: { lang: Language }) {
  const t = (key: string) => messages[lang][key] ?? key;
  const [data, setData] = useState<NotesDay | null>(null), [all, setAll] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date());
        const response = await fetch('/api/delivery-notes?date=' + day, { cache: 'no-store', signal: controller.signal });
        const result = await response.json() as NotesDay & { error?: string };
        if (!response.ok) throw new Error(result.error ?? 'loadError');
        if (!controller.signal.aborted) { setData(result); setAll(result.allDeliveries); }
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    })();
    return () => controller.abort();
  }, []);
  async function save() {
    if (!data || busy) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const response = await fetch('/api/delivery-notes/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: data.settingsRevision, allDeliveries: all }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'saveError');
      setData({ ...data, allDeliveries: all, settingsRevision: data.settingsRevision + 1 }); setSaved(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className='panel aviz-settings' aria-label={t('avizSettingsTitle')}>
    <h3>{t('avizSettingsTitle')}</h3><p>{t('avizSettingsHint')}</p>
    {error && <p role='alert' className='portal-alert'>{t(error)}</p>}
    {saved && <p role='status' className='portal-success'>{t('avizSettingsSaved')}</p>}
    {!data && !error && <p role='status'>{t('loading')}</p>}
    {data?.canConfigure && <><label><input type='checkbox' checked={all} disabled={busy} onChange={(event) => { setAll(event.target.checked); setSaved(false); }} />{t('avizSettingsAll')}</label><button type='button' className='button' disabled={busy || all === data.allDeliveries} onClick={() => void save()}>{t('avizSettingsSave')}</button></>}
  </section>;
}
