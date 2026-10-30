"use client";
import { useEffect, useState } from "react";
import { messages } from "@/src/modules/shared/i18n";
import type { Language } from "@/src/modules/shared/domain";
import type { PublicLabel } from "@/src/modules/labels/domain";
import { LabelBody } from "./consumer-label";

/** A címke QR-kódja ezt nyitja meg: termékinformáció bejelentkezés nélkül, magyarul és románul. */
export function PublicLabelPage() {
  const [lang, setLang] = useState<Language>("ro"),
    [label, setLabel] = useState<PublicLabel | null>(null),
    [error, setError] = useState(false);
  const t = (k: string) => messages[lang][k] ?? k;
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id") ?? "";
    void (async () => {
      try {
        const r = await fetch("/api/public/label?id=" + encodeURIComponent(id), { cache: "no-store" });
        if (!r.ok) throw Error();
        if (navigator.language.toLowerCase().startsWith("hu")) setLang("hu");
        setLabel((await r.json()) as PublicLabel);
      } catch {
        setError(true);
      }
    })();
  }, []);
  return (
    <div className="public-label-page">
      <header>
        <img src="/logo.png" alt="Gastro-Garage" width={96} height={96} />
        <div className="language-switch" aria-label={t("language")}>
          {(["hu", "ro"] as const).map((l) => (
            <button key={l} className={lang === l ? "selected" : ""} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      <main className="panel public-label">
        <p className="eyebrow">{t("labelPageTitle")}</p>
        {error ? <p role="alert">{t("labelPageNotFound")}</p> : label ? <LabelBody label={label} lang={lang} t={t} /> : <p role="status">{t("loading")}</p>}
      </main>
    </div>
  );
}
