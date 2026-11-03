/**
 * Bizonylat-sorszámozás (v71) – közös alap a NIR, a bon de consum, az aviz, a számla és a chitanță számára.
 * Bizonylattípusonként és évenként egy sorozat (pl. NIR-2026-0001); a szám a bizonylattal egy tranzakcióban fogy,
 * ezért hézag nélküli. Végleges bizonylat nem törölhető és nem módosítható, csak sztornózható.
 */

/** Ismert bizonylattípusok és alapértelmezett előtagjuk. [ELLENŐRIZENDŐ] a könyvelővel – az előtag sorozatonként átírható. */
export const DOCUMENT_TYPES = {
  nir: "NIR",
  consumption: "BC",
  delivery_note: "AVZ",
  invoice: "FCT",
  receipt: "CHT",
  write_off: "PVC",
  /** v74: bon de predare (kész étel átadása a készletbe). [ELLENŐRIZENDŐ] a könyvelővel. */
  handover: "BP",
} as const;
export type DocumentType = keyof typeof DOCUMENT_TYPES;

export function isDocumentType(value: string): value is DocumentType {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_TYPES, value);
}

/** A bizonylat éve a román naptári nap szerint (a hívó Europe/Bucharest szerinti napot ad: YYYY-MM-DD). */
export function documentYear(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("DOCUMENT_DATE");
  return Number(day.slice(0, 4));
}

/** A sorozat kulcsa: típus + év (pl. „nir:2026”). Évente újrakezdődik. */
export const seriesKey = (type: DocumentType, year: number) => `${type}:${year}`;

/** Sorszám kiírása: előtag-év-négyjegyű szám, pl. „NIR-2026-0001”. 9999 fölött is működik (NIR-2026-10000). */
export function formatDocumentNumber(prefix: string, year: number, number: number): string {
  if (!Number.isInteger(number) || number < 1) throw new Error("DOCUMENT_NUMBER");
  return `${prefix}-${year}-${String(number).padStart(4, "0")}`;
}

/** Előtag ellenőrzése (ha később átírható lesz): 1–10 nagybetű, szám vagy kötőjel. */
export const validPrefix = (prefix: string) => /^[A-Z0-9][A-Z0-9-]{0,9}$/.test(prefix);
