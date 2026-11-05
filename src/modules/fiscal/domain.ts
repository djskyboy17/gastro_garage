import type { ExpectedPaymentMethod, FiscalReceiptState } from "../shared/domain.ts";

export type FiscalMode = "simulation" | "live";
export type FiscalLine = { productId: string | null; name: string; unitBani: number; quantity: number };
export type FiscalJob = {
  version: 2; jobId: string; orderId: string; day: string; expiresAt: string;
  token: string; deviceSerial: string; method: "cash" | "card"; totalBani: number; lines: FiscalLine[];
};
export type FiscalReceipt = {
  id: string; orderId: string; mode: FiscalMode; state: FiscalReceiptState; revision: number;
  day: string; method: "cash" | "card"; total: number; deviceSerial: string; receiptNumber: string;
  expiresAt: string; createdAt: string; completedAt: string; resolution: string;
};
export type FiscalSettings = { mode: FiscalMode; deviceSerial: string; revision: number };
export type FiscalOrderView = { collectionDeferred: boolean; expectedPaymentMethod: ExpectedPaymentMethod; revision: number; settings: FiscalSettings; receipts: FiscalReceipt[] };
export type FiscalDayView = {
  settings: FiscalSettings; isAdmin: boolean; totals: { cash: number; card: number; total: number; count: number };
  z: { cash: number; card: number; total: number } | null;
  unresolved: FiscalReceipt[]; simulations: number;
};

export function receiptLines(lines: FiscalLine[], deliveryFee: number) {
  const result = lines.map((line) => ({ ...line }));
  if (deliveryFee > 0) result.push({ productId: null, name: "Livrare", unitBani: deliveryFee, quantity: 1 });
  const total = result.reduce((sum, line) => sum + line.unitBani * line.quantity, 0);
  if (!Number.isSafeInteger(deliveryFee) || deliveryFee < 0 || !result.length || result.length > 50 ||
      result.some((line) => !line.name.trim() || line.name.length > 200 || !Number.isInteger(line.unitBani) || line.unitBani < 1 ||
        !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 9999) ||
      !Number.isSafeInteger(total) || total < 1 || total > 100_000_000) throw new Error("FISCAL_LINES");
  return { lines: result, total };
}

/** Correlates an operator-imported local result; it is not a hardware attestation. */
export async function matchesReceiptToken(expected: string, actual: string) {
  const encoder = new TextEncoder(), algorithm = { name: "HMAC", hash: "SHA-256" };
  const [expectedKey, actualKey] = await Promise.all([
    crypto.subtle.importKey("raw", encoder.encode(expected), algorithm, false, ["sign"]),
    crypto.subtle.importKey("raw", encoder.encode(actual), algorithm, false, ["verify"]),
  ]);
  const data = encoder.encode("GastroGarage fiscal result v2");
  return crypto.subtle.verify("HMAC", actualKey, await crypto.subtle.sign("HMAC", expectedKey, data), data);
}
