import type { AppData } from "../shared/domain";
import { orderCode } from "../shared/domain.ts";
export const staffRoles = ["admin", "dispatcher", "kitchen", "warehouse", "courier", "pending", "disabled"] as const;
/** Kiosztható szerepkörök (v41): külön raktáros nincs, a raktárt és a beszerzést a konyha végzi. A régi „warehouse” fiókok konyhaként működnek. */
export const assignableRoles = ["admin", "dispatcher", "kitchen", "courier", "pending", "disabled"] as const;
/** Konyha és a régi raktáros szerepkör: ugyanazok a jogok. */
export const isKitchenStaff = (role:Role) => role === "kitchen" || role === "warehouse";
export type Role = typeof staffRoles[number] | "owner";
export type Member = {userId:string;name:string;email:string;role:string;revision:number;createdAt:string};
export type Session = {userId:string;name:string;role:Role;canBootstrap:boolean};
export const isAdmin = (role:Role) => role === "owner" || role === "admin";
export const isMember = (role:Role) => ["owner","admin","dispatcher","kitchen","warehouse"].includes(role);
/** Ritkán használt, beállítás jellegű nézetek: a főmenü helyett a Beállítások oldalról nyílnak. */
export const settingsTabs = ["safety","fulfillment","portal","stocktake","labels","access","audit","accounting"] as const;
export const isSettingsTab = (tab:string) => (settingsTabs as readonly string[]).includes(tab);
export function tabsFor(role:Role): string[] {
  if (isAdmin(role)) return ["overview","orders","recurring","kitchen","packing","delivery","catalog","customers","menu","fulfillment","portal","recipes","inventory","stocktake","labels","procurement","cash","billing","archive","safety","audit","access","settings","accounting"];
  if (role === "dispatcher") return ["overview","orders","recurring","packing","delivery","catalog","customers","menu","fulfillment","portal","cash","billing","archive","settings"];
  // v41: a konyha látja mindazt, ami az Áttekintésben van, plusz a raktárt és a beszerzést.
  if (isKitchenStaff(role)) return ["overview","orders","kitchen","packing","delivery","recipes","inventory","stocktake","procurement","safety","settings"];
  return [];
}
export function canWrite(role:Role,path:string,body:unknown): boolean {
  const b = body && typeof body === "object" ? body as Record<string,unknown> : {};
  // Unknown endpoints are denied, even for admins; new modules must declare access.
  const known = ["/api/demo","/api/products","/api/products/section","/api/products/update","/api/products/delete","/api/customers","/api/orders","/api/orders/state","/api/delivery/to-pickup","/api/operations/demo","/api/operations/ingredients","/api/operations/recipes","/api/operations/ingredient-details","/api/operations/preparations","/api/operations/receive","/api/operations/waste","/api/operations/issue","/api/purchasing/suppliers","/api/purchasing/create","/api/purchasing/update","/api/purchasing/state","/api/purchasing/receive","/api/access/role"];
  if(path==="/api/products/image"||path==="/api/products/image/remove")return ["owner","admin","dispatcher"].includes(role);
  if(path==="/api/kitchen/ready")return isAdmin(role)||isKitchenStaff(role);
  if(path==="/api/labels/settings")return isAdmin(role);
  if(path==="/api/fulfillment/save")return isAdmin(role);
  // v65: számlák – mint a Beszerzés (admin és konyha/raktár); a bekerülési érték beállítása csak admin.
  if(path==="/api/invoices/settings"||path==="/api/invoices/reverse")return isAdmin(role);
  if(["/api/invoices/scan","/api/invoices/save","/api/invoices/receive","/api/invoices/discard"].includes(path))return isAdmin(role)||isKitchenStaff(role);
  const stocktakePaths=["/api/stocktake/create","/api/stocktake/save","/api/stocktake/refresh-line","/api/stocktake/post","/api/stocktake/reverse","/api/stocktake/cancel"];
  if(stocktakePaths.includes(path))return isAdmin(role)||(isKitchenStaff(role)&&!["/api/stocktake/post","/api/stocktake/reverse"].includes(path));
  const safetyPaths = ["/api/safety/points","/api/safety/records","/api/safety/resolve"];
  const recurringPaths = ["/api/menu/save","/api/menu/settings","/api/recurring/templates","/api/recurring/preview","/api/recurring/generate"];
  if (!known.includes(path) && !safetyPaths.includes(path) && !recurringPaths.includes(path)) return false;
  if (isAdmin(role)) return true;
  if (recurringPaths.includes(path)) return role === "dispatcher";
  if (safetyPaths.includes(path)) return isKitchenStaff(role) && path === "/api/safety/records";
  if (path === "/api/orders/state") return isKitchenStaff(role) ? b.field === "production" : role === "dispatcher" && ["delivery","payment","status"].includes(String(b.field));
  if (role === "dispatcher") return ["/api/orders","/api/products","/api/products/section","/api/products/update","/api/products/delete","/api/customers","/api/delivery/to-pickup"].includes(path);
  if (isKitchenStaff(role)) return path.startsWith("/api/purchasing/") || (path.startsWith("/api/operations/") && !path.endsWith("/demo"));
  return false;
}
export function projectData(data:AppData,role:Role): AppData {
  if (isAdmin(role)) return data;
  if(!isMember(role))return {...data,products:[],customers:[],orders:[],audit:[],recurring:{templates:[],occurrences:[]},safety:{points:[],records:[]},operations:{ingredients:[],recipes:[],lots:[],issues:[],moves:[],preparations:[],preparationVersions:[]},purchasing:{suppliers:[],orders:[],events:[]},logistics:{events:[]}};
  const sales = role === "dispatcher";
  const kitchen = isKitchenStaff(role);
  const stock = kitchen;
  // A konyha az Áttekintésben látott rendelési adatokat (név, tételek, összeg, fizetés, futár) teljes egészében látja (v41).
  const seesOrders = sales || kitchen;
  return {
    ...data,
    recurring:sales?data.recurring:{templates:[],occurrences:[]},
    safety:kitchen?data.safety:{points:[],records:[]},
    products:data.products.map(p => ({...p,price:seesOrders?p.price:0})),
    customers:sales?data.customers:[],
    orders:data.orders.filter(o=>seesOrders||o.status==="confirmed").map(o => seesOrders?o:({...o,deliveryFee:0,fulfillmentPostalCode:"",fulfillmentSnapshot:"",fulfillmentSlotId:null,portalUserId:null,reviewNote:"",customerId:"",customerName:"#"+orderCode(o.id),address:"",phone:"",note:"",courierId:null,courierName:"",courierPhone:"",payment:"",items:o.items.map(i=>({...i,price:0}))})),
    audit:[],
    operations:stock?data.operations:{ingredients:[],recipes:[],lots:[],issues:[],moves:[],preparations:[],preparationVersions:[]},
    purchasing:stock?data.purchasing:{suppliers:[],orders:[],events:[]},
    logistics:seesOrders?data.logistics:{events:[]},
  };
}
