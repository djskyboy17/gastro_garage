import { InvoiceError } from "./domain.ts";

/**
 * Gemini-adapter (v65): a számla képét vagy PDF-jét elküldi a Google Gemini REST API-nak, és a modell JSON-válaszát adja vissza.
 * A kulcs csak szerveroldalon él (Cloudflare secret: GEMINI_API_KEY). A hívás nem adatbázis-tranzakción belül történik.
 * Az eredményt mindig embernek kell ellenőriznie: nincs automatikus bevételezés.
 */
/** v67: a 2.5-ös Flash új felhasználóknak már nem elérhető; a Google a 3.8-as Flasht ajánlja (felülírható: GEMINI_MODEL). */
export const GEMINI_MODEL = "gemini-3.8-flash";
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

/**
 * A Gemini-kérés törzse (külön, hogy tesztelhető legyen).
 * v68: a Gemini 3 modellek alapból sokat „gondolkodnak” – a számla kiolvasásához alacsony szint elég, és sokkal gyorsabb.
 */
export function geminiRequestBody(mime: string, base64: string, lowThinking = true) {
  return {
    contents: [{ role: "user", parts: [{ text: INVOICE_PROMPT }, { inline_data: { mime_type: mime, data: base64 } }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: INVOICE_SCHEMA, ...(lowThinking ? { thinkingConfig: { thinkingLevel: "low" } } : {}) },
  };
}

/** Pótmodell, ha a beállított modell nem érhető el (404): a Google mindig a legújabb Flash modellre irányítja. */
export const GEMINI_FALLBACK_MODEL = "gemini-flash-latest";
/** v69: további pótmodell túlterheléskor – a kisebb Flash-Lite külön kapacitáson fut, gyorsabb. */
export const GEMINI_LITE_MODEL = "gemini-flash-lite-latest";

/** A Google hibaválaszának rövid leírása a naplóba (a kulcs soha nincs benne: az csak a kérés fejlécében megy). */
async function googleError(response: Response) {
  try {
    const body = (await response.json()) as { error?: { status?: string; message?: string } };
    return [body.error?.status, body.error?.message?.slice(0, 300)].filter(Boolean).join(": ");
  } catch {
    return "";
  }
}

/**
 * Meghívja a Geminit, és a válasz JSON-objektumát adja vissza. Hiba esetén `InvoiceError` (a kulcs soha nem kerül a hibaüzenetbe).
 * v66: ha a modell nem érhető el (404), egyszer a pótmodellel; ha a Google túlterhelt (500/503), egy rövid szünet után még egyszer próbál.
 * v68: ha a modell nem ismeri a gondolkodási beállítást (400), egyszer nélküle; időtúllépés: INVOICE_AI_TIMEOUT.
 * v69: modellsor (beállított → gemini-flash-latest → gemini-flash-lite-latest): 404-nél azonnal, túlterhelésnél (500/503)
 * egy újrapróbálás után a következő modell jön. Ha mind túlterhelt: INVOICE_AI_BUSY.
 * v70: összesen legfeljebb 40 másodperc (alacsony gondolkodással egy számla kb. 5 mp).
 * A Google hibakódja és üzenete a Worker naplójába kerül (`wrangler tail`).
 */
export async function extractWithGemini({ apiKey, mime, base64, model = GEMINI_MODEL, fetchImpl = fetch, timeoutMs = 40_000, retryDelayMs = 1500 }: GeminiInput & { retryDelayMs?: number }): Promise<unknown> {
  if (!apiKey) throw new InvoiceError("INVOICE_AI_DISABLED", 503);
  const started = Date.now(),
    deadline = started + timeoutMs;
  const models = [...new Set([model, GEMINI_FALLBACK_MODEL, GEMINI_LITE_MODEL])];
  let index = 0,
    current = models[0]!,
    retried = false,
    lowThinking = true,
    response: Response | null = null;
  const next = () => {
    if (index + 1 >= models.length) return false;
    current = models[++index]!;
    retried = false;
    return true;
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    const body = JSON.stringify(geminiRequestBody(mime, base64, lowThinking));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, deadline - Date.now()));
    try {
      response = await fetchImpl(ENDPOINT + encodeURIComponent(current) + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      console.warn("gemini fetch failed", current, e instanceof Error ? e.name + " " + e.message.slice(0, 200) : "");
      throw new InvoiceError(e instanceof Error && e.name === "AbortError" ? "INVOICE_AI_TIMEOUT" : "INVOICE_AI_UNAVAILABLE", 502);
    } finally {
      clearTimeout(timer);
    }
    if (response.ok) {
      // v68: mennyi ideig tartott (a naplóban látszik, gyorsítás méréséhez).
      console.log("gemini ok", current, Math.round((Date.now() - started) / 100) / 10 + " s", lowThinking ? "low thinking" : "default thinking");
      break;
    }
    const detail = await googleError(response);
    console.warn("gemini error", current, response.status, detail);
    if (response.status === 400 && lowThinking && /thinking/i.test(detail)) {
      lowThinking = false;
      continue;
    }
    if (response.status === 404) {
      if (next()) continue;
      break;
    }
    if ((response.status === 500 || response.status === 503) && deadline - Date.now() > retryDelayMs + 5000) {
      if (!retried) {
        retried = true;
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      if (next()) continue;
    }
    break;
  }
  if (!response) throw new InvoiceError("INVOICE_AI_UNAVAILABLE", 502);
  if (response.status === 429 || response.status === 503) throw new InvoiceError("INVOICE_AI_BUSY", 503);
  if (response.status === 400 || response.status === 401 || response.status === 403) throw new InvoiceError("INVOICE_AI_REJECTED", 502);
  if (response.status === 404) throw new InvoiceError("INVOICE_AI_MODEL", 502);
  if (!response.ok) throw new InvoiceError("INVOICE_AI_UNAVAILABLE", 502);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new InvoiceError("INVOICE_AI_INVALID", 502);
  }
  const candidate = (payload as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] })?.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) {
    console.warn("gemini empty answer", current, candidate?.finishReason ?? "no candidate");
    throw new InvoiceError(candidate?.finishReason === "SAFETY" ? "INVOICE_AI_REJECTED" : "INVOICE_AI_INVALID", 502);
  }
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    console.warn("gemini non-json answer", current, text.slice(0, 120));
    throw new InvoiceError("INVOICE_AI_INVALID", 502);
  }
}
