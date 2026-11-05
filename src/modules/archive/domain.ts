/**
 * Bizonylat-archívum (v82) – tiszta függvények: R2-kulcs, partner- és számegyszerűsítés, fájlkiterjesztés.
 * Kulcs: archive/{ÉÉÉÉ}/{HH}/{PARTNER}/{TÍPUS}_{SZÁM}_{rövid azonosító}.{kiterjesztés}
 */

export const ARCHIVE_TYPES = [
  "SUPPLIER_INVOICE",
  "SUPPLIER_RECEIPT",
  "NIR",
  "BON_CONSUM",
  "AVIZ",
  "PV_CASARE",
  "BON_PREDARE",
  "REGISTRU_CASA",
] as const;
export type ArchiveType = (typeof ARCHIVE_TYPES)[number];
export const OWN_PARTNER = "GASTRO-GARAGE";

/** Ékezet és különleges karakter nélküli, nagybetűs, kötőjeles változat (max. hossz), üres helyett „NA”. */
export function slug(value: string, max = 40) {
  const s = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s || "NA";
}

/** A partner mappaneve: a CUI (RO előtaggal vagy anélkül), ha van; különben az egyszerűsített név; saját bizonylatnál GASTRO-GARAGE. */
export function partnerKey(taxId: string, name: string) {
  const cui = taxId.toUpperCase().replace(/[\s.\-:]/g, "");
  if (/^(RO)?\d{2,10}$/.test(cui)) return cui;
  return name.trim() ? slug(name) : OWN_PARTNER;
}

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "text/html": "html",
  "text/html; charset=utf-8": "html",
  "application/xml": "xml",
  "application/zip": "zip",
};
export const extFor = (mime: string) => EXT[mime.toLowerCase()] ?? "bin";

/** Az archívum-kulcs. A dátum (ÉÉÉÉ-HH-NN) adja az év/hónap mappát; az azonosító első 8 karaktere teszi egyedivé. */
export function archiveKey(input: { type: ArchiveType; number: string; issueDate: string; partner: string; id: string; mime: string; version?: number }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) throw new Error("ARCHIVE_DATE");
  const [year, month] = input.issueDate.split("-") as [string, string];
  const number = slug(input.number, 50) + (input.version && input.version > 1 ? "-V" + input.version : "");
  const short = input.id.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "x";
  return `archive/${year}/${month}/${slug(input.partner, 40)}/${input.type}_${number}_${short}.${extFor(input.mime)}`;
}

/** SHA-256 hexben (a feltöltés ellenőrzéséhez és a duplikátum felismeréséhez). */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
