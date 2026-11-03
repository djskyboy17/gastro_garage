import { InvoiceError } from "./domain.ts";

/**
 * Gemini-adapter (v65): a számla képét vagy PDF-jét elküldi a Google Gemini REST API-nak, és a modell JSON-válaszát adja vissza.
 * A kulcs csak szerveroldalon él (Cloudflare secret: GEMINI_API_KEY). A hívás nem adatbázis-tranzakción belül történik.
 * Az eredményt mindig embernek kell ellenőriznie: nincs automatikus bevételezés.
 */
export const GEMINI_MODEL = "gemini-2.5-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/";

export const INVOICE_PROMPT = `You extract data from ONE Romanian purchase document: a "Factură" (invoice) or a "Bon fiscal" (cash register receipt).
Return ONLY JSON matching the schema. Never invent values: use null when a value is not printed or not readable.

Rules:
- document_type: "factura" or "bon_fiscal".
- supplier_* is the SELLER (Furnizor / Vânzător / the shop on a bon fiscal), never the buyer (Cumpărător / Client).
- supplier_tax_id: the seller's CUI / CIF / Cod fiscal exactly as printed, keep the "RO" prefix if present.
- series and number: the invoice series (Seria) and number (Nr.) as printed, keep leading zeros. For a bon fiscal use the receipt number (BF / Nr. bon) and leave series null.
- issue_date: the document date as YYYY-MM-DD (Romanian dates are DD.MM.YYYY).
- Amounts: write them as plain decimal strings with a dot and no thousands separators, e.g. "1234.56". Romanian documents use a decimal comma ("1.234,56" means 1234.56).
- subtotal = total without VAT (Total fără TVA / Baza impozabilă); vat_total = printed VAT total (TVA); total = amount to pay (Total de plată / TOTAL).
- vat_rate per line as a percentage number string, e.g. "21", "11", "9", "19", "5", "0". On a bon fiscal VAT letters (A, B, C...) refer to the VAT table printed at the bottom: resolve them to the percentage.
- lines: every purchased item in printed order. description as printed; quantity as a decimal string; unit as printed (kg, g, l, ml, buc, ...).
  For each line give line_net (value without VAT) and/or line_gross (value with VAT) only if printed; unit_price if printed. On a bon fiscal prices are usually with VAT: use line_gross.
- SGR deposit (garanție SGR / ambalaj SGR, 0.50 RON per bottle or can) is NOT a product: list each SGR line with is_deposit=true, and put their sum in sgr_total. If there is no SGR, sgr_total is "0".
- Discounts (reducere / discount) are separate lines with negative values.
- currency: ISO code, normally "RON".`;

const amount = { type: "STRING", nullable: true };
export const INVOICE_SCHEMA = {
  type: "OBJECT",
  properties: {
    document_type: { type: "STRING", enum: ["factura", "bon_fiscal"] },
    supplier_name: { type: "STRING", nullable: true },
    supplier_tax_id: { type: "STRING", nullable: true },
    series: { type: "STRING", nullable: true },
    number: { type: "STRING", nullable: true },
    issue_date: { type: "STRING", nullable: true },
    currency: { type: "STRING", nullable: true },
    subtotal: amount,
    vat_total: amount,
    sgr_total: amount,
    total: amount,
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING" },
          quantity: amount,
          unit: { type: "STRING", nullable: true },
          unit_price: amount,
          line_net: amount,
          vat_rate: amount,
          line_gross: amount,
          is_deposit: { type: "BOOLEAN" },
        },
        required: ["description", "is_deposit"],
      },
    },
  },
  required: ["document_type", "lines"],
};

export type GeminiInput = {
  apiKey: string;
  mime: string;
  base64: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** A Gemini-kérés törzse (külön, hogy tesztelhető legyen). */
export function geminiRequestBody(mime: string, base64: string) {
  return {
    contents: [{ role: "user", parts: [{ text: INVOICE_PROMPT }, { inline_data: { mime_type: mime, data: base64 } }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: INVOICE_SCHEMA },
  };
}

/** Meghívja a Geminit, és a válasz JSON-objektumát adja vissza. Hiba esetén `InvoiceError` (a kulcs soha nem kerül a hibaüzenetbe). */
export async function extractWithGemini({ apiKey, mime, base64, model = GEMINI_MODEL, fetchImpl = fetch, timeoutMs = 55_000 }: GeminiInput): Promise<unknown> {
  if (!apiKey) throw new InvoiceError("INVOICE_AI_DISABLED", 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT + encodeURIComponent(model) + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(geminiRequestBody(mime, base64)),
      signal: controller.signal,
    });
  } catch {
    throw new InvoiceError("INVOICE_AI_UNAVAILABLE", 502);
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 429) throw new InvoiceError("INVOICE_AI_BUSY", 503);
  if (response.status === 400 || response.status === 401 || response.status === 403) throw new InvoiceError("INVOICE_AI_REJECTED", 502);
  if (!response.ok) throw new InvoiceError("INVOICE_AI_UNAVAILABLE", 502);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new InvoiceError("INVOICE_AI_INVALID", 502);
  }
  const candidate = (payload as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] })?.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new InvoiceError(candidate?.finishReason === "SAFETY" ? "INVOICE_AI_REJECTED" : "INVOICE_AI_INVALID", 502);
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new InvoiceError("INVOICE_AI_INVALID", 502);
  }
}
