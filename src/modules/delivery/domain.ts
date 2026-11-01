import type { Order } from "../shared/domain";
export type DeliveryEvent = {
  id: string; orderId: string; kind: string; detail: string; actor: string; createdAt: string;
};
/** v51: egyetlen futár van; futártörzs, napi beosztás és hozzárendelés nincs. */
export type DeliveryData = { events: DeliveryEvent[] };
export const emptyDelivery: DeliveryData = { events: [] };
export function canAssign(order: Pick<Order, "status" | "delivery"|"fulfillmentMode">) {
  return order.fulfillmentMode!=="pickup" && order.status === "confirmed" && ["pending", "failed"].includes(order.delivery);
}
/** Az adott nap kiszállításai időrendben (egy futár van, ezért futár szerinti szűrés nincs). */
export function deliveryList(orders: Order[], day: string, state: string) {
  return orders.filter(o => o.fulfillmentMode!=="pickup" && o.date === day && o.status === "confirmed")
    .filter(o => state === "all" || (state === "open" ? o.delivery !== "delivered" : o.delivery === state))
    .sort((a,b) => a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
/** Kiszállításból helyszíni átvétel: új pillanatkép, díj és cím. A díjról a felhasználó dönt. */
export function pickupSwitch<S extends Record<string, unknown>>(
  snapshot: S | null,
  policy: { pickupHu: string; pickupRo: string },
  currentFee: number,
  removeFee: boolean,
) {
  const fee = removeFee ? 0 : currentFee;
  const address = [...new Set([policy.pickupHu, policy.pickupRo].filter(Boolean))].join(" / ");
  return {
    fee,
    address,
    snapshot: { ...((snapshot ?? {}) as S), mode: "pickup", slotId: "", zoneHu: "", zoneRo: "", postalCode: "", addressHu: policy.pickupHu, addressRo: policy.pickupRo, fee },
  };
}
