import { env } from "cloudflare:workers";
import { DOCUMENT_TYPES, documentYear, seriesKey, formatDocumentNumber, type DocumentType } from "./domain";

/**
 * Sorszám foglalása egy D1-kötegen belül (v71).
 *
 * Használat: a visszaadott `statements`-et a bizonylatot beszúró utasítások ELÉ kell tenni ugyanabba az `env.DB.batch`-be,
 * a bizonylat számát pedig a `numberSql` részlettel (és a `numberBinds` paraméterekkel) kell beírni, pl.
 *   INSERT INTO nir_documents (id, series, number, …) VALUES (?, ?, ${numberSql}, …)
 * A köteg egy tranzakció: ha bármi elbukik, a számláló sem nő – így a sorozat hézag nélküli.
 */
export function allocateDocumentNumber(type: DocumentType, day: string, now = new Date().toISOString()) {
  const year = documentYear(day),
    key = seriesKey(type, year);
  return {
    key,
    year,
    statements: [
      env.DB!.prepare("INSERT INTO document_series (key,doc_type,year,prefix,next_number,updated_at) VALUES (?,?,?,?,1,?) ON CONFLICT(key) DO NOTHING").bind(key, type, year, DOCUMENT_TYPES[type], now),
      env.DB!.prepare("UPDATE document_series SET next_number=next_number+1,updated_at=? WHERE key=?").bind(now, key),
    ],
    /** A most foglalt szám (a növelés után a sorozatban next_number-1). */
    numberSql: "(SELECT next_number-1 FROM document_series WHERE key=?)",
    numberBinds: [key],
  };
}

/** Egy sorozat előtagja (a kiíráshoz); ha még nincs sorozat, az alapértelmezett. */
export async function seriesPrefix(type: DocumentType, year: number): Promise<string> {
  const row = await env.DB!.prepare("SELECT prefix FROM document_series WHERE key=?").bind(seriesKey(type, year)).first<{ prefix: string }>();
  return row?.prefix ?? DOCUMENT_TYPES[type];
}

/** Kiírt sorszám egy tárolt (típus, év, szám) hármasból. */
export async function documentNumberText(type: DocumentType, year: number, number: number) {
  return formatDocumentNumber(await seriesPrefix(type, year), year, number);
}
