"use client";
import { dateFormatter, numberFormatter } from "@/src/modules/shared/format";
import PackingWorkspace from "./packing-workspace";
import OrderEntryForm from "./order-entry-form";
import { ProductImage, ProductImageControls } from "./product-image";
import {orderFulfillment,fulfillmentTime} from "@/src/modules/fulfillment/domain";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useContext,
  createContext,
  useId,
  cloneElement,
  isValidElement,
  type FormEvent,
  type ReactNode,
  type ReactElement,
} from "react";
import {
  LayoutDashboard,
  ClipboardList,
  Repeat2,
  ChefHat,
  Truck,
  UtensilsCrossed,
  Users,
  Settings,
  History,
  Plus,
  Search,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Check,
  ChevronRight,
  KeyRound,
  ChevronLeft,
  X,
  RefreshCw,
  Printer,
  Download,
  Leaf,
  Clock,
  Package,
  CheckCircle2,
  Wallet,
  LogOut,
  Tag,
  Menu,
  Loader2,
  AlertCircle,
  FileText,
  Building2,
  Archive,
} from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import OperationsWorkspace from "./operations-workspace";
import PurchasingWorkspace from "./purchasing-workspace";
import ProductionWorkspace, { ProductionWarning } from "./production-workspace";
import DayCloseWorkspace from "./day-close-workspace";
import AvizSettingsWorkspace from "./aviz-settings-workspace";
import CashWorkspace, { OrderPaymentPanel } from "./cash-workspace";
import { OrderFiscalPanel } from "./fiscal-workspace";
import AccountingWorkspace from "./accounting-workspace";
import WorkspaceNavigation from "./workspace-navigation";
import WorkspaceDetails from "./workspace-details";
import BillingWorkspace, { OrderInvoicePanel } from "./billing-workspace";
import ArchiveWorkspace from "./archive-workspace";
import { VersionInfo } from "./version-info";
import FulfillmentWorkspace from "./fulfillment-workspace";
import StocktakeWorkspace from "./stocktake-workspace";
import LabelsWorkspace from "./labels-workspace";
import MenuWorkspace from "./menu-workspace";
import PortalManagement, { OrderRequestReview } from "./portal-management";
import RecurringWorkspace from "./recurring-workspace";
import { emptyRecurring } from "@/src/modules/recurring/domain";
import SafetyWorkspace from "./safety-workspace";
import { emptySafety } from "@/src/modules/safety/domain";
import AccessWorkspace from "./access-workspace";
import { tabsFor, isMember, isAdmin, canWrite, isSettingsTab, type Session } from "@/src/modules/access/domain";
import DeliveryWorkspace, { OrderDeliveryEditor } from "./delivery-workspace";
import { emptyDelivery } from "@/src/modules/delivery/domain";
import { emptyPurchasing } from "@/src/modules/purchasing/domain";
import { emptyOperations } from "@/src/modules/inventory/domain";
import {
  today,
  total,
  portions,
  orderCode,
  kitchenSummary,
  orderStage,
  overviewCards,
  readyPortions,
  normalizeSearch,
  portionUnit,
  groupSetItems,
  CATEGORIES,
  DAILY_CATEGORIES,
  SECTIONS,
  type Language,
  type AppData,
  type Order,
} from "@/src/modules/shared/domain";
const empty: AppData = {
  recurring: emptyRecurring,
  safety: emptySafety,
  logistics: emptyDelivery,
  products: [],
  customers: [],
  orders: [],
  audit: [],
  operations: emptyOperations,
  purchasing: emptyPurchasing,
};
const nav = [
  ["overview", LayoutDashboard],
  ["orders", ClipboardList],
  ["recurring", Repeat2],
  ["kitchen", ChefHat],
  ["packing", Package],
  ["delivery", Truck],
  ["catalog", UtensilsCrossed],
  ["customers", Users],
  ["menu", UtensilsCrossed],
  ["fulfillment", ClipboardList],
  ["portal", Users],
  ["recipes", ChefHat],
  ["inventory", Package],
  ["stocktake", ClipboardList],
  ["labels", Tag],
  ["procurement", ClipboardList],
  ["cash", Wallet],
  ["billing", FileText],
  ["archive", Archive],
  ["company", Building2],
  ["avizes", FileText],
  ["safety", CheckCircle2],
  ["audit", History],
  ["access", Users],
  ["settings", Settings],
  ["accounting", FileText],
] as const;
const allergenKeys = [
  "gluten",
  "crustaceans",
  "egg",
  "fish",
  "peanut",
  "soy",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
];
const UiContext = createContext({ lang: "hu" as Language, busy: false });
/** Állapot a lépéssorral együtt, ahogy az ügyfél is látja a portálon (v38). */
function StageBadge({ order }: { order: Order }) {
  const { lang } = useContext(UiContext);
  const s = orderStage(order);
  return (
    <span className="stage-cell">
      <span className={"badge " + s.badge}>
        <i />
        {messages[lang][s.key] ?? s.key}
      </span>
      {s.step > 0 && (
        <span className="stage-steps" aria-hidden="true">
          {Array.from({ length: s.steps }, (_, n) => (
            <span key={n} className={n < s.step ? "done" : ""} />
          ))}
        </span>
      )}
    </span>
  );
}
function Badge({ state,label }: { state: string;label?:string }) {
  const { lang } = useContext(UiContext);
  return (
    <span className={"badge " + state}>
      <i />
      {messages[lang][label??state] ?? state}
    </span>
  );
}
function Button({
  children,
  onClick,
  secondary = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  const { busy } = useContext(UiContext);
  return (
    <button
      type="button"
      className={"button " + (secondary ? "secondary" : "")}
      onClick={onClick}
      disabled={disabled || busy}
    >
      {children}
    </button>
  );
}
export default function KitchenApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [lang, setLang] = useState<Language>("hu");
  const [tab, setTab] = useState("overview");
  const [packingTarget,setPackingTarget]=useState<{id:string;date:string}|null>(null);
  const [data, setData] = useState<AppData>(empty);
  const [day, setDay] = useState(today);
  const [query, setQuery] = useState("");
  // Ételkatalógus két része (v49): Napi menü és Étlap; az új étel űrlapja ebből indul.
  const [catalogSection, setCatalogSection] = useState<"daily" | "alacarte">("daily");
  const [productCategory, setProductCategory] = useState("soup");
  // v55: a szerkesztett étel; null = új étel.
  const [editingProduct, setEditingProduct] = useState<AppData["products"][number] | null>(null);
  // v56: az új rendelés ügyfele (meglévő vagy helyben felvett új).
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [collectionPolicy, setCollectionPolicy] = useState<{ orderId: string; deferred: boolean | null } | null>(null);
  const onCollectionLoaded = useCallback((orderId: string, deferred: boolean) => {
    setCollectionPolicy((current) => current?.orderId === orderId ? { orderId, deferred } : current);
  }, []);
  const [mobile, setMobile] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const t = (key: string) => messages[lang][key] ?? key;
  const can = (path:string, body:unknown = {}) => session ? canWrite(session.role,"/api/"+path,body) : false;
  const money = (n: number) =>
    !session || !["owner","admin","dispatcher"].includes(session.role) ? "—" : numberFormatter(lang === "hu" ? "hu-HU" : "ro-RO", {
      style: "currency",
      currency: "RON",
      minimumFractionDigits: 2,
    }).format(n / 100);
  const title = (o: { hu: string; ro: string }) => o[lang];
  useEffect(() => {
    const l = localStorage.getItem("konyha-language");
    if (l === "ro" || l === "hu") setLang(l);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem("konyha-language", lang);
  }, [lang]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sr = await fetch("/api/session", { cache: "no-store" });
      const current = await sr.json() as Session & {error?:string};
      if (!sr.ok) { setSession(null); setData(empty); throw new Error(current.error || "loadError"); }
      // Ideiglenes jelszóval előbb új jelszót kell adni.
      if((current as Session & {mustChangePassword?:boolean}).mustChangePassword){window.location.replace('/password?forced=1&return_to=/');return;}
      setSession(current);
      if(current.role==='courier'){setData(empty);setModal(null);setError('');window.location.replace('/courier');return;}
      const allowed = tabsFor(current.role);
      setTab(prev => allowed.includes(prev) ? prev : allowed[0] ?? "overview");
      if (!isMember(current.role)) { setData(empty); setModal(null); setError(""); return; }
      const r = await fetch("/api/data", { cache: "no-store" });
      const d = (await r.json()) as AppData & { error?: string };
      if (!r.ok) throw new Error(d.error || "loadError");
      setData(d);
      setError("");
    } catch (e) {
      setData(empty);
      setError(e instanceof Error ? e.message : "loadError");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const refreshQuietly = useCallback(async () => {
    try {
      const r = await fetch("/api/data", { cache: "no-store" });
      if (!r.ok) return;
      setData((await r.json()) as AppData);
    } catch {
      // Hálózati hiba: a következő körben újra próbálja.
    }
  }, []);
  useEffect(() => {
    if (!session || !isMember(session.role) || !["overview", "orders"].includes(tab) || modal) return;
    const timer = setInterval(() => void refreshQuietly(), 30000);
    const onVisible = () => { if (document.visibilityState === "visible") void refreshQuietly(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [session, tab, modal, refreshQuietly]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function mutate(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(d.error || "saveError");
      await load();
      setToast("updated");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "saveError");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: string) {
    if (!session || !tabsFor(session.role).includes(next)) return;
    if(next!=="packing")setPackingTarget(null);
    setTab(next);
    setQuery("");
    setFilter("all");
    setMobile(false);
  }
  function open(type: string) {
    setError("");
    setModal(type);
    if (type === "order") {
      setOrderId(crypto.randomUUID());
    }
  }
  function detail(o: Order) {
    setDeliveryNote("");
    setSelected(o.id);
    setCollectionPolicy({ orderId: o.id, deferred: null });
    open("detail");
  }
  async function change(o: Order, field: string, value: string) {
    const saved = await mutate("orders/state", {
      id: o.id,
      revision: o.revision,
      field,
      value,
      note: field === "delivery" ? deliveryNote : "",
    });
    if (saved) setDeliveryNote("");
    // v50: a lemondott rendelés véglegesen törlődik, ezért a részletek ablaka bezárul.
    if (saved && field === "status" && value === "cancelled") setModal(null);
  }
  function changeDay(offset: number) {
    const d = new Date(day + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
    setDay(d.toISOString().slice(0, 10));
  }
  const active = data.orders.filter(
    (o) => o.date === day && o.status === "confirmed",
  );
  const daily = data.orders
    .filter((o) => o.date === day)
    .sort(
      (a, b) =>
        a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt),
    );
  const matching = daily
    .filter((o) =>
      normalizeSearch(
        o.customerName +
          " " +
          o.id +
          " " +
          o.items.map((i) => i.hu + " " + i.ro).join(" "),
      ).includes(normalizeSearch(query)),
    )
    .filter(
      (o) =>
        filter === "all" ||
        [o.production, o.delivery, o.payment, o.status].includes(filter),
    );
  const summary = kitchenSummary(active);
  const count = active.reduce((s, o) => s + portions(o), 0);
  const readyCount = active
    .filter((o) => o.status === "confirmed")
    .reduce((s, o) => s + readyPortions(o), 0);
  const selectedOrder = data.orders.find((o) => o.id === selected);
  const longDate = dateFormatter(lang === "hu" ? "hu-HU" : "ro-RO", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Europe/Bucharest",
  }).format(new Date(day + "T12:00:00Z"));
  const Empty = () => (
    <div className="empty">
      <ClipboardList size={28} />
      <h3>{t(query || filter !== "all" ? "noResults" : "noOrders")}</h3>
      <p>{t("emptyHint")}</p>
      {can("orders") && <Button
        onClick={() => open("order")}
        disabled={!data.products.length}
      >
        <Plus size={16} />
        {t("newOrder")}
      </Button>}
    </div>
  );
  function orderTable(list: Order[]) {
    return list.length ? (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("customer")}</th>
              <th>{t("items")}</th>
              <th>{t("time")}</th>
              <th>{t("status")}</th>
              <th className="number">{t("amount")}</th>
              <th>
                <span className="sr-only">{t("open")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((o, i) => (
              <tr
                key={o.id}
                className={"order-row" + (o.status === "cancelled" ? " cancelled-row" : "")}
                onClick={() => detail(o)}
              >
                <td>
                  <button className="customer-cell">
                    <span className={"avatar avatar-" + (i % 4)}>
                      {o.customerName.slice(0, 1)}
                    </span>
                    <span>
                      <strong>
                        {o.customerName.replace(" · Minta / Exemplu", "")}
                      </strong>
                      <small>
                        #{orderCode(o.id)}
                        {o.id.startsWith("demo") ? " · " + t("sample") : ""}
                      </small>
                    </span>
                  </button>
                </td>
                <td>
                  <strong>
                    {portions(o)} {t("units")}
                  </strong>
                  <small>
                    {o.items.length} {t("items").toLowerCase()}
                  </small>
                </td>
                <td>
                  <span className="time">
                    <Clock size={13} />
                    {o.time}
                  </span>
                </td>
                <td>
                  <StageBadge order={o} />
                </td>
                <td className="number">
                  <strong>{money(total(o))}</strong>
                  <small>{t(o.payment)}</small>
                </td>
                <td>
                  <button className="icon-button order-row-open" aria-label={t("open")}>
                    <ArrowUpRight size={22} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty />
    );
  }
  function exportCsv() {
    const rows = [
      [
        t("date"),
        t("customer"),
        t("time"),
        t("items"),
        t("quantity"),
        t("amount"),
        t("production"),
        t("delivery"),
        t("payment"),
        "#",
        t("fulfillMode"),
        t("fulfillShipping"),
        t("fulfillGrandTotal"),
      ],
      ...matching.flatMap((o) =>
        o.items.map((i,index) => [
          o.date,
          o.customerName,
          o.time,
          title(i),
          String(i.quantity),
          ((i.quantity * i.price) / 100).toFixed(2),
          t(o.production),
          t(o.delivery),
          t(o.payment),
          orderCode(o.id),
          t(o.fulfillmentMode==="pickup"?"fulfillPickup":"fulfillDelivery"),
          index===0?((o.deliveryFee??0)/100).toFixed(2):"",
          index===0?(total(o)/100).toFixed(2):"",
        ]),
      ),
    ];
    const safe = (s: string) => {
      const v = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
      return '"' + v.replaceAll('"', '""') + '"';
    };
    const blob = new Blob(
      ["\uFEFF" + rows.map((r) => r.map(safe).join(";")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "konyha-" + day + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let body: unknown;
    if (modal === "customer")
      body = {
        name: f.get("name"),
        address: f.get("address"),
        phone: f.get("phone"),
        note: f.get("note"),
      };
    else if (modal === "product")
      body = {
        hu: f.get("hu"),
        ro: f.get("ro"),
        descriptionHu: f.get("descriptionHu"),
        descriptionRo: f.get("descriptionRo"),
        category: f.get("category"),
        section: f.get("section"),
        price: Math.round(Number(f.get("price")) * 100),
        portion: Number(f.get("portion")),
        allergens: f.getAll("allergens").join(","),
        ...(editingProduct ? { id: editingProduct.id, revision: editingProduct.portalRevision ?? 0 } : {}),
      };
    else return;
    if (
      await mutate(
        modal === "customer"
          ? "customers"
          : modal === "product"
            ? editingProduct ? "products/update" : "products"
            : "orders",
        body,
      )
    ) {
      setModal(null);
    }
  }
  const noData =
    !data.products.length && !data.customers.length && !data.orders.length;
  if(session?.role==='courier')return <main className="panel access-gate"><h1>{t('courierMobile')}</h1><a className="button" href="/courier">{t('courierOpen')}</a></main>;
  if (!session || !isMember(session.role)) return <main className="panel access-gate">
    <div className="language-switch">{(["hu","ro"] as const).map(l=><button key={l} className={lang===l?"selected":""} onClick={()=>setLang(l)}>{l.toUpperCase()}</button>)}</div>
    <h1>{t("access")}</h1><p>{t("accessIntro")}</p>
    {error && <p role="alert">{t(error)}</p>}
    {loading ? <p>{t("loading")}</p> : session ? <>
      <strong>{session.name} · {t("role_"+session.role)}</strong>
      <p>{t(session.role==="disabled"?"accessBlocked":"accessWaiting")}</p>
      {session.role!=="disabled" && <button className="button" disabled={busy} onClick={()=>void mutate("access/request",{})}>{t(session.canBootstrap?"ownerStart":"accessRequest")}</button>}
      <button className="button secondary" disabled={busy} onClick={()=>void load()}>{t("accessRefresh")}</button>
      <a href="/signout?return_to=/">{t("signOut")}</a>
    </> : <a className="button" href="/signin?return_to=/">{t("signIn")}</a>}
    <a className="button secondary" href="/portal">{t("portalOpen")}</a>
  </main>;
  return (
    <UiContext.Provider value={{ lang, busy }}>
      <div className="app-shell">
        <aside className={"sidebar " + (mobile ? "is-open" : "")}>
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate("overview");
            }}
          >
            <img className="brand-logo" src="/logo.png" alt="Gastro-Garage" width={150} height={150} />
            <small>{t("brand")}</small>
          </a>
          <p className="nav-label">{t("workspace")}</p>
          <WorkspaceNavigation lang={lang} onNavigate={navigate} entries={nav.filter(([key]) => tabsFor(session.role).includes(key) && !isSettingsTab(key)).map(([key, Icon]) => ({ id: key, Icon, label: t(key), active: tab === key || (key === "settings" && isSettingsTab(tab)), count: key === "orders" ? active.length : undefined }))} />
          <div className="sidebar-bottom">
            <div className="seedling">
              <Leaf size={24} />
              <strong>{t("greeting")}</strong>
              <p>{t("notice")}</p>
            </div>
            <a
              href="/signout?return_to=/"

              className="profile"
            >
              <span className="avatar owner-avatar">{session.name.slice(0,2).toUpperCase()}</span>
              <span>
                <strong>{session.name}</strong>
                <small>{t("role_"+session.role)} · {t("signOut")}</small>
              </span>
              <LogOut size={17} />
            </a>
          </div>
        </aside>
        {mobile && (
          <button
            className="scrim"
            onClick={() => setMobile(false)}
            aria-label={t("close")}
          />
        )}
        <div className="main-shell">
          <header className="topbar">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobile(true)}
              aria-label={t("navigation")}
            >
              <Menu size={22} />
            </button>
            {tab !== "overview" && !!session && tabsFor(session.role).includes("overview") ? (
              <button type="button" className="back-to-overview" onClick={() => navigate("overview")}>
                <ArrowLeft size={20} />
                {t("backToOverview")}
              </button>
            ) : (
              <span />
            )}
            <div className="topbar-right">
              <span className="private-label">
                <span className="green-dot" />
                {t("demoNotice")}
              </span>
              <div className="language-switch" aria-label={t("language")}>
                {(["hu", "ro"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={lang === l ? "selected" : ""}
                    aria-pressed={lang === l}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </header>
          <main>
            <div className="page-heading">
              <div>
                {tab === "overview" && <p className="eyebrow">{t("daily")}</p>}
                <h1>
                  {t(
                    tab === "overview"
                      ? "greeting"
                      : tab === "kitchen"
                        ? "productionTitle"
                        : tab === "delivery"
                          ? "deliveryTitle"
                          : tab === "settings"
                            ? "settingsTitle"
                            : tab === "accounting"
                              ? "simpleAccountingTitle"
                            : tab,
                  )}
                </h1>
                <p className="subtitle">
                  {t(
                    tab === "overview"
                      ? "intro"
                      : tab === "kitchen"
                        ? "productionSubtitle"
                        : tab === "delivery"
                          ? "deliverySubtitle"
                          : tab === "cash"
                            ? "cashHint"
                          : tab === "archive"
                            ? "archiveHint"
                          : tab === "avizes"
                            ? "settingsAbout_avizes"
                          : tab === "company"
                            ? "settingsAbout_company"
                          : tab === "billing"
                            ? "billingHint"
                          : tab === "recurring"
                            ? "recurringHint"
                          : tab === "safety"
                            ? "safetyHint"
                          : tab === "catalog"
                            ? "catalogHint"
                            : tab === "customers"
                              ? "customerHint"
                              : tab === "settings"
                                ? "settingsHint"
                                : "settingsNote",
                  )}
                </p>
              </div>
              <div className="heading-actions">
                {tab === "catalog" ? (
                  <Button onClick={() => { setEditingProduct(null); setProductCategory(catalogSection === "daily" ? "soup" : "main"); open("product"); }}>
                    <Plus size={17} />
                    {t("newProduct")}
                  </Button>
                ) : tab === "customers" ? (
                  <Button onClick={() => open("customer")}>
                    <Plus size={17} />
                    {t("newCustomer")}
                  </Button>
                ) : isSettingsTab(tab) ? (
                  <Button secondary onClick={() => navigate("settings")}>
                    <ArrowLeft size={17} />
                    {t("backToSettings")}
                  </Button>
                ) : ["overview", "orders"].includes(tab) && can("orders") ? (
                  <Button
                    onClick={() => open("order")}
                    disabled={!data.products.length}
                  >
                    <Plus size={17} />
                    {t("newOrder")}
                  </Button>
                ) : null}
              </div>
            </div>
            {error && modal !== "order" && (
              <div role="alert" className="error-banner">
                <AlertCircle size={18} />
                <span>{t(error) === error ? t("saveError") : t(error)}</span>
                {error === "AUTH_REQUIRED" ? (
                  <a href="/signin?return_to=/">
                    {t("signIn")}
                  </a>
                ) : error === "PASSWORD_CHANGE_REQUIRED" ? (
                  <a href="/password?forced=1&return_to=/">{t("passwordChangeLink")}</a>
                ) : (
                  <button onClick={() => void load()}>{t("refresh")}</button>
                )}
              </div>
            )}
            {loading && !data.products.length ? (
              <div className="loading">
                <Loader2 className="spin" />
                {t("loading")}
              </div>
            ) : (
              <>
                {noData && !error && can("demo") && tab === "overview" ? (
                  <section className="welcome">
                    <span className="welcome-icon">
                      <Leaf size={32} />
                    </span>
                    <div>
                      <p className="eyebrow">{t("setup")}</p>
                      <h2>{t("welcome")}</h2>
                      <p>{t("welcomeText")}</p>
                      <div className="welcome-actions">
                        <Button onClick={() => void mutate("demo", {})}>
                          <Plus size={16} />
                          {t("demo")}
                        </Button>
                        <Button secondary onClick={() => open("product")}>
                          {t("newProduct")}
                        </Button>
                        <Button secondary onClick={() => open("customer")}>
                          {t("newCustomer")}
                        </Button>
                      </div>
                    </div>
                  </section>
                ) : null}
                {[
                  "overview",
                  "orders",
                  "kitchen",
                  "delivery",
                  "inventory",
                  "procurement",
                  "safety",
                ].includes(tab) && (
                  <div className="date-toolbar">
                    <div className="date-control">
                      <button
                        className="icon-button"
                        onClick={() => changeDay(-1)}
                        aria-label={t("previous")}
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <label className="date-label">
                        <input
                          type="date"
                          required
                          value={day}
                          onChange={(e) =>
                            e.target.value && setDay(e.target.value)
                          }
                        />
                        <strong>{longDate}</strong>
                      </label>
                      <button
                        className="icon-button"
                        onClick={() => changeDay(1)}
                        aria-label={t("next")}
                      >
                        <ChevronRight size={16} />
                      </button>
                      <button
                        className="today-button"
                        onClick={() => setDay(today())}
                      >
                        {t("today")}
                      </button>
                    </div>
                    <div className="toolbar-actions">
                      <button
                        className="text-button"
                        onClick={() => void load()}
                        disabled={loading || busy}
                      >
                        <RefreshCw
                          size={15}
                          className={loading ? "spin" : ""}
                        />
                        {t("refresh")}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => window.print()}
                      >
                        <Printer size={15} />
                        {t("print")}
                      </button>
                    </div>
                  </div>
                )}
                {tab === "overview" && (
                  <>
                    {isAdmin(session.role) && <ProductionWarning lang={lang} orders={data.orders} operations={data.operations} day={day} onOpen={() => navigate("kitchen")} />}
                    {/* v39: négy állapotkártya – narancs: még semmi sincs kész, sárga: folyamatban, zöld: kész. */}
                    <div className="status-cards">
                      {overviewCards(daily).map((c) => {
                        const meta = {
                          orders: { Icon: ClipboardList, dest: "orders", unit: "ordersCount", extra: "statusAwaitingConfirm" },
                          kitchen: { Icon: ChefHat, dest: "kitchen", unit: "units", extra: "statusToCook" },
                          delivery: { Icon: Truck, dest: "delivery", unit: "ordersCount", extra: "statusInTransit" },
                        }[c.key];
                        const I = meta.Icon;
                        const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
                        return (
                          <button key={c.key} className={"status-card level-" + c.level} onClick={() => navigate(meta.dest)}>
                            <span className="status-card-head">
                              <I size={22} />
                              <span>{t("statusCard_" + c.key)}</span>
                              <span className="status-pill">{t("level_" + c.level)}</span>
                            </span>
                            <strong>
                              {c.done}
                              <small> / {c.total}</small>
                            </strong>
                            <span className="status-bar">
                              <span style={{ width: pct + "%" }} />
                            </span>
                            <small className="status-card-foot">
                              {c.extra > 0 ? c.extra + " " + t(meta.extra) : c.done < c.total ? c.total - c.done + " " + t("statusRemaining") : t("statusCardDone_" + c.key)}
                            </small>
                          </button>
                        );
                      })}
                    </div>
                    <div className="overview-grid">
                      <section className="panel orders-panel">
                        <div className="panel-heading">
                          <h2>
                            {t("dayOrders")}{" "}
                            <span className="count-pill">{daily.length}</span>
                          </h2>
                          <button
                            className="text-button"
                            onClick={() => navigate("orders")}
                          >
                            {t("seeAll")}
                            <ArrowRight size={15} />
                          </button>
                        </div>
                        {orderTable(daily.slice(0, 5))}
                      </section>
                      <section className="panel production-panel">
                        <div className="panel-heading">
                          <h2>{t("productionTitle")}</h2>
                          <ChefHat size={18} />
                        </div>
                        <p className="panel-subtitle">
                          {t("productionSubtitle")}
                        </p>
                        {summary.length ? (
                          summary.map((r, i) => (
                            <div className="production-row" key={i}>
                              <div>
                                <span className={"food-icon food-" + (i % 4)}>
                                  {i === 0 ? (
                                    <UtensilsCrossed size={18} />
                                  ) : i === 1 ? (
                                    <ChefHat size={18} />
                                  ) : (
                                    <Leaf size={18} />
                                  )}
                                </span>
                                <strong>
                                  {title(r)}
                                  <small className="production-meta">
                                    {t("packingPrepared")}: {r.ready}
                                    {" · "}
                                    {t("allergens")}:{" "}
                                    {r.allergens ? r.allergens.split(",").map(t).join(", ") : t("packingNoAllergenData")}
                                  </small>
                                </strong>
                                <span>
                                  {r.quantity}
                                  <small> {t("units")}</small>
                                </span>
                              </div>
                              <div className="progress-track">
                                <span
                                  style={{
                                    width: r.quantity
                                      ? (r.ready / r.quantity) * 100 + "%"
                                      : "0%",
                                  }}
                                />
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="quiet-empty">{t("noOrders")}</p>
                        )}
                        <button
                          className="panel-footer-link"
                          onClick={() => navigate("kitchen")}
                        >
                          {t("kitchen")}
                          <ArrowRight size={15} />
                        </button>
                      </section>
                      <section className="dispatch-banner">
                        <span className="dispatch-icon">
                          <Truck size={27} />
                        </span>
                        <div>
                          <p className="eyebrow">{t("nextDelivery")}</p>
                          <h2>
                            {
                              active.filter(
                                (o) =>
                                  o.fulfillmentMode!=="pickup" && (o.delivery === "pending" ||
                                  o.delivery === "transit"),
                              ).length
                            }{" "}
                            {t("ordersCount").toLowerCase()}
                          </h2>
                          <p>{t("deliverySubtitle")}</p>
                        </div>
                        <Button secondary onClick={() => navigate("delivery")}>
                          {t("delivery")}
                          <ArrowRight size={16} />
                        </Button>
                        <div className="route-art" aria-hidden="true">
                          <span />
                          <i />
                          <span />
                          <i />
                          <span />
                        </div>
                      </section>
                    </div>
                    <div className="revenue-strip">
                      <Wallet size={18} />
                      <span>{t("revenue")}</span>
                      <strong>{money(active.reduce((s, o) => s + total(o), 0))}</strong>
                      <span className="revenue-split">
                        {t("paid")}: {money(active.filter((o) => o.payment === "paid").reduce((s, o) => s + total(o), 0))}
                        {" · "}
                        {t("unpaid")}: {money(active.filter((o) => o.payment !== "paid").reduce((s, o) => s + total(o), 0))}
                      </span>
                      <small>{t("gross")}</small>
                    </div>
                  </>
                )}
                {tab === "orders" && (
                  <section className="panel">
                    <div className="list-toolbar">
                      <label className="search-box">
                        <Search size={17} />
                        <input
                          placeholder={t("search")}
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                      <select
                        aria-label={t("filter")}
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        {[
                          "all",
                          "requested",
                          "confirmed",
                          "rejected",
                          "queued",
                          "cooking",
                          "ready",
                          "transit",
                          "delivered",
                          "unpaid",
                          "paid",
                          "cancelled",
                        ].map((s) => (
                          <option key={s} value={s}>
                            {t(s)}
                          </option>
                        ))}
                      </select>
                      <button className="text-button" onClick={exportCsv}>
                        <Download size={16} />
                        {t("export")}
                      </button>
                    </div>
                    {orderTable(matching)}
                  </section>
                )}
                {tab === "kitchen" && (
                  <>
                    {isAdmin(session.role) && <ProductionWarning lang={lang} orders={data.orders} operations={data.operations} day={day} />}
                    <div className="kitchen-summary">
                      <ChefHat size={24} />
                      <strong>{summary.reduce((s, r) => s + r.remaining, 0)}</strong>
                      <span>
                        {t("kitchenRemaining")} · {summary.length}{" "}
                        {t("items").toLowerCase()}
                      </span>
                      <div className="summary-progress">
                        <span>
                          {readyCount} / {count} {t("readyOf")}
                        </span>
                        <div className="progress-track">
                          <span
                            style={{
                              width:
                                (count ? (readyCount / count) * 100 : 0) + "%",
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="kitchen-grid">
                      {summary.map((r, i) => (
                        <article className={"panel kitchen-card" + (r.remaining === 0 ? " is-done" : "")} key={r.productId + r.hu + r.ro}>
                          <div className="kitchen-card-top">
                            <span className={"food-icon food-" + (i % 4)}>
                              <UtensilsCrossed size={24} />
                            </span>
                            <span>{String(i + 1).padStart(2, "0")}</span>
                          </div>
                          <h2>{title(r)}</h2>
                          <p>{r[lang === "hu" ? "ro" : "hu"]}</p>
                          <div className="allergen-line">
                            {r.allergens
                              .split(",")
                              .filter(Boolean)
                              .map((a) => (
                                <span key={a}>{t(a)}</span>
                              ))}
                          </div>
                          <div className="kitchen-quantity">
                            <strong>{r.remaining}</strong>
                            <span>{t("kitchenRemaining")}</span>
                            <small>
                              {r.ready} / {r.quantity} {t("kitchenDoneOf")}
                            </small>
                          </div>
                          <div className="progress-track">
                            <span
                              style={{
                                width: (r.ready / r.quantity) * 100 + "%",
                              }}
                            />
                          </div>
                          {r.remaining > 0 ? (
                            can("kitchen/ready") && (
                              <button
                                className="kitchen-done-button"
                                disabled={busy}
                                onClick={() => void mutate("kitchen/ready", { itemIds: r.pendingItemIds })}
                              >
                                <CheckCircle2 size={22} />
                                {t("kitchenDone")}
                              </button>
                            )
                          ) : (
                            <p className="kitchen-all-done">
                              <CheckCircle2 size={18} />
                              {t("kitchenAllDone")}
                            </p>
                          )}
                        </article>
                      ))}
                    </div>
                    {isAdmin(session.role) && <ProductionWorkspace key={day} lang={lang} initialDay={day} onChanged={() => void load()} />}
                    {(isAdmin(session.role) || session.role === "kitchen" || session.role === "warehouse") && <DayCloseWorkspace key={"close-" + day} lang={lang} initialDay={day} admin={isAdmin(session.role)} onChanged={() => void load()} />}
                  </>
                )}
                {tab === "delivery" && (
                  <DeliveryWorkspace data={data} lang={lang} busy={busy} mutate={mutate} day={day} onOrder={detail}/>
                )}
                {tab === "catalog" && (
                  <>
                    <div className="catalog-sections" role="tablist" aria-label={t("catalogSection")}>
                      {SECTIONS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="tab"
                          aria-selected={catalogSection === s}
                          className={catalogSection === s ? "selected" : ""}
                          onClick={() => setCatalogSection(s)}
                        >
                          {t("section_" + s)}
                          <span>{data.products.filter((p) => p.active === 1 && (p.section ?? "alacarte") === s).length}</span>
                        </button>
                      ))}
                    </div>
                    <p className="portal-hint">{t(catalogSection === "daily" ? "sectionDailyHint" : "sectionAlacarteHint")}</p>
                    <label className="search-box standalone">
                      <Search size={17} />
                      <input
                        placeholder={t("search")}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <div className="catalog-grid">
                      {data.products
                        .filter((p) => p.active === 1 && (p.section ?? "alacarte") === catalogSection)
                        .filter((p) =>
                          normalizeSearch(p.hu + " " + p.ro).includes(
                            normalizeSearch(query),
                          ),
                        )
                        .map((p, i) => (
                          <article className="panel product-card" key={p.id}>
                            <div className={"product-visual visual-" + (i % 4) + (p.hasImage === 1 ? " has-photo" : "")}>
                              <ProductImage product={p} alt={title(p)} />
                              {p.hasImage !== 1 && <UtensilsCrossed size={58} strokeWidth={1} />}
                              <span>{t(p.category)}</span>
                              {p.hasImage !== 1 && <span className="visual-number">0{i + 1}</span>}
                            </div>
                            <div className="product-body">
                              <h2>{title(p)}</h2>
                              <p className="alternate-name">
                                {p[lang === "hu" ? "ro" : "hu"]}
                              </p>
                              <p>
                                {lang === "hu"
                                  ? p.descriptionHu
                                  : p.descriptionRo}
                              </p>
                              <div className="allergen-line">
                                {p.allergens ? (
                                  p.allergens
                                    .split(",")
                                    .map((a) => <span key={a}>{t(a)}</span>)
                                ) : (
                                  <span>{t("noAllergens")}</span>
                                )}
                              </div>
                              <div className="product-bottom">
                                <strong>{money(p.price)}</strong>
                                <span>{p.portion} {portionUnit(p.category)}</span>
                              </div>
                              {can("products/section") &&
                                (catalogSection === "alacarte" ? (
                                  (DAILY_CATEGORIES as readonly string[]).includes(p.category) && (
                                    <button type="button" className="text-button" disabled={busy} onClick={() => void mutate("products/section", { id: p.id, section: "daily" })}>
                                      {t("moveToDaily")}
                                    </button>
                                  )
                                ) : (
                                  <button type="button" className="text-button" disabled={busy} onClick={() => void mutate("products/section", { id: p.id, section: "alacarte" })}>
                                    {t("moveToAlacarte")}
                                  </button>
                                ))}
                              {can("products/update") && (
                                <div className="product-actions">
                                  <button
                                    type="button"
                                    className="button secondary"
                                    disabled={busy}
                                    onClick={() => {
                                      setEditingProduct(p);
                                      setCatalogSection((p.section ?? "alacarte") as "daily" | "alacarte");
                                      setProductCategory(p.category);
                                      open("product");
                                    }}
                                  >
                                    {t("editProduct")}
                                  </button>
                                  <button
                                    type="button"
                                    className="button secondary danger-text"
                                    disabled={busy}
                                    onClick={() => {
                                      if (window.confirm(t("deleteProductConfirm").replace("{name}", title(p)))) void mutate("products/delete", { id: p.id });
                                    }}
                                  >
                                    {t("deleteProduct")}
                                  </button>
                                </div>
                              )}
                              {can("products/image") && (
                                <ProductImageControls product={p} t={t} busy={busy} mutate={mutate} onError={setError} />
                              )}
                            </div>
                          </article>
                        ))}
                    </div>
                  </>
                )}
                {tab === "customers" && (
                  <section className="panel">
                    <div className="list-toolbar">
                      <label className="search-box">
                        <Search size={17} />
                        <input
                          placeholder={t("search")}
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>{t("customer")}</th>
                            <th>{t("address")}</th>
                            <th>{t("phone")}</th>
                            <th>{t("note")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.customers
                            .filter((c) =>
                              normalizeSearch(
                                c.name + " " + c.address,
                              ).includes(normalizeSearch(query)),
                            )
                            .map((c, i) => (
                              <tr key={c.id}>
                                <td>
                                  <span className="customer-cell">
                                    <span
                                      className={"avatar avatar-" + (i % 4)}
                                    >
                                      {c.name[0]}
                                    </span>
                                    <strong>{c.name}</strong>
                                  </span>
                                </td>
                                <td>{c.address}</td>
                                <td>
                                  {c.phone ? (
                                    <a href={"tel:" + c.phone}>{c.phone}</a>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td>{c.note || "—"}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                {["recipes", "inventory"].includes(tab) && (
                  <OperationsWorkspace
                    tab={tab}
                    data={data}
                    lang={lang}
                    day={day}
                    busy={busy}
                    error={error}
                    onSave={mutate}
                    onOrder={detail}
                  />
                )}
                {tab === "procurement" && (
                  <PurchasingWorkspace
                    data={data}
                    lang={lang}
                    day={day}
                    busy={busy}
                    error={error}
                    onSave={mutate}
                    isAdmin={isAdmin(session.role)}
                    onRefresh={() => void load()}
                    renderPlan={(create) => (
                      <OperationsWorkspace
                        tab="procurement"
                        data={data}
                        lang={lang}
                        day={day}
                        busy={busy}
                        error={error}
                        onSave={mutate}
                        onOrder={detail}
                        onCreatePurchase={create}
                      />
                    )}
                  />
                )}
                {tab === "settings" && (
                  <>
                    <div className="settings-grid">
                      {nav
                        .filter(([key]) => isSettingsTab(key) && tabsFor(session.role).includes(key))
                        .map(([key, Icon]) => (
                          <button type="button" className="panel settings-card" key={key} onClick={() => navigate(key)}>
                            <Icon size={22} />
                            <span>
                              <strong>{t(key === "accounting" ? "simpleAccountingTitle" : key)}</strong>
                              <small>{t(key === "accounting" ? "simpleAccountingPageHint" : "settingsAbout_" + key)}</small>
                            </span>
                            <ChevronRight size={18} className="settings-card-arrow" />
                          </button>
                        ))}
                      <a className="panel settings-card" href="/password?return_to=/">
                        <KeyRound size={22} />
                        <span>
                          <strong>{t("passwordChangeLink")}</strong>
                          <small>{t("passwordSettingsAbout")}</small>
                        </span>
                        <ChevronRight size={18} className="settings-card-arrow" />
                      </a>
                    </div>
                    <VersionInfo lang={lang} />
                  </>
                )}
                {tab === "packing" && <PackingWorkspace lang={lang} refresh={load} initialDate={packingTarget?.date??day} initialOrderId={packingTarget?.id??""} canEditLabels={isAdmin(session.role)}/>}
                {tab === "fulfillment" && <FulfillmentWorkspace lang={lang} role={session.role}/>}
                {tab === "labels" && <LabelsWorkspace lang={lang}/>}
                {tab === "billing" && <BillingWorkspace lang={lang} />}
                {tab === "archive" && <ArchiveWorkspace lang={lang} />}
                {tab === "avizes" && <AvizSettingsWorkspace lang={lang} />}
                {tab === "company" && <AvizSettingsWorkspace lang={lang} part="company" />}
                {tab === "cash" && <CashWorkspace key={day} lang={lang} initialDay={day} />}
                {tab === "accounting" && <AccountingWorkspace lang={lang} />}
                {tab === "stocktake" && <StocktakeWorkspace ops={data.operations} lang={lang} role={session.role} refresh={load}/>}
                {tab === "menu" && <MenuWorkspace products={data.products} lang={lang}/>}
                {tab === "portal" && <PortalManagement data={data} lang={lang} role={session.role} busy={busy} mutate={mutate} refresh={load} onOrder={detail}/>}
                {tab === "recurring" && <RecurringWorkspace data={data} lang={lang} busy={busy} mutate={mutate} refresh={load} onOrder={detail}/>}
                {tab === "safety" && <SafetyWorkspace data={data.safety} lang={lang} day={day} role={session.role} busy={busy} mutate={mutate}/>}
                {tab === "access" && <AccessWorkspace lang={lang} session={session} busy={busy} mutate={mutate}/>}
                {tab === "audit" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>{t("activity")}</h2>
                      <History size={18} />
                    </div>
                    {data.audit.length ? (
                      data.audit.map((a) => (
                        <div className="audit-row" key={a.id}>
                          <span className="audit-dot" />
                          <div>
                            <strong>
                              {t(a.action === "demo" ? "demoAction" : a.action)}
                            </strong>
                            <p>
                              {a.action === "menu_updated" ? a.entity : a.action === "state_changed"
                                ? (() => {
                                    try {
                                      const d = JSON.parse(a.detail);
                                      return (
                                        t(d.field) +
                                        ": " +
                                        t(d.from) +
                                        " → " +
                                        t(d.to)
                                      );
                                    } catch {
                                      return a.entity;
                                    }
                                  })()
                                : a.action === "demo"
                                  ? ""
                                  : a.detail}
                            </p>
                          </div>
                          <time>
                            {dateFormatter(
                              lang === "hu" ? "hu-HU" : "ro-RO",
                              {
                                dateStyle: "short",
                                timeStyle: "short",
                                timeZone: "Europe/Bucharest",
                              },
                            ).format(new Date(a.createdAt))}
                          </time>
                        </div>
                      ))
                    ) : (
                      <p className="quiet-empty">{t("noActivity")}</p>
                    )}
                  </section>
                )}
              </>
            )}
            <footer className="page-footer">
              <span>
                <span className="green-dot" />
                {t("saved")}
              </span>
              <span>
                Gastro-Garage <span className="footer-dot">/</span>{" "}
                {t("settingsNote")}
              </span>
            </footer>
          </main>
        </div>
        {toast && (
          <div className="toast" role="status">
            <CheckCircle2 size={18} />
            {t(toast)}
          </div>
        )}
        {modal && (
          <Modal
            title={t(
              modal === "order"
                ? "newOrder"
                : modal === "product"
                  ? editingProduct ? "editProduct" : "newProduct"
                  : modal === "customer"
                    ? "newCustomer"
                    : "orderDetail",
            )}
            close={() => !busy && setModal(null)}
            closeLabel={t("close")}
            className={modal === "order" ? "order-entry-modal" : undefined}
          >
            {error && (
              <div role="alert" className="error-banner">
                {t(error) === error ? t("saveError") : t(error)}
              </div>
            )}
            {modal === "detail" && selectedOrder ? (
              <>
                <div className="detail-top">
                  <span className="eyebrow">
                    #{orderCode(selectedOrder.id)}
                  </span>
                  <Badge state={selectedOrder.status} />
                </div>
                {data.recurring.occurrences.some(o=>o.orderId===selectedOrder.id) && <p className="detail-note">{t("recurringSource")} · {data.recurring.templates.find(template=>template.id===data.recurring.occurrences.find(o=>o.orderId===selectedOrder.id)?.templateId)?.name}</p>}
                <h3 className="detail-customer">
                  {selectedOrder.customerName}
                </h3>
                <p className="detail-address">{selectedOrder.address}</p>
                <p className="detail-date">
                  {selectedOrder.date} · {selectedOrder.time}
                  {selectedOrder.phone ? " · " + selectedOrder.phone : ""}
                </p>
                <div className="detail-items">
                  {/* v49: a napi menü három tétele egy sorban, a menüárral. */}
                  {groupSetItems(selectedOrder.items).map((line) =>
                    line.kind === "set" ? (
                      <div key="napi-menu" className="detail-set">
                        <span>
                          <strong>{t("dailyMenu")}</strong>
                          <small>{line.items.map((i) => title(i)).join(" · ")}</small>
                          <small>
                            {[...new Set(line.items.flatMap((i) => i.allergens.split(",").filter(Boolean)))].map(t).join(" · ")}
                          </small>
                        </span>
                        <span>×{line.quantity}</span>
                        <strong>{money(line.total)}</strong>
                      </div>
                    ) : (
                      <div key={line.item.id}>
                        <span>
                          <strong>{title(line.item)}</strong>
                          <small>
                            {line.item.allergens
                              .split(",")
                              .filter(Boolean)
                              .map(t)
                              .join(" · ")}
                          </small>
                        </span>
                        <span>×{line.item.quantity}</span>
                        <strong>{money(line.item.quantity * line.item.price)}</strong>
                      </div>
                    ),
                  )}
                </div>
                {orderFulfillment(selectedOrder)&&<div className="fulfill-summary"><p>{t(selectedOrder.fulfillmentMode==='pickup'?'fulfillPickup':'fulfillDelivery')} · {(()=>{const f=orderFulfillment(selectedOrder)!;return [lang==='hu'?f.zoneHu:f.zoneRo,fulfillmentTime(f)||t('gpAsap')].filter(Boolean).join(' · ');})()}</p><p>{t('fulfillShipping')}: {money(selectedOrder.deliveryFee??0)}</p></div>}
                <div className="detail-total">
                  <span>{t("amount")}</span>
                  <strong>{money(total(selectedOrder))}</strong>
                </div>
                <section className="order-next-step" aria-label={t("simpleNextStep")}>
                <div className="state-grid">
                  {[
                    ["production", selectedOrder.production],
                    ["delivery", selectedOrder.delivery],
                    ["payment", selectedOrder.payment],
                  ].filter(([label]) => label !== "payment" || !["owner", "admin", "dispatcher"].includes(session.role) || (collectionPolicy?.orderId === selectedOrder.id && collectionPolicy.deferred === false)).map(([label, state]) => (
                    <div key={label}>
                      <small>{t(label==="delivery"&&selectedOrder.fulfillmentMode==="pickup"?"fulfillPickupStatus":label)}</small>
                      <Badge state={state} label={label==="delivery"&&selectedOrder.fulfillmentMode==="pickup"&&state==="delivered"?"fulfillPickedUp":undefined} />
                    </div>
                  ))}
                </div>
                {selectedOrder.status === "confirmed" && (
                  <div className="detail-actions">
                    {selectedOrder.fulfillmentMode==='pickup'&&can('orders/state',{field:'delivery'})&&selectedOrder.production==='ready'&&selectedOrder.delivery==='pending'&&<Button onClick={()=>void change(selectedOrder,'delivery','delivered')}>{t('fulfillCollected')}</Button>}
                    {can("orders/state",{field:"production"}) && selectedOrder.production === "queued" && (
                      <Button
                        onClick={() =>
                          void change(selectedOrder, "production", "cooking")
                        }
                      >
                        <ChefHat size={16} />
                        {t("startCooking")}
                      </Button>
                    )}
                    {can("orders/state",{field:"production"}) && selectedOrder.production === "cooking" && (
                      <Button
                        onClick={() =>
                          void change(selectedOrder, "production", "ready")
                        }
                      >
                        <Check size={16} />
                        {t("markReady")}
                      </Button>
                    )}
                    {selectedOrder.fulfillmentMode!=="pickup" && can("orders/state",{field:"delivery"}) && selectedOrder.production === "ready" &&
                      ["pending", "failed"].includes(
                        selectedOrder.delivery,
                      ) && (
                        <Button
                          onClick={() =>
                            void change(selectedOrder, "delivery", "transit")
                          }
                        >
                          <Truck size={16} />
                          {t("dispatch")}
                        </Button>
                      )}
                    {can("orders/state",{field:"delivery"}) && selectedOrder.delivery === "transit" && (
                      <>
                        <Button
                          onClick={() =>
                            void change(selectedOrder, "delivery", "delivered")
                          }
                        >
                          <Check size={16} />
                          {t("markDelivered")}
                        </Button>
                        <Button
                          secondary
                          onClick={() =>
                            void change(selectedOrder, "delivery", "failed")
                          }
                        >
                          {t("markFailed")}
                        </Button>
                      </>
                    )}
                    {can("orders/state",{field:"status"}) && selectedOrder.production === "queued" &&
                      selectedOrder.delivery === "pending" && (
                        <details className="order-other-actions"><summary>{t("simpleOtherActions")}</summary>
                        <button
                          disabled={busy}
                          className="danger-button"
                          onClick={() => {
                            if (window.confirm(t("cancelConfirm")))
                              void change(selectedOrder, "status", "cancelled");
                          }}
                        >
                          {t("cancelOrder")}
                        </button>
                        </details>
                      )}
                  </div>
                )}
                </section>
                {selectedOrder.note && (
                  <p className="detail-note">{selectedOrder.note}</p>
                )}
                {selectedOrder.status === "confirmed" && <WorkspaceDetails title={t("simpleDeliveryOptions")} hint={t("simpleDeliveryHint")} attention={selectedOrder.delivery === "transit" || selectedOrder.delivery === "failed"}>
                {selectedOrder.fulfillmentMode!=="pickup" && selectedOrder.status === "confirmed" && <OrderDeliveryEditor key={"delivery-"+selectedOrder.id+":"+selectedOrder.revision} data={data} lang={lang} busy={busy} mutate={mutate} order={selectedOrder} canSwitch={can("delivery/to-pickup")}/>}
                {can("orders/state",{field:"delivery"}) && selectedOrder.status === "confirmed" && selectedOrder.delivery !== "delivered" && <div className="detail-delivery-note"><Field label={t("deliveryNote")}><textarea maxLength={500} value={deliveryNote} onChange={e=>setDeliveryNote(e.target.value)}/></Field><small>{t("recordedResult")}</small></div>}
                </WorkspaceDetails>}
                {selectedOrder.status==="requested" && can("orders/state",{field:"status"}) && <OrderRequestReview key={"review-"+selectedOrder.id+":"+selectedOrder.revision} order={selectedOrder} lang={lang} busy={busy} mutate={mutate}/>}
                {selectedOrder.reviewNote && <p className="portal-review-note">{selectedOrder.reviewNote}</p>}
                {(isAdmin(session.role) || session.role === "dispatcher") && selectedOrder.status === "confirmed" && <OrderPaymentPanel key={"pay-"+selectedOrder.id+":"+selectedOrder.revision} lang={lang} orderId={selectedOrder.id} expectedMethod={selectedOrder.expectedPaymentMethod} canEdit onCollectionLoaded={onCollectionLoaded} onSaved={() => void load()} />}
                {(isAdmin(session.role) || session.role === "dispatcher") && selectedOrder.status === "confirmed" && <OrderFiscalPanel key={"fiscal-"+selectedOrder.id+":"+selectedOrder.revision} lang={lang} orderId={selectedOrder.id} admin={isAdmin(session.role)} onSaved={() => void load()} />}
                {(isAdmin(session.role) || session.role === "dispatcher") && selectedOrder.status === "confirmed" && <OrderInvoicePanel key={"inv-"+selectedOrder.id+":"+selectedOrder.revision} lang={lang} orderId={selectedOrder.id} onSaved={() => void load()} />}

              </>
            ) : modal === "order" ? (
              <OrderEntryForm data={data} lang={lang} orderId={orderId} initialDate={day} busy={busy} error={error} onCancel={() => setModal(null)} onSave={async (body) => { const ok = await mutate("orders", body); if (ok) { setDay(body.date); setModal(null); } return ok; }} />
            ) : (
              <form onSubmit={submit} key={modal + ":" + (editingProduct?.id ?? "new")}>
                {modal === "customer" && (
                  <>
                    <Field label={t("name")}>
                      <input name="name" required maxLength={200} />
                    </Field>
                    <Field label={t("address")}>
                      <input name="address" required maxLength={500} />
                    </Field>
                    <Field label={t("phone")}>
                      <input name="phone" type="tel" maxLength={40} />
                    </Field>
                    <Field label={t("note")}>
                      <textarea name="note" maxLength={1000} />
                    </Field>
                  </>
                )}
                {modal === "product" && (
                  <>
                    <div className="form-grid">
                      <Field label={t("huName")}>
                        <input name="hu" required maxLength={200} defaultValue={editingProduct?.hu} />
                      </Field>
                      <Field label={t("roName")}>
                        <input name="ro" required maxLength={200} defaultValue={editingProduct?.ro} />
                      </Field>
                      <Field label={t("descriptionHu")}>
                        <textarea name="descriptionHu" maxLength={1500} defaultValue={editingProduct?.descriptionHu} />
                      </Field>
                      <Field label={t("descriptionRo")}>
                        <textarea name="descriptionRo" maxLength={1500} defaultValue={editingProduct?.descriptionRo} />
                      </Field>
                      <Field label={t("catalogSection")}>
                        <select
                          name="section"
                          value={catalogSection}
                          onChange={(e) => {
                            const s = e.target.value as "daily" | "alacarte";
                            setCatalogSection(s);
                            if (s === "daily" && !(DAILY_CATEGORIES as readonly string[]).includes(productCategory)) setProductCategory("main");
                          }}
                        >
                          {SECTIONS.map((s) => (
                            <option key={s} value={s}>
                              {t("section_" + s)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={t("category")}>
                        <select name="category" value={productCategory} onChange={(e) => setProductCategory(e.target.value)}>
                          {(catalogSection === "daily" ? DAILY_CATEGORIES : CATEGORIES).map((c) => (
                            <option key={c} value={c}>
                              {t(c)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={t("portion") + " (" + portionUnit(productCategory) + ")"}>
                        <input
                          name="portion"
                          type="number"
                          min="1"
                          max="10000"
                          step="1"
                          required
                          defaultValue={editingProduct ? String(editingProduct.portion) : "350"}
                        />
                      </Field>
                      <Field label={t("price")}>
                        <input
                          name="price"
                          type="number"
                          min="0"
                          max="10000"
                          step="0.01"
                          required
                          defaultValue={editingProduct ? (editingProduct.price / 100).toFixed(2) : undefined}
                        />
                      </Field>
                    </div>
                    <fieldset className="allergen-picker">
                      <legend>{t("allergens")}</legend>
                      {allergenKeys.map((a) => (
                        <label key={a}>
                          <input type="checkbox" name="allergens" value={a} defaultChecked={!!editingProduct?.allergens.split(",").includes(a)} />
                          {t(a)}
                        </label>
                      ))}
                    </fieldset>
                  </>
                )}
                <div className="form-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setModal(null)}
                  >
                    {t("cancel")}
                  </button>
                  <button className="button" type="submit" disabled={busy}>
                    {busy ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <Check size={16} />
                    )}{" "}
                    {t(busy ? "saving" : "save")}
                  </button>
                </div>
              </form>
            )}
          </Modal>
        )}
      </div>
    </UiContext.Provider>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string }>, { id })
        : children}
    </div>
  );
}
function Modal({
  title,
  close,
  closeLabel,
  children,
  className,
}: {
  title: string;
  close: () => void;
  closeLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => {
      el?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={"modal" + (className ? " " + className : "")}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button className="icon-button" aria-label={closeLabel} onClick={close}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
