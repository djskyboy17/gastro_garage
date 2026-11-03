// Fogyasztói címke (v32): az EU 1169/2011 szerinti adatok egy kiszállított adagra, QR-kóddal.
import type { InfoNode, Nutrition } from "../inventory/nutrition.ts";

export type LabelSettings = {
  /** Gyártó / forgalmazó neve, ahogy a címkén szerepel. */
  producerName: string;
  producerAddress: string;
  /** Szabad sor, pl. az ANSVSA-nyilvántartási szám. */
  producerExtra: string;
  /** Alapértelmezett tárolási feltétel, ha az ételnél nincs külön megadva. */
  defaultStorageRo: string;
  defaultStorageHu: string;
};
export const emptyLabelSettings: LabelSettings = {
  producerName: "",
  producerAddress: "",
  producerExtra: "",
  defaultStorageRo: "A se păstra la temperaturi între 0 și 4 °C.",
  defaultStorageHu: "0–4 °C között tárolandó.",
};
export const SHELF_LIFE_MAX = 60;

export function parseLabelSettings(content: string | null | undefined): LabelSettings {
  try {
    const v = JSON.parse(content ?? "") as Partial<LabelSettings>;
    const s = (x: unknown, d: string) => (typeof x === "string" ? x : d);
    return {
      producerName: s(v.producerName, ""),
      producerAddress: s(v.producerAddress, ""),
      producerExtra: s(v.producerExtra, ""),
      defaultStorageRo: s(v.defaultStorageRo, emptyLabelSettings.defaultStorageRo),
      defaultStorageHu: s(v.defaultStorageHu, emptyLabelSettings.defaultStorageHu),
    };
  } catch {
    return { ...emptyLabelSettings };
  }
}

/** Tételszám: gyártási nap + étel. Egy étel egy napi főzése egy tétel (lot). */
export function lotCode(date: string, productId: string): string {
  let h = 0x811c9dc5;
  for (const c of productId) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  const code = (h % 36 ** 4).toString(36).toUpperCase().padStart(4, "0");
  return `L${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}-${code}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** 2026-11-03 → 03.11.2026 (romániai írásmód). */
export function displayDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}
/** Századokban tárolt érték → „12,5” (vesszővel, legfeljebb egy tizedes). */
export function decimal(hundredths: number): string {
  const v = Math.round(hundredths / 10) / 10;
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace(".", ",");
}

export type LabelNode = { name: { hu: string; ro: string }; frozen: boolean; allergen: boolean; children?: LabelNode[] };
export function labelNodes(nodes: InfoNode[]): LabelNode[] {
  return nodes.map((n) => ({
    name: { hu: n.name.hu, ro: n.name.ro },
    frozen: n.frozen,
    allergen: (n.allergens?.length ?? 0) > 0,
    ...(n.children?.length ? { children: labelNodes(n.children) } : {}),
  }));
}
/** Összetevőlista szakaszokra bontva; a `bold` szakaszok az allergént tartalmazó összetevők. */
export function ingredientParts(nodes: LabelNode[], lang: "hu" | "ro"): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  nodes.forEach((n, i) => {
    if (i > 0) out.push({ text: ", ", bold: false });
    out.push({ text: n.name[lang] + (n.frozen ? "*" : ""), bold: n.allergen });
    if (n.children?.length) {
      out.push({ text: " (", bold: false });
      out.push(...ingredientParts(n.children, lang));
      out.push({ text: ")", bold: false });
    }
  });
  return out;
}
export function anyFrozen(nodes: LabelNode[]): boolean {
  return nodes.some((n) => n.frozen || anyFrozen(n.children ?? []));
}

export type MissingLabelData = "recipe" | "nutrition" | "shelfLife" | "storage" | "producer";
export type ConsumerLabel = {
  itemId: string;
  productId: string;
  orderCode: string;
  /** Ennyi példány kell (adagonként egy). */
  copies: number;
  name: { hu: string; ro: string };
  netGrams: number;
  /** A nettó mennyiség mértékegysége: levesnél ml, egyébként g (v49). */
  netUnit: "g" | "ml";
  ingredients: LabelNode[];
  allergens: string[];
  nutritionPer100g: Nutrition | null;
  frozen: boolean;
  productionDate: string;
  useBy: string | null;
  storage: { hu: string; ro: string };
  lot: string;
  producer: { name: string; address: string; extra: string };
  url: string;
  missing: MissingLabelData[];
};
export type PublicLabel = Omit<ConsumerLabel, "orderCode" | "copies" | "missing" | "url" | "productId">;

export function consumerLabel(input: {
  item: { id: string; productId: string; hu: string; ro: string; allergens: string; quantity: number };
  orderCode: string;
  date: string;
  netGrams: number;
  netUnit?: "g" | "ml";
  info: { ingredients: InfoNode[]; allergens: string[]; nutritionPer100g: Nutrition | null } | null;
  label: { shelfLifeDays: number; storageRo: string; storageHu: string } | null;
  settings: LabelSettings;
  baseUrl: string;
  /** v73: a gyártási tétel adatai (tételkód, fogyaszthatóság), ha van tétel. */
  batch?: { code: string; useBy: string | null } | null;
}): ConsumerLabel {
  const { item, info, label, settings } = input;
  const ingredients = info ? labelNodes(info.ingredients) : [];
  // A rendeléskor mentett allergének mindig rajta maradnak; a recept csak hozzáad.
  const allergens = [...new Set([...item.allergens.split(",").filter(Boolean), ...(info?.allergens ?? [])])].sort();
  const storage = {
    ro: label?.storageRo || settings.defaultStorageRo,
    hu: label?.storageHu || settings.defaultStorageHu,
  };
  const missing: MissingLabelData[] = [];
  if (!info) missing.push("recipe");
  else if (!info.nutritionPer100g) missing.push("nutrition");
  if (!label) missing.push("shelfLife");
  if (!storage.ro) missing.push("storage");
  if (!settings.producerName || !settings.producerAddress) missing.push("producer");
  return {
    itemId: item.id,
    productId: item.productId,
    orderCode: input.orderCode,
    copies: item.quantity,
    name: { hu: item.hu, ro: item.ro },
    netGrams: input.netGrams,
    netUnit: input.netUnit ?? "g",
    ingredients,
    allergens,
    nutritionPer100g: info?.nutritionPer100g ?? null,
    frozen: anyFrozen(ingredients),
    productionDate: input.date,
    useBy: input.batch?.useBy ?? (label ? addDays(input.date, label.shelfLifeDays) : null),
    storage,
    lot: input.batch?.code ?? lotCode(input.date, item.productId),
    producer: { name: settings.producerName, address: settings.producerAddress, extra: settings.producerExtra },
    url: `${input.baseUrl}/label?id=${encodeURIComponent(item.id)}`,
    missing,
  };
}
/** A QR-kóddal megnyitható, bárki által látható változat: rendelés, ügyfél és belső adat nélkül. */
export function toPublicLabel(l: ConsumerLabel): PublicLabel {
  return {
    itemId: l.itemId,
    name: l.name,
    netGrams: l.netGrams,
    netUnit: l.netUnit,
    ingredients: l.ingredients,
    allergens: l.allergens,
    nutritionPer100g: l.nutritionPer100g,
    frozen: l.frozen,
    productionDate: l.productionDate,
    useBy: l.useBy,
    storage: l.storage,
    lot: l.lot,
    producer: l.producer,
  };
}
