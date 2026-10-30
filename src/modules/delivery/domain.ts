import type { Order } from "../shared/domain";
export type Courier = {
  id: string; name: string; phone: string; vehicle: string; note: string; createdAt: string;
};
export type DeliveryEvent = {
  id: string; orderId: string; kind: string; detail: string; actor: string; createdAt: string;
};
/** Napi beosztás (v36): az adott napon dolgozó futár. */
export type CourierShift = { date: string; courierId: string };
export type DeliveryData = { couriers: Courier[]; events: DeliveryEvent[]; shifts?: CourierShift[] };
export const emptyDelivery: DeliveryData = { couriers: [], events: [] };
export function canAssign(order: Pick<Order, "status" | "delivery"|"fulfillmentMode">) {
  return order.fulfillmentMode!=="pickup" && order.status === "confirmed" && ["pending", "failed"].includes(order.delivery);
}
export function deliveryList(orders: Order[], day: string, courier: string, state: string) {
  return orders.filter(o => o.fulfillmentMode!=="pickup" && o.date === day && o.status === "confirmed")
    .filter(o => courier === "all" || (courier === "unassigned" ? !o.courierId : o.courierId === courier))
    .filter(o => state === "all" || (state === "open" ? o.delivery !== "delivered" : o.delivery === state))
    .sort((a,b) => a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Az adott napra beosztott futárok, a futárlista sorrendjében. */
export function shiftCouriers<C extends { id: string }>(couriers: C[], shifts: CourierShift[], date: string): C[] {
  const on = new Set(shifts.filter((s) => s.date === date).map((s) => s.courierId));
  return couriers.filter((c) => on.has(c.id));
}
/** Javasolt futár: a beosztottak közül akinek aznap a legkevesebb nyitott kiszállítása van (egyenlőségnél a lista sorrendje). */
export function suggestCourier(onShift: { id: string }[], orders: Pick<Order, "date" | "courierId" | "delivery" | "status">[], date: string): string | null {
  let best: string | null = null, load = Infinity;
  for (const c of onShift) {
    const n = orders.filter((o) => o.date === date && o.courierId === c.id && o.status === "confirmed" && o.delivery !== "delivered").length;
    if (n < load) { best = c.id; load = n; }
  }
  return best;
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
