export type Language = "hu" | "ro";
export function nextStocktakeState(status:string,action:'post'|'cancel'|'reverse'){
  if(status==='draft'&&action==='post')return 'posted';
  if(status==='draft'&&action==='cancel')return 'cancelled';
  if(status==='posted'&&action==='reverse')return 'reversed';
  throw Error('STOCKTAKE_STATE');
}
export type Product = {
  hasImage?:number;
  imageRevision?:number;
  portalVisible?:number;
  portalRevision?:number;
  id: string;
  hu: string;
  ro: string;
  descriptionHu: string;
  descriptionRo: string;
  category: string;
  /** v49: "daily" = Napi menü rész, "alacarte" = Étlap. */
  section?: string;
  price: number;
  portion: number;
  allergens: string;
  active: number;
};
/** Katalógus-részek (v49). A Napi menü részben csak leves, főétel és desszert lehet. */
export const SECTIONS = ["daily", "alacarte"] as const;
export const DAILY_CATEGORIES = ["soup", "main", "dessert"] as const;
export const CATEGORIES = ["soup", "main", "vegetarian", "dessert"] as const;
/** Adag mértékegysége: levesnél ml, minden másnál g (v49). */
export const portionUnit = (category: string) => (category === "soup" ? "ml" : "g");
/** A napi menü tételeinek jelölése a rendelésben, és a kosárban a menü azonosítója. */
export const SET_GROUP = "napi_menu";
export const SET_CART_ID = "@napi_menu";
/**
 * A menüár szétosztása a három tételre (bani, egész): a főétel és a desszert az ár harmadát kapja lefelé kerekítve,
 * a leves a maradékot. Az összeg mindig pontosan a menüár, így a rendelés és a számla végösszege helyes.
 */
export function splitSetPrice(price: number): [soup: number, main: number, dessert: number] {
  const third = Math.floor(price / 3);
  return [price - 2 * third, third, third];
}
/** Rendelési tételek megjelenítéshez: a napi menü tételei egy sorba vonva, a többi változatlanul. */
export type DisplayLine<T extends { setGroup?: string; quantity: number; price: number }> =
  | { kind: "set"; quantity: number; total: number; items: T[] }
  | { kind: "item"; item: T };
export function groupSetItems<T extends { setGroup?: string; quantity: number; price: number }>(items: T[]): DisplayLine<T>[] {
  const set = items.filter((i) => i.setGroup === SET_GROUP);
  const rest: DisplayLine<T>[] = items.filter((i) => i.setGroup !== SET_GROUP).map((item) => ({ kind: "item", item }));
  if (!set.length) return rest;
  return [{ kind: "set", quantity: set[0]!.quantity, total: set.reduce((s, i) => s + i.quantity * i.price, 0), items: set }, ...rest];
}
export type Customer = {
  id: string;
  name: string;
  address: string;
  phone: string;
  note: string;
};
export type Item = {
  recipeId?: string | null;
  id: string;
  orderId: string;
  productId: string;
  hu: string;
  ro: string;
  allergens: string;
  quantity: number;
  price: number;
  /** 1, ha a konyha ezt a tételt már késznek jelölte (v20). */
  ready?: number;
  /** v49: "napi_menu", ha a tétel a napi menü része. */
  setGroup?: string;
};
export type Order = {
  packingItems?:string;
  packingReady?:number;
  packingCheckedAt?:string;
  fulfillmentMode?:string;
  fulfillmentSlotId?:string|null;
  fulfillmentPostalCode?:string;
  fulfillmentSnapshot?:string;
  deliveryFee?:number;
  portalUserId?:string|null;
  reviewNote?:string;
  courierName?: string;
  courierPhone?: string;
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
  recurring: import("../recurring/domain").RecurringData;
  safety: import("../safety/domain").SafetyData;
  logistics: import("../delivery/domain").DeliveryData;
  purchasing: import("../purchasing/domain").PurchasingData;
  operations: import("../inventory/domain").OperationsData;
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
export function total(order: Pick<Order, "items"|"deliveryFee">) {
  return order.items.reduce((s, i) => s + i.price * i.quantity, 0)+(order.deliveryFee??0);
}
export function portions(order: Pick<Order, "items"|"deliveryFee">) {
  return order.items.reduce((s, i) => s + i.quantity, 0);
}
export function orderCode(id:string) {
  const match=/^recurring:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/i.exec(id);
  return match?`R-${match[1].slice(0,6)}-${match[2].replaceAll("-","").slice(2)}`.toUpperCase():id.slice(-6).toUpperCase();
}
/** Egy tétel kész, ha a konyha külön késznek jelölte, vagy az egész rendelés már kész. */
export function itemReady(order: Pick<Order, "production">, item: Pick<Item, "ready">) {
  return order.production === "ready" || item.ready === 1;
}
export function readyPortions(order: Pick<Order, "production"|"items">) {
  return order.items.reduce((s, i) => s + (itemReady(order, i) ? i.quantity : 0), 0);
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
      /** Még elkészítendő adag. */
      remaining: number;
      /** Ellenőrzötten becsomagolt adag (v36: az adagterv az Áttekintésbe került). */
      packed: number;
      /** A még nem kész tételek azonosítói; a „Kész” gomb ezeket jelöli. */
      pendingItemIds: string[];
    }
  >();
  for (const o of orders.filter((o) => o.status === "confirmed"))
    for (const i of o.items) {
      const key = JSON.stringify([i.productId, i.hu, i.ro, i.allergens]);
      const row = result.get(key) ?? {
        productId: i.productId,
        hu: i.hu,
        ro: i.ro,
        allergens: i.allergens,
        quantity: 0,
        ready: 0,
        remaining: 0,
        packed: 0,
        pendingItemIds: [],
      };
      row.quantity += i.quantity;
      if (o.packingReady === 1) row.packed += i.quantity;
      if (itemReady(o, i)) row.ready += i.quantity;
      else {
        row.remaining += i.quantity;
        row.pendingItemIds.push(i.id);
      }
      result.set(key, row);
    }
  // Ami még hátra van, előre kerül; a teljesen kész ételek a végére.
  return [...result.values()].sort((a, b) => Number(a.remaining === 0) - Number(b.remaining === 0) || b.quantity - a.quantity);
}
export function canCheckPacking(order:Pick<Order,'status'|'production'|'delivery'>){return order.status==='confirmed'&&order.production==='ready'&&['pending','failed'].includes(order.delivery);}
export function nextState(order: Order, field: string, value: string) {
  if (order.status === "cancelled") throw new Error("CANCELLED");
  if (order.status === "rejected") throw new Error("REJECTED");
  if (order.status !== "confirmed" && field !== "status") throw new Error("ORDER_NOT_CONFIRMED");
  const allowed: Record<string, Record<string, string[]>> = {
    production: { queued: ["cooking"], cooking: ["ready"], ready: [] },
    delivery: {
      pending: ["transit"],
      transit: ["delivered", "failed"],
      failed: ["transit"],
      delivered: [],
    },
    payment: { unpaid: ["paid"], paid: [] },
    status: { requested:["confirmed","rejected","cancelled"], confirmed: ["cancelled"] },
  };
  if(order.fulfillmentMode==="pickup") {
    allowed.delivery={pending:["delivered"],delivered:[]};
    if(field==="delivery"&&value==="delivered"&&order.production!=="ready")throw new Error("NOT_READY");
  }
  if (!allowed[field]?.[order[field as keyof Order] as string]?.includes(value))
    throw new Error("INVALID_TRANSITION");
  if (
    field === "delivery" &&
    value === "transit" &&
    order.production !== "ready"
  )
    throw new Error("NOT_READY");
  if(field==='delivery'&&(value==='transit'||(order.fulfillmentMode==='pickup'&&value==='delivered'))&&order.packingReady!==1)throw Error('PACKING_REQUIRED');
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

/**
 * A rendelés egyetlen, követhető állapota a dolgozói listákban (v38), az ügyfélportál lépéssorához hasonlóan:
 * elfogadva → készül → elkészült → futárra vár / átvehető → úton → teljesítve.
 * A `step`/`steps` a kis lépésjelzőhöz kell; lezárt (elutasított, lemondott) rendelésnél 0.
 */
export type OrderStage = { key: string; badge: string; step: number; steps: number };
export function orderStage(o: Pick<Order, "status" | "production" | "delivery" | "fulfillmentMode" | "packingReady">): OrderStage {
  const pickup = o.fulfillmentMode === "pickup";
  const steps = pickup ? 5 : 6;
  if (o.status === "requested") return { key: "stageRequested", badge: "pending", step: 0, steps };
  if (o.status === "rejected" || o.status === "cancelled") return { key: o.status, badge: "cancelled", step: 0, steps };
  if (o.delivery === "delivered") return { key: "stageCompleted", badge: "delivered", step: steps, steps };
  if (!pickup && o.delivery === "transit") return { key: "stageTransit", badge: "transit", step: 5, steps };
  if (!pickup && o.delivery === "failed") return { key: "stageFailed", badge: "failed", step: 4, steps };
  if (o.production === "ready")
    return o.packingReady === 1
      ? { key: pickup ? "stagePickupReady" : "stageAwaitingCourier", badge: "ready", step: 4, steps }
      : { key: "stageReady", badge: "ready", step: 3, steps };
  if (o.production === "cooking") return { key: "stageCooking", badge: "cooking", step: 2, steps };
  return { key: "stageAccepted", badge: "confirmed", step: 1, steps };
}

/**
 * Az Áttekintés négy állapotkártyája (v39): rendelés, konyha, csomagolás, futár.
 * Szín: nincs kész semmi → narancs (todo), részben → sárga (progress), minden kész → zöld (done); üres nap → semleges.
 */
export type StatusLevel = "empty" | "todo" | "progress" | "done";
export type OverviewCard = { key: "orders" | "kitchen" | "packing" | "delivery"; done: number; total: number; level: StatusLevel; extra: number };
export function statusLevel(done: number, total: number): StatusLevel {
  if (total <= 0) return "empty";
  if (done <= 0) return "todo";
  return done >= total ? "done" : "progress";
}
export function overviewCards(dayOrders: Order[]): OverviewCard[] {
  const open = dayOrders.filter((o) => o.status !== "rejected" && o.status !== "cancelled");
  const confirmed = open.filter((o) => o.status === "confirmed");
  const shipped = (o: Order) => o.delivery === "transit" || o.delivery === "delivered";
  const deliveries = confirmed.filter((o) => o.fulfillmentMode !== "pickup");
  const card = (key: OverviewCard["key"], done: number, total: number, extra: number): OverviewCard => ({ key, done, total, level: statusLevel(done, total), extra });
  return [
    // Rendelés: visszaigazolt / összes nyitott; extra = visszaigazolásra vár.
    card("orders", confirmed.length, open.length, open.length - confirmed.length),
    // Konyha: elkészült adag / összes adag; extra = még elkészítendő adag.
    card("kitchen", confirmed.reduce((s, o) => s + readyPortions(o), 0), confirmed.reduce((s, o) => s + portions(o), 0), confirmed.reduce((s, o) => s + portions(o) - readyPortions(o), 0)),
    // Csomagolás: ellenőrzötten becsomagolt (vagy már elindult) rendelés / összes; extra = csomagolásra kész, de még nincs ellenőrizve.
    card("packing", confirmed.filter((o) => o.packingReady === 1 || shipped(o)).length, confirmed.length, confirmed.filter((o) => o.production === "ready" && o.packingReady !== 1 && !shipped(o)).length),
    // Futár: kézbesített / kiszállításos rendelés; extra = úton.
    card("delivery", deliveries.filter((o) => o.delivery === "delivered").length, deliveries.length, deliveries.filter((o) => o.delivery === "transit").length),
  ];
}
