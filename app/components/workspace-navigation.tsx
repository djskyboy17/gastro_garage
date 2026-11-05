"use client";
import { ChevronDown, type LucideIcon } from "lucide-react";
import type { Language } from "@/src/modules/shared/domain";
import { messages } from "@/src/modules/shared/i18n";

type Entry = { id: string; label: string; Icon: LucideIcon; active: boolean; count?: number };
const daily = new Set(["overview", "orders", "kitchen", "packing", "delivery", "inventory", "procurement", "cash"]);

export default function WorkspaceNavigation({ entries, lang, onNavigate }: { entries: Entry[]; lang: Language; onNavigate: (id: string) => void }) {
  const t = (key: string) => messages[lang][key] ?? key;
  const primary = entries.filter((entry) => daily.has(entry.id));
  const secondary = entries.filter((entry) => !daily.has(entry.id) && entry.id !== "settings");
  const settings = entries.filter((entry) => entry.id === "settings");
  const item = ({ id, label, Icon, active, count }: Entry) => <button key={id} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={() => onNavigate(id)}>
    <Icon size={19} /><span>{messages[lang]["simpleNav_" + id] ?? label}</span>{!!count && <span className="nav-count">{count}</span>}
  </button>;
  return <nav className="workspace-navigation" aria-label={t("workspace")}>
    {primary.map(item)}
    {!!secondary.length && <details className="workspace-nav-more" open={secondary.some((entry) => entry.active) || undefined}>
      <summary><ChevronDown size={17} /><span>{t("simpleMoreFeatures")}</span></summary>
      <div>{secondary.map(item)}</div>
    </details>}
    {settings.map(item)}
  </nav>;
}
