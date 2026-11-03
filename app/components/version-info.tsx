"use client";
import { useEffect, useState } from "react";
import { messages } from "@/src/modules/shared/i18n";
import type { Language } from "@/src/modules/shared/domain";

type VersionData = { version: string; commit: string; builtAt: string };

/** A futó változat a Beállítások alján (v71): így mindig látszik, melyik commit fut élesben. */
export function VersionInfo({ lang }: { lang: Language }) {
  const [data, setData] = useState<VersionData | null>(null);
  useEffect(() => {
    let ignore = false;
    fetch("/api/version", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<VersionData>) : null))
      .then((d) => {
        if (!ignore && d) setData(d);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, []);
  if (!data) return null;
  const t = (k: string) => messages[lang][k] ?? k;
  return (
    <p className="version-info">
      {t("appVersion")}: <strong>{data.version || t("appVersionLocal")}</strong>
      {data.commit && <> · {data.commit}</>}
      {data.builtAt && <> · {data.builtAt}</>}
    </p>
  );
}
