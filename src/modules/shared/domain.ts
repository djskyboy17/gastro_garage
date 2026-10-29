export type Language = "hu" | "ro";
export type Product = {
  id: string;
  hu: string;
  ro: string;
  descriptionHu: string;
  descriptionRo: string;
  category: string;
  price: number;
  portion: number;
  allergens: string;
  active: number;
};
export type Customer = {
  id: string;
  name: string;
  address: string;
  phone: string;
  note: string;
};
export type Item = {
  id: string;
  orderId: string;
  productId: string;
  hu: string;
  ro: string;
  allergens: string;
  quantity: number;
  price: number;
};
export type Order = {
  id: string;
  customerId: string;
  customerName: string;
  address: string;
  phone: string;
  date: string;
  time: string;
  note: string;
  production: string;
  delivery: string;
  payment: string;
  status: string;
  revision: number;
  createdAt: string;
  items: Item[];
};
export type Audit = {
  id: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
  createdAt: string;
};
export type AppData = {
  products: Product[];
  customers: Customer[];
  orders: Order[];
  audit: Audit[];
};
export function today() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Bucharest",
  }).format(new Date());
}
export function total(order: Pick<Order, "items">) {
  return order.items.reduce((s, i) => s + i.price * i.quantity, 0);
}
export function portions(order: Pick<Order, "items">) {
  return order.items.reduce((s, i) => s + i.quantity, 0);
}
export function kitchenSummary(orders: Order[]) {
  const result = new Map<
    string,
    {
      productId: string;
      hu: string;
      ro: string;
      allergens: string;
      quantity: number;
      ready: number;
    }
  >();
  for (const o of orders.filter((o) => o.status !== "cancelled"))
    for (const i of o.items) {
      const key = JSON.stringify([i.productId, i.hu, i.ro, i.allergens]);
      const row = result.get(key) ?? {
        productId: i.productId,
        hu: i.hu,
        ro: i.ro,
        allergens: i.allergens,
        quantity: 0,
        ready: 0,
      };
      row.quantity += i.quantity;
      if (o.production === "ready") row.ready += i.quantity;
      result.set(key, row);
    }
  return [...result.values()].sort((a, b) => b.quantity - a.quantity);
}
export function nextState(order: Order, field: string, value: string) {
  if (order.status === "cancelled") throw new Error("CANCELLED");
  const allowed: Record<string, Record<string, string[]>> = {
    production: { queued: ["cooking"], cooking: ["ready"], ready: [] },
    delivery: {
      pending: ["transit"],
      transit: ["delivered", "failed"],
      failed: ["transit"],
      delivered: [],
    },
    payment: { unpaid: ["paid"], paid: [] },
    status: { confirmed: ["cancelled"] },
  };
  if (!allowed[field]?.[order[field as keyof Order] as string]?.includes(value))
    throw new Error("INVALID_TRANSITION");
  if (
    field === "delivery" &&
    value === "transit" &&
    order.production !== "ready"
  )
    throw new Error("NOT_READY");
  if (
    field === "status" &&
    value === "cancelled" &&
    (order.production !== "queued" || order.delivery !== "pending")
  )
    throw new Error("ALREADY_STARTED");
  return { ...order, [field]: value, revision: order.revision + 1 };
}
export function normalizeSearch(v: string) {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}
