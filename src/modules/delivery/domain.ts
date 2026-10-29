import type { Order } from "../shared/domain";
export type Courier = {
  id: string; name: string; phone: string; vehicle: string; note: string; createdAt: string;
};
export type DeliveryEvent = {
  id: string; orderId: string; kind: string; detail: string; actor: string; createdAt: string;
};
export type DeliveryData = { couriers: Courier[]; events: DeliveryEvent[] };
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
