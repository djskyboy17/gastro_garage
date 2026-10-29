"use client";
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
  ChefHat,
  Truck,
  UtensilsCrossed,
  Users,
  Blocks,
  History,
  Plus,
  Search,
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronRight,
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
  Menu,
  Loader2,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import OperationsWorkspace from "./operations-workspace";
import PurchasingWorkspace from "./purchasing-workspace";
import { emptyPurchasing } from "@/src/modules/purchasing/domain";
import { emptyOperations } from "@/src/modules/inventory/domain";
import {
  today,
  total,
  portions,
  kitchenSummary,
  normalizeSearch,
  type Language,
  type AppData,
  type Order,
} from "@/src/modules/shared/domain";
const empty: AppData = {
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
  ["kitchen", ChefHat],
  ["delivery", Truck],
  ["catalog", UtensilsCrossed],
  ["customers", Users],
  ["recipes", ChefHat],
  ["inventory", Package],
  ["procurement", ClipboardList],
  ["roadmap", Blocks],
  ["audit", History],
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
function Badge({ state }: { state: string }) {
  const { lang } = useContext(UiContext);
  return (
    <span className={"badge " + state}>
      <i />
      {messages[lang][state] ?? state}
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
  const [lang, setLang] = useState<Language>("hu");
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState<AppData>(empty);
  const [day, setDay] = useState(today);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [lines, setLines] = useState([{ productId: "", quantity: 1 }]);
  const [orderId, setOrderId] = useState("");
  const [newDate, setNewDate] = useState(today);
  const [newTime, setNewTime] = useState("12:00");
  const t = (key: string) => messages[lang][key] ?? key;
  const money = (n: number) =>
    new Intl.NumberFormat(lang === "hu" ? "hu-HU" : "ro-RO", {
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
      const r = await fetch("/api/data", { cache: "no-store" });
      const d = (await r.json()) as AppData & { error?: string };
      if (!r.ok) throw new Error(d.error || "loadError");
      setData(d);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "loadError");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
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
    setTab(next);
    setQuery("");
    setFilter("all");
    setMobile(false);
  }
  function open(type: string) {
    setError("");
    setModal(type);
    if (type === "order") {
      setLines([{ productId: data.products[0]?.id ?? "", quantity: 1 }]);
      setOrderId(crypto.randomUUID());
      setNewDate(day);
      setNewTime("12:00");
    }
  }
  function detail(o: Order) {
    setSelected(o.id);
    open("detail");
  }
  async function change(o: Order, field: string, value: string) {
    await mutate("orders/state", {
      id: o.id,
      revision: o.revision,
      field,
      value,
    });
  }
  function changeDay(offset: number) {
    const d = new Date(day + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
    setDay(d.toISOString().slice(0, 10));
  }
  const active = data.orders.filter(
    (o) => o.date === day && o.status !== "cancelled",
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
    .filter((o) => o.production === "ready")
    .reduce((s, o) => s + portions(o), 0);
  const selectedOrder = data.orders.find((o) => o.id === selected);
  const longDate = new Intl.DateTimeFormat(lang === "hu" ? "hu-HU" : "ro-RO", {
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
      <Button
        onClick={() => open("order")}
        disabled={!data.products.length || !data.customers.length}
      >
        <Plus size={16} />
        {t("newOrder")}
      </Button>
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
                className={o.status === "cancelled" ? "cancelled-row" : ""}
              >
                <td>
                  <button className="customer-cell" onClick={() => detail(o)}>
                    <span className={"avatar avatar-" + (i % 4)}>
                      {o.customerName.slice(0, 1)}
                    </span>
                    <span>
                      <strong>
                        {o.customerName.replace(" · Minta / Exemplu", "")}
                      </strong>
                      <small>
                        #{o.id.slice(-6).toUpperCase()}
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
                  <Badge
                    state={
                      o.status === "cancelled" ? "cancelled" : o.production
                    }
                  />
                </td>
                <td className="number">
                  <strong>{money(total(o))}</strong>
                  <small>{t(o.payment)}</small>
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={t("open")}
                    onClick={() => detail(o)}
                  >
                    <ArrowUpRight size={18} />
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
      ],
      ...matching.flatMap((o) =>
        o.items.map((i) => [
          o.date,
          o.customerName,
          o.time,
          title(i),
          String(i.quantity),
          ((i.quantity * i.price) / 100).toFixed(2),
          t(o.production),
          t(o.delivery),
          t(o.payment),
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
        price: Math.round(Number(f.get("price")) * 100),
        portion: Number(f.get("portion")),
        allergens: f.getAll("allergens").join(","),
      };
    else
      body = {
        id: orderId,
        customerId: f.get("customerId"),
        date: newDate,
        time: newTime,
        note: f.get("note"),
        items: lines,
      };
    if (
      await mutate(
        modal === "customer"
          ? "customers"
          : modal === "product"
            ? "products"
            : "orders",
        body,
      )
    ) {
      setModal(null);
      if (modal === "order") setDay(newDate);
    }
  }
  const noData =
    !data.products.length && !data.customers.length && !data.orders.length;
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
            <span className="brand-mark">
              <UtensilsCrossed size={23} />
            </span>
            <span>
              konyha<span className="brand-dot">.</span>
              <small>{t("brand")}</small>
            </span>
          </a>
          <div className="workspace">
            <span className="workspace-icon">
              <ChefHat size={18} />
            </span>
            <span>
              <strong>Konyha Studio</strong>
              <small>{t("owner")}</small>
            </span>
            <ChevronRight size={14} />
          </div>
          <p className="nav-label">{t("workspace")}</p>
          <nav aria-label={t("workspace")}>
            {nav.map(([key, Icon], i) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => navigate(key)}
              >
                <Icon size={19} />
                <span>{t(key)}</span>
                {key === "orders" && active.length > 0 ? (
                  <span className="nav-count">{active.length}</span>
                ) : key === "roadmap" ? (
                  <span className="tiny-dot" />
                ) : null}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="seedling">
              <Leaf size={24} />
              <strong>{t("greeting")}</strong>
              <p>{t("notice")}</p>
            </div>
            <a
              href="/signout-with-chatgpt?return_to=/"
              target="_top"
              className="profile"
            >
              <span className="avatar owner-avatar">ZS</span>
              <span>
                <strong>Konyha Studio</strong>
                <small>{t("signOut")}</small>
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
            <div className="breadcrumb">
              Konyha Studio <ChevronRight size={14} />
              <strong>{t(tab)}</strong>
            </div>
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
                <p className="eyebrow">
                  {t(tab === "overview" ? "daily" : tab)}
                </p>
                <h1>
                  {t(
                    tab === "overview"
                      ? "greeting"
                      : tab === "kitchen"
                        ? "productionTitle"
                        : tab === "delivery"
                          ? "deliveryTitle"
                          : tab === "roadmap"
                            ? "roadmapTitle"
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
                          : tab === "catalog"
                            ? "catalogHint"
                            : tab === "customers"
                              ? "customerHint"
                              : tab === "roadmap"
                                ? "roadmapHint"
                                : "settingsNote",
                  )}
                </p>
              </div>
              <div className="heading-actions">
                {tab === "catalog" ? (
                  <Button onClick={() => open("product")}>
                    <Plus size={17} />
                    {t("newProduct")}
                  </Button>
                ) : tab === "customers" ? (
                  <Button onClick={() => open("customer")}>
                    <Plus size={17} />
                    {t("newCustomer")}
                  </Button>
                ) : ["overview", "orders"].includes(tab) ? (
                  <Button
                    onClick={() => open("order")}
                    disabled={!data.products.length || !data.customers.length}
                  >
                    <Plus size={17} />
                    {t("newOrder")}
                  </Button>
                ) : null}
              </div>
            </div>
            {error && (
              <div role="alert" className="error-banner">
                <AlertCircle size={18} />
                <span>{t(error) === error ? t("saveError") : t(error)}</span>
                {error === "AUTH_REQUIRED" ? (
                  <a href="/signin-with-chatgpt?return_to=/" target="_top">
                    {t("signIn")}
                  </a>
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
                {noData && !error ? (
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
                    <div className="metrics">
                      {[
                        [ClipboardList, "ordersCount", active.length, "orders"],
                        [UtensilsCrossed, "portions", count, "kitchen"],
                        [CheckCircle2, "ready", readyCount, "kitchen"],
                        [
                          Wallet,
                          "revenue",
                          money(active.reduce((s, o) => s + total(o), 0)),
                          "orders",
                        ],
                      ].map(([Icon, label, value, dest], i) => {
                        const I = Icon as typeof ClipboardList;
                        return (
                          <button
                            key={String(label)}
                            className={"metric metric-" + i}
                            onClick={() => navigate(String(dest))}
                          >
                            <div>
                              <span>{t(String(label))}</span>
                              <I size={18} />
                            </div>
                            <strong>{value as ReactNode}</strong>
                            <small>
                              {i === 2 ? (
                                <>
                                  <span className="green-dot" />
                                  {count
                                    ? Math.round((readyCount / count) * 100)
                                    : 0}
                                  % {t("readyOf")}
                                </>
                              ) : i === 3 ? (
                                t("gross")
                              ) : (
                                <>
                                  {i === 0
                                    ? active.filter(
                                        (o) => o.delivery === "pending",
                                      ).length
                                    : summary.length}{" "}
                                  {t(
                                    i === 0 ? "pending" : "items",
                                  ).toLowerCase()}
                                </>
                              )}
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
                                <strong>{title(r)}</strong>
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
                                  o.delivery === "pending" ||
                                  o.delivery === "transit",
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
                    <div className="kitchen-summary">
                      <ChefHat size={24} />
                      <strong>{count}</strong>
                      <span>
                        {t("portions")} · {summary.length}{" "}
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
                        <article className="panel kitchen-card" key={i}>
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
                            <strong>{r.quantity}</strong>
                            <span>{t("units")}</span>
                            <small>
                              {r.ready} {t("readyOf")}
                            </small>
                          </div>
                          <div className="progress-track">
                            <span
                              style={{
                                width: (r.ready / r.quantity) * 100 + "%",
                              }}
                            />
                          </div>
                        </article>
                      ))}
                    </div>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>{t("orders")}</h2>
                      </div>
                      {orderTable(daily)}
                    </section>
                  </>
                )}
                {tab === "delivery" && (
                  <div className="delivery-grid">
                    {active.filter((o) => o.delivery !== "delivered").length ? (
                      active
                        .filter((o) => o.delivery !== "delivered")
                        .sort((a, b) => a.time.localeCompare(b.time))
                        .map((o, i) => (
                          <article className="panel delivery-card" key={o.id}>
                            <div className="delivery-card-top">
                              <span className="stop-number">
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <span className="time">
                                <Clock size={15} />
                                {o.time}
                              </span>
                              <Badge state={o.delivery} />
                            </div>
                            <h2>{o.customerName}</h2>
                            <p>{o.address}</p>
                            {o.phone && (
                              <a href={"tel:" + o.phone}>{o.phone}</a>
                            )}
                            <div className="delivery-items">
                              {o.items.map((item) => (
                                <div key={item.id}>
                                  <span>{title(item)}</span>
                                  <strong>×{item.quantity}</strong>
                                </div>
                              ))}
                            </div>
                            <div className="delivery-card-bottom">
                              <span>
                                {money(total(o))}
                                <small>{t(o.payment)}</small>
                              </span>
                              <Button secondary onClick={() => detail(o)}>
                                {t("open")}
                                <ArrowUpRight size={16} />
                              </Button>
                            </div>
                          </article>
                        ))
                    ) : (
                      <div className="panel empty">
                        <Truck size={30} />
                        <h3>{t("noDelivery")}</h3>
                      </div>
                    )}
                  </div>
                )}
                {tab === "catalog" && (
                  <>
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
                        .filter((p) =>
                          normalizeSearch(p.hu + " " + p.ro).includes(
                            normalizeSearch(query),
                          ),
                        )
                        .map((p, i) => (
                          <article className="panel product-card" key={p.id}>
                            <div className={"product-visual visual-" + (i % 4)}>
                              <UtensilsCrossed size={58} strokeWidth={1} />
                              <span>{t(p.category)}</span>
                              <span className="visual-number">0{i + 1}</span>
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
                                <span>{p.portion} g</span>
                              </div>
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
                {tab === "roadmap" && (
                  <div className="module-grid">
                    {[
                      ...nav.filter(
                        ([key]) =>
                          !["overview", "roadmap", "audit"].includes(key),
                      ),
                      ["safety", CheckCircle2],
                      ["billing", Wallet],
                      ["portal", Users],
                    ].map(([key, Icon], i) => {
                      const I = Icon as typeof Blocks;
                      const available = nav.some(
                        ([keyName]) => keyName === key,
                      );
                      return (
                        <article
                          className="panel module-card"
                          key={String(key)}
                        >
                          <I size={26} />
                          <span
                            className={
                              "badge " + (available ? "ready" : "pending")
                            }
                          >
                            {t(available ? "available" : "planned")}
                          </span>
                          <h2>{t(String(key))}</h2>
                          {available && (
                            <button
                              className="text-button"
                              onClick={() => navigate(String(key))}
                            >
                              {t("open")}
                              <ArrowRight size={16} />
                            </button>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
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
                              {a.action === "state_changed"
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
                            {new Intl.DateTimeFormat(
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
                konyha. <span className="footer-dot">/</span>{" "}
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
                  ? "newProduct"
                  : modal === "customer"
                    ? "newCustomer"
                    : "orderDetail",
            )}
            close={() => !busy && setModal(null)}
            closeLabel={t("close")}
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
                    #{selectedOrder.id.slice(-6).toUpperCase()}
                  </span>
                  <Badge state={selectedOrder.status} />
                </div>
                <h3 className="detail-customer">
                  {selectedOrder.customerName}
                </h3>
                <p className="detail-address">{selectedOrder.address}</p>
                <p className="detail-date">
                  {selectedOrder.date} · {selectedOrder.time}
                  {selectedOrder.phone ? " · " + selectedOrder.phone : ""}
                </p>
                <div className="detail-items">
                  {selectedOrder.items.map((i) => (
                    <div key={i.id}>
                      <span>
                        <strong>{title(i)}</strong>
                        <small>
                          {i.allergens
                            .split(",")
                            .filter(Boolean)
                            .map(t)
                            .join(" · ")}
                        </small>
                      </span>
                      <span>×{i.quantity}</span>
                      <strong>{money(i.quantity * i.price)}</strong>
                    </div>
                  ))}
                </div>
                <div className="detail-total">
                  <span>{t("amount")}</span>
                  <strong>{money(total(selectedOrder))}</strong>
                </div>
                {selectedOrder.note && (
                  <p className="detail-note">{selectedOrder.note}</p>
                )}
                <div className="state-grid">
                  {[
                    ["production", selectedOrder.production],
                    ["delivery", selectedOrder.delivery],
                    ["payment", selectedOrder.payment],
                  ].map(([label, state]) => (
                    <div key={label}>
                      <small>{t(label)}</small>
                      <Badge state={state} />
                    </div>
                  ))}
                </div>
                {selectedOrder.status !== "cancelled" && (
                  <div className="detail-actions">
                    {selectedOrder.production === "queued" && (
                      <Button
                        onClick={() =>
                          void change(selectedOrder, "production", "cooking")
                        }
                      >
                        <ChefHat size={16} />
                        {t("startCooking")}
                      </Button>
                    )}
                    {selectedOrder.production === "cooking" && (
                      <Button
                        onClick={() =>
                          void change(selectedOrder, "production", "ready")
                        }
                      >
                        <Check size={16} />
                        {t("markReady")}
                      </Button>
                    )}
                    {selectedOrder.production === "ready" &&
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
                    {selectedOrder.delivery === "transit" && (
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
                    {selectedOrder.payment === "unpaid" && (
                      <Button
                        secondary
                        onClick={() =>
                          void change(selectedOrder, "payment", "paid")
                        }
                      >
                        <Wallet size={16} />
                        {t("markPaid")}
                      </Button>
                    )}
                    {selectedOrder.production === "queued" &&
                      selectedOrder.delivery === "pending" && (
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
                      )}
                  </div>
                )}
              </>
            ) : (
              <form onSubmit={submit}>
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
                        <input name="hu" required maxLength={200} />
                      </Field>
                      <Field label={t("roName")}>
                        <input name="ro" required maxLength={200} />
                      </Field>
                      <Field label={t("descriptionHu")}>
                        <textarea name="descriptionHu" maxLength={1500} />
                      </Field>
                      <Field label={t("descriptionRo")}>
                        <textarea name="descriptionRo" maxLength={1500} />
                      </Field>
                      <Field label={t("category")}>
                        <select name="category">
                          {["soup", "main", "vegetarian", "dessert"].map(
                            (c) => (
                              <option key={c} value={c}>
                                {t(c)}
                              </option>
                            ),
                          )}
                        </select>
                      </Field>
                      <Field label={t("portion") + " (g)"}>
                        <input
                          name="portion"
                          type="number"
                          min="1"
                          max="10000"
                          step="1"
                          required
                          defaultValue="350"
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
                        />
                      </Field>
                    </div>
                    <fieldset className="allergen-picker">
                      <legend>{t("allergens")}</legend>
                      {allergenKeys.map((a) => (
                        <label key={a}>
                          <input type="checkbox" name="allergens" value={a} />
                          {t(a)}
                        </label>
                      ))}
                    </fieldset>
                  </>
                )}
                {modal === "order" && (
                  <>
                    <Field label={t("customer")}>
                      <select name="customerId" required defaultValue="">
                        <option value="" disabled>
                          {t("chooseCustomer")}
                        </option>
                        {data.customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="form-grid">
                      <Field label={t("date")}>
                        <input
                          type="date"
                          required
                          value={newDate}
                          onChange={(e) => setNewDate(e.target.value)}
                        />
                      </Field>
                      <Field label={t("time")}>
                        <input
                          type="time"
                          required
                          value={newTime}
                          onChange={(e) => setNewTime(e.target.value)}
                        />
                      </Field>
                    </div>
                    <div className="order-lines">
                      {lines.map((line, i) => (
                        <div className="order-line" key={i}>
                          <Field label={t("items")}>
                            <select
                              required
                              value={line.productId}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((l, j) =>
                                    j === i
                                      ? { ...l, productId: e.target.value }
                                      : l,
                                  ),
                                )
                              }
                            >
                              <option value="" disabled>
                                {t("chooseProduct")}
                              </option>
                              {data.products
                                .filter(
                                  (p) =>
                                    p.id === line.productId ||
                                    !lines.some((l) => l.productId === p.id),
                                )
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {title(p)} · {money(p.price)}
                                  </option>
                                ))}
                            </select>
                          </Field>
                          <Field label={t("quantity")}>
                            <input
                              type="number"
                              min="1"
                              max="1000"
                              step="1"
                              required
                              value={line.quantity || ""}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((l, j) =>
                                    j === i
                                      ? {
                                          ...l,
                                          quantity: Number(e.target.value),
                                        }
                                      : l,
                                  ),
                                )
                              }
                            />
                          </Field>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={t("deleteLine")}
                            disabled={lines.length === 1}
                            onClick={() =>
                              setLines((prev) => prev.filter((_, j) => j !== i))
                            }
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <Button
                      secondary
                      onClick={() =>
                        setLines((prev) => [
                          ...prev,
                          {
                            productId:
                              data.products.find(
                                (p) => !prev.some((l) => l.productId === p.id),
                              )?.id ?? "",
                            quantity: 1,
                          },
                        ])
                      }
                      disabled={lines.length >= data.products.length}
                    >
                      <Plus size={15} />
                      {t("addLine")}
                    </Button>
                    <div className="detail-total">
                      <span>{t("amount")}</span>
                      <strong>
                        {money(
                          lines.reduce(
                            (s, l) =>
                              s +
                              (data.products.find((p) => p.id === l.productId)
                                ?.price ?? 0) *
                                l.quantity,
                            0,
                          ),
                        )}
                      </strong>
                    </div>
                    <Field label={t("note")}>
                      <textarea name="note" maxLength={1500} />
                    </Field>
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
}: {
  title: string;
  close: () => void;
  closeLabel: string;
  children: ReactNode;
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
      className="modal"
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
