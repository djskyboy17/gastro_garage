import type { AppData } from "../shared/domain";
import { orderCode } from "../shared/domain.ts";
export const staffRoles = ["admin", "dispatcher", "kitchen", "warehouse", "courier", "pending", "disabled"] as const;
export type Role = typeof staffRoles[number] | "owner";
export type Member = {userId:string;name:string;email:string;role:string;revision:number;createdAt:string};
export type Session = {userId:string;name:string;role:Role;canBootstrap:boolean};
export const isAdmin = (role:Role) => role === "owner" || role === "admin";
export const isMember = (role:Role) => ["owner","admin","dispatcher","kitchen","warehouse"].includes(role);
/** Ritkán használt, beállítás jellegű nézetek: a főmenü helyett a Beállítások oldalról nyílnak. */
export const settingsTabs = ["safety","fulfillment","access","audit"] as const;
export const isSettingsTab = (tab:string) => (settingsTabs as readonly string[]).includes(tab);
export function tabsFor(role:Role): string[] {
  if (isAdmin(role)) return ["overview","orders","recurring","kitchen","packing","delivery","catalog","customers","menu","fulfillment","portal","recipes","inventory","stocktake","procurement","safety","audit","access","settings"];
  if (role === "dispatcher") return ["overview","orders","recurring","packing","delivery","catalog","customers","menu","fulfillment","portal","settings"];
  if (role === "kitchen") return ["kitchen","packing","safety","settings"];
  if (role === "warehouse") return ["inventory","stocktake","recipes","procurement","safety","settings"];
  return [];
}
export function canWrite(role:Role,path:string,body:unknown): boolean {
  const b = body && typeof body === "object" ? body as Record<string,unknown> : {};
  // Unknown endpoints are denied, even for admins; new modules must declare access.
  const known = ["/api/demo","/api/products","/api/customers","/api/orders","/api/orders/state","/api/delivery/couriers","/api/delivery/assign","/api/operations/demo","/api/operations/ingredients","/api/operations/recipes","/api/operations/ingredient-details","/api/operations/preparations","/api/operations/receive","/api/operations/waste","/api/operations/issue","/api/purchasing/suppliers","/api/purchasing/create","/api/purchasing/update","/api/purchasing/state","/api/purchasing/receive","/api/access/role"];
  if(path==="/api/kitchen/ready")return ["owner","admin","kitchen"].includes(role);
  if(path==="/api/packing/check")return ["owner","admin","dispatcher","kitchen"].includes(role);
  if(path==="/api/fulfillment/save")return isAdmin(role);
  const stocktakePaths=["/api/stocktake/create","/api/stocktake/save","/api/stocktake/refresh-line","/api/stocktake/post","/api/stocktake/reverse","/api/stocktake/cancel"];
  if(stocktakePaths.includes(path))return isAdmin(role)||(role==="warehouse"&&!["/api/stocktake/post","/api/stocktake/reverse"].includes(path));
  const safetyPaths = ["/api/safety/points","/api/safety/records","/api/safety/resolve"];
  const recurringPaths = ["/api/menu/save","/api/recurring/templates","/api/recurring/preview","/api/recurring/generate"];
  if (!known.includes(path) && !safetyPaths.includes(path) && !recurringPaths.includes(path)) return false;
  if (isAdmin(role)) return true;
  if (recurringPaths.includes(path)) return role === "dispatcher";
  if (safetyPaths.includes(path)) return ["kitchen","warehouse"].includes(role) && path === "/api/safety/records";
  if (path === "/api/orders/state") return role === "kitchen" ? b.field === "production" : role === "dispatcher" && ["delivery","payment","status"].includes(String(b.field));
  if (role === "dispatcher") return ["/api/orders","/api/products","/api/customers","/api/delivery/couriers","/api/delivery/assign"].includes(path);
  if (role === "warehouse") return path.startsWith("/api/purchasing/") || (path.startsWith("/api/operations/") && !path.endsWith("/demo"));
  return false;
}
export function projectData(data:AppData,role:Role): AppData {
  if (isAdmin(role)) return data;
  if(!isMember(role))return {...data,products:[],customers:[],orders:[],audit:[],recurring:{templates:[],occurrences:[]},safety:{points:[],records:[]},operations:{ingredients:[],recipes:[],lots:[],issues:[],moves:[],preparations:[],preparationVersions:[]},purchasing:{suppliers:[],orders:[],events:[]},logistics:{couriers:[],events:[]}};
  const sales = role === "dispatcher";
  const stock = role === "warehouse";
  return {
    ...data,
    recurring:sales?data.recurring:{templates:[],occurrences:[]},
    safety:["kitchen","warehouse"].includes(role)?data.safety:{points:[],records:[]},
    products:data.products.map(p => ({...p,price:sales?p.price:0})),
    customers:sales?data.customers:[],
    orders:data.orders.filter(o=>sales||o.status==="confirmed").map(o => sales?o:({...o,deliveryFee:0,fulfillmentPostalCode:"",fulfillmentSnapshot:"",fulfillmentSlotId:null,portalUserId:null,reviewNote:"",customerId:"",customerName:"#"+orderCode(o.id),address:"",phone:"",note:role==="kitchen"?o.note:"",courierId:null,courierName:"",courierPhone:"",payment:"",items:o.items.map(i=>({...i,price:0}))})),
    audit:[],
    operations:stock?data.operations:{ingredients:[],recipes:[],lots:[],issues:[],moves:[],preparations:[],preparationVersions:[]},
    purchasing:stock?data.purchasing:{suppliers:[],orders:[],events:[]},
    logistics:sales?data.logistics:{couriers:[],events:[]},
  };
}
