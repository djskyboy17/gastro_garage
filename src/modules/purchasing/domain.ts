export type Supplier = {
  id: string;
  name: string;
  taxId: string;
  address: string;
  email: string;
  phone: string;
  note: string;
};
export type PurchaseLine = {
  id: string;
  purchaseId: string;
  ingredientId: string;
  hu: string;
  ro: string;
  unit: string;
  quantity: number;
  received: number;
  packQuantity: number;
  packPrice: number;
};
export type PurchaseOrder = {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierTaxId: string;
  supplierAddress: string;
  due: string;
  note: string;
  status: string;
  revision: number;
  createdAt: string;
  lines: PurchaseLine[];
};
export type PurchaseEvent = {
  id: string;
  purchaseId: string;
  kind: string;
  detail: string;
  actor: string;
  createdAt: string;
};
export type PurchasingData = {
  suppliers: Supplier[];
  orders: PurchaseOrder[];
  events: PurchaseEvent[];
};
export const emptyPurchasing: PurchasingData = {
  suppliers: [],
  orders: [],
  events: [],
};
export function purchasePhase(p: PurchaseOrder) {
  if (p.status !== "ordered") return p.status;
  if (p.lines.length && p.lines.every((l) => l.received === l.quantity))
    return "received";
  return p.lines.some((l) => l.received > 0) ? "partial" : "ordered";
}
export function inboundSupply(data: PurchasingData, date: string) {
  return data.orders
    .filter((p) => p.status === "ordered" && p.due <= date)
    .flatMap((p) =>
      p.lines
        .filter((l) => l.quantity > l.received)
        .map((l) => ({
          ingredientId: l.ingredientId,
          quantity: l.quantity - l.received,
        })),
    );
}
export function purchaseTransition(p: PurchaseOrder, action: string) {
  const phase = purchasePhase(p);
  if (action === "confirm" && phase === "draft") return "ordered";
  if (action === "cancel" && ["draft", "ordered"].includes(phase))
    return "cancelled";
  if (action === "close" && phase === "partial") return "closed";
  throw new Error("PURCHASE_TRANSITION");
}
export function purchaseValue(lines: PurchaseLine[]) {
  return lines.reduce(
    (sum, l) =>
      sum +
      Number(
        (BigInt(l.quantity) * BigInt(l.packPrice) +
          BigInt(l.packQuantity) -
          1n) /
          BigInt(l.packQuantity),
      ),
    0,
  );
}
