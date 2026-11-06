"use client";
import {
  useState,
  useEffect,
  useRef,
  useId,
  cloneElement,
  isValidElement,
  type ReactNode,
  type FormEvent,
  type ReactElement,
} from "react";
import {
  Plus,
  Package,
  ChefHat,
  Leaf,
  ArrowRight,
  Download,
  Check,
  Trash2,
  X,
  AlertCircle,
  CheckCircle2,
  Clock,
  Layers,
} from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import { inboundSupply } from "@/src/modules/purchasing/domain";
import {
  today,
  type AppData,
  type Language,
  type Order,
} from "@/src/modules/shared/domain";
import {
  latestRecipe,
  recipeCost,
  grossQuantity,
  requirements,
  allocate,
  procurementPlan,
  usableLots,
  costFor,
  latestPreparation,
  type Recipe,
  type Ingredient,
  type OperationsData,
} from "@/src/modules/inventory/domain";
import { dishInfo } from "@/src/modules/inventory/nutrition";
import { DishInfoView, NutritionFields, readNutrition } from "./dish-info";
type Props = {
  tab: string;
  data: AppData;
  lang: Language;
  day: string;
  busy: boolean;
  error: string;
  onSave: (path: string, body: unknown) => Promise<boolean>;
  onOrder: (order: Order) => void;
  onCreatePurchase?: (
    lines: { ingredientId: string; quantity: number }[],
  ) => void;
};
const allergens = [
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
export default function OperationsWorkspace({
  tab,
  data,
  lang,
  day,
  busy,
  error,
  onSave,
  onOrder,
  onCreatePurchase,
}: Props) {
  const ops = data.operations;
  const t = (k: string) => messages[lang][k] ?? k;
  const name = (i: { hu: string; ro: string }) => i[lang];
  const number = (n: number) =>
    new Intl.NumberFormat(lang === "hu" ? "hu-HU" : "ro-RO", {
      maximumFractionDigits: 3,
    }).format(n);
  const money = (n: number) =>
    new Intl.NumberFormat(lang === "hu" ? "hu-HU" : "ro-RO", {
      style: "currency",
      currency: "RON",
    }).format(n / 100);
  const fmt = (n: number, unit: string) =>
    n >= 1000 && unit !== "pcs"
      ? number(n / 1000) + " " + (unit === "g" ? "kg" : "l")
      : number(n) + " " + t(unit);
  const ingredient = (id: string) => ops.ingredients.find((i) => i.id === id);
  const [section, setSection] = useState("lots");
  const [recipeQuery, setRecipeQuery] = useState("");
  const [recipeFilter, setRecipeFilter] = useState<"all" | "daily" | "alacarte" | "missing">("all");
  // v99: keresés a raktárban (alapanyag magyar/román neve, beszállító, tételszám, bizonylat); ékezetek nélkül is talál.
  const [query, setQuery] = useState("");
  // v100: több tétel kijelölése és selejtezése egy proces-verballal.
  const [woSel, setWoSel] = useState<Record<string, string>>({});
  const [woReason, setWoReason] = useState("Expirat");
  const [woNote, setWoNote] = useState("");
  async function writeOff() {
    const id = crypto.randomUUID();
    const lines = Object.entries(woSel).map(([lotId, q]) => ({ lotId, quantity: Math.round(Number(q.replace(",", "."))) }));
    if (lines.some((l) => !Number.isFinite(l.quantity) || l.quantity <= 0)) return;
    const win = window.open("", "_blank");
    const ok = await onSave("operations/write-off", { id, reason: woReason + (woNote.trim() ? " – " + woNote.trim() : ""), lines });
    if (ok) {
      setWoSel({});
      setWoNote("");
      if (win) win.location.href = "/api/production/doc?id=" + id;
    } else win?.close();
  }
  const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hit = (...parts: (string | undefined | null)[]) => !query.trim() || norm(parts.filter(Boolean).join(" ")).includes(norm(query.trim()));
  const [modal, setModal] = useState<string | null>(null);
  const [minimum, setMinimum] = useState(false);
  const [unit, setUnit] = useState("g");
  const [recipeProduct, setRecipeProduct] = useState("");
  const [yieldPortions, setYield] = useState(10);
  const [recipeNote, setRecipeNote] = useState("");
  const [recipeRows, setRecipeRows] = useState([
    { ingredientId: "", quantity: 100, lossBps: 0 },
  ]);
  const [recipePreps, setRecipePreps] = useState<
    { preparationId: string; quantity: number; lossBps: number }[]
  >([]);
  const [detailsId, setDetailsId] = useState("");
  const [prepId, setPrepId] = useState("");
  const [prepUnit, setPrepUnit] = useState("g");
  const [prepOutput, setPrepOutput] = useState(1000);
  const [prepNote, setPrepNote] = useState("");
  const [prepRows, setPrepRows] = useState([
    { ingredientId: "", quantity: 100, lossBps: 0 },
  ]);
  const [selectedIngredient, setSelectedIngredient] = useState("");
  const [selectedLot, setSelectedLot] = useState("");
  const [requestId, setRequestId] = useState("");
  const [selectedOrder, setSelectedOrder] = useState("");
  const [actual, setActual] = useState<Record<string, number>>({});
  const issueOrders = data.orders.filter(
    (o) =>
      o.date === day &&
      o.status === "confirmed" &&
      ["queued", "cooking"].includes(o.production) &&
      o.delivery === "pending" &&
      !ops.issues.some((i) => i.orderId === o.id),
  );
  const order = issueOrders.find((o) => o.id === selectedOrder);
  const req = order
    ? requirements(order, ops.recipes, ops.preparationVersions)
    : {
        needs: new Map<string, number>(),
        missing: [] as string[],
        recipeIds: [] as string[],
      };
  const allocations = allocate(
    new Map(Object.entries(actual)),
    ops.lots,
    today(),
  );
  const plan = procurementPlan(
    data.orders,
    ops,
    day,
    minimum,
    inboundSupply(data.purchasing, day),
  );
  const shortage = plan.rows.filter((r) => r.shortage > 0);
  const soonDate = new Date(today() + "T12:00:00Z");
  soonDate.setUTCDate(soonDate.getUTCDate() + 3);
  const soon = soonDate.toISOString().slice(0, 10);
  function chooseOrder(id: string) {
    setSelectedOrder(id);
    const o = issueOrders.find((o) => o.id === id);
    setActual(
      o
        ? Object.fromEntries(
            requirements(o, ops.recipes, ops.preparationVersions).needs,
          )
        : {},
    );
  }
  function open(type: string, id?: string) {
    setRequestId(crypto.randomUUID());
    setModal(type);
    if (type === "ingredient") setUnit("g");
    if (type === "receipt")
      setSelectedIngredient(id ?? ops.ingredients[0]?.id ?? "");
    if (type === "waste") setSelectedLot(id ?? "");
    if (type === "issue") chooseOrder(issueOrders[0]?.id ?? "");
    if (type === "ingredientDetails") setDetailsId(id ?? "");
    if (type === "preparation") {
      const prep = ops.preparations.find((p) => p.id === id);
      const v = prep ? latestPreparation(prep.id, ops.preparationVersions) : undefined;
      setPrepId(prep?.id ?? "");
      setPrepUnit(prep?.unit ?? "g");
      setPrepOutput(v?.output ?? 1000);
      setPrepNote(v?.note ?? "");
      setPrepRows(
        v
          ? v.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: l.quantity, lossBps: l.lossBps }))
          : [{ ingredientId: ops.ingredients[0]?.id ?? "", quantity: 100, lossBps: 0 }],
      );
    }
    if (type === "recipe") {
      const p = id ?? data.products[0]?.id ?? "";
      setRecipeProduct(p);
      const r = latestRecipe(p, ops.recipes);
      setRecipePreps(
        (r?.preparations ?? []).map((l) => ({
          preparationId: l.preparationId,
          quantity: l.quantity,
          lossBps: l.lossBps,
        })),
      );
      setYield(r?.yield ?? 10);
      setRecipeNote(r?.note ?? "");
      setRecipeRows(
        r
          ? r.lines.map((l) => ({
              ingredientId: l.ingredientId,
              quantity: l.quantity,
              lossBps: l.lossBps,
            }))
          : [
              {
                ingredientId: ops.ingredients[0]?.id ?? "",
                quantity: 100,
                lossBps: 0,
              },
            ],
      );
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let body: unknown,
      path = "";
    if (modal === "ingredient") {
      path = "ingredients";
      body = {
        hu: f.get("hu"),
        ro: f.get("ro"),
        unit,
        packQuantity: Number(f.get("packQuantity")),
        packPrice: Math.round(Number(f.get("packPrice")) * 100),
        minStock: Number(f.get("minStock")),
        supplier: f.get("supplier"),
        allergens: f.getAll("allergens").join(","),
        nutrition: readNutrition(f),
        frozen: f.get("frozen") === "on",
        gramsPerPiece: unit === "pcs" && f.get("gramsPerPiece") ? Number(f.get("gramsPerPiece")) : null,
      };
    }
    if (modal === "ingredientDetails") {
      const i = ingredient(detailsId);
      path = "ingredient-details";
      body = {
        id: detailsId,
        allergens: f.getAll("allergens").join(","),
        nutrition: readNutrition(f),
        frozen: f.get("frozen") === "on",
        gramsPerPiece: i?.unit === "pcs" && f.get("gramsPerPiece") ? Number(f.get("gramsPerPiece")) : null,
      };
    }
    if (modal === "preparation") {
      path = "preparations";
      body = {
        ...(prepId
          ? { preparationId: prepId }
          : { hu: f.get("hu"), ro: f.get("ro"), unit: prepUnit }),
        output: prepOutput,
        note: prepNote,
        lines: prepRows,
      };
    }
    if (modal === "recipe") {
      path = "recipes";
      body = {
        productId: recipeProduct,
        yield: yieldPortions,
        note: recipeNote,
        lines: recipeRows.filter((r) => r.ingredientId),
        preparations: recipePreps.filter((r) => r.preparationId),
      };
    }
    if (modal === "receipt") {
      path = "receive";
      body = {
        id: requestId,
        ingredientId: selectedIngredient,
        batch: f.get("batch"),
        supplier: f.get("supplier"),
        received: f.get("received"),
        expires: f.get("expires"),
        quantity: Number(f.get("quantity")),
        totalCost: Math.round(Number(f.get("totalCost")) * 100),
        document: f.get("document"),
      };
    }
    if (modal === "waste") {
      path = "waste";
      body = {
        id: requestId,
        lotId: selectedLot,
        quantity: Number(f.get("quantity")),
        note: f.get("note"),
      };
    }
    if (modal === "issue" && order) {
      path = "issue";
      body = {
        orderId: order.id,
        revision: order.revision,
        recipeIds: req.recipeIds,
        note: f.get("note"),
        actual: Object.entries(actual).map(([ingredientId, quantity]) => ({
          ingredientId,
          quantity,
        })),
      };
    }
    if (path && (await onSave("operations/" + path, body))) setModal(null);
  }
  function exportPlan() {
    const rows = [
      [
        t("ingredients"),
        t("supplier"),
        t("baseUnit"),
        t("required"),
        t("availableStock"),
        t("incomingSupply"),
        t("shortage"),
        t("estimatedCost"),
      ],
      ...shortage.map((r) => [
        name(r.ingredient),
        r.ingredient.supplier,
        t(r.ingredient.unit),
        String(r.required),
        String(r.available),
        String(r.incoming),
        String(r.shortage),
        (r.estimatedCost / 100).toFixed(2),
      ]),
    ];
    const safe = (v: string) =>
      '"' + (/^[=+\-@\t\r]/.test(v) ? "'" + v : v).replaceAll('"', '""') + '"';
    const url = URL.createObjectURL(
      new Blob(
        ["\uFEFF" + rows.map((r) => r.map(safe).join(";")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "beszerzes-" + day + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const lotStatus = (expires: string) =>
    expires < today() ? "expired" : expires <= soon ? "expiring" : "usable";
  return (
    <div className="operations-workspace">
      <div className="ops-actions">
        {tab === "recipes" ? (
          <OpButton
            busy={busy}
            action={() => open("recipe")}
            disabled={!ops.ingredients.length || !data.products.length}
          >
            <Plus size={16} />
            {t("newRecipe")}
          </OpButton>
        ) : tab === "inventory" ? (
          <>
            <OpButton
              busy={busy}
              action={() => open("receipt")}
              disabled={!ops.ingredients.length}
            >
              <Plus size={16} />
              {t("receive")}
            </OpButton>
            <OpButton busy={busy} secondary action={() => open("ingredient")}>
              <Leaf size={16} />
              {t("newIngredient")}
            </OpButton>
            <small>{t("USE_DAILY_MATERIALS")}</small>
          </>
        ) : (
          <>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={minimum}
                onChange={(e) => setMinimum(e.target.checked)}
              />
              {t("includeMinimum")}
            </label>
            <OpButton
              busy={busy}
              secondary
              action={exportPlan}
              disabled={!shortage.length}
            >
              <Download size={16} />
              {t("downloadPlan")}
            </OpButton>
            {onCreatePurchase && (
              <OpButton
                busy={busy}
                action={() =>
                  onCreatePurchase(
                    shortage.map((r) => ({
                      ingredientId: r.ingredient.id,
                      quantity: r.shortage,
                    })),
                  )
                }
                disabled={
                  !shortage.length ||
                  !data.purchasing.suppliers.length ||
                  shortage.length > 25
                }
              >
                <Plus size={15} />
                {t("createFromPlan")}
              </OpButton>
            )}
          </>
        )}
      </div>
      {!ops.ingredients.some((i) => i.id === "sample-chicken") && (
        <section className="welcome">
          <span className="welcome-icon">
            <Package size={30} />
          </span>
          <div>
            <h2>{t("inventoryDemo")}</h2>
            <p>{t("inventoryDemoHint")}</p>
            <div className="welcome-actions">
              <OpButton
                busy={busy}
                action={async () => {
                  if (!data.products.some((p) => p.id === "demo-p1")) {
                    if (!(await onSave("demo", {}))) return;
                  }
                  await onSave("operations/demo", {});
                }}
              >
                <Plus size={15} />
                {t("inventoryDemo")}
              </OpButton>
              <OpButton busy={busy} secondary action={() => open("ingredient")}>
                {t("newIngredient")}
              </OpButton>
            </div>
          </div>
        </section>
      )}
      {tab === "recipes" && (
        <>
          <p className="ops-note">{t("recipeHint")}</p>
          <section className="panel preparation-panel">
            <div className="panel-heading">
              <h2>{t("preparations")}</h2>
              <OpButton
                busy={busy}
                secondary
                action={() => open("preparation")}
                disabled={!ops.ingredients.length}
              >
                <Plus size={14} />
                {t("newPreparation")}
              </OpButton>
            </div>
            <p className="ops-note">{t("preparationHint")}</p>
            {ops.preparations.length === 0 ? (
              <p className="quiet-empty">{t("noPreparations")}</p>
            ) : (
              <div className="recipe-list">
                {ops.preparations.map((p) => {
                  const v = latestPreparation(p.id, ops.preparationVersions);
                  return (
                    <article className="recipe-panel" key={p.id}>
                      <div className="recipe-title">
                        <span className="food-icon">
                          <Layers size={20} />
                        </span>
                        <div>
                          <h2>{name(p)}</h2>
                          <small>
                            {v
                              ? "v" + v.version + " · " + fmt(v.output, p.unit)
                              : t("missingRecipe")}
                          </small>
                        </div>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => open("preparation", p.id)}
                        >
                          <Plus size={14} />
                          {t("newVersion")}
                        </button>
                      </div>
                      {v && (
                        <div className="recipe-ingredients">
                          {v.lines.map((l) => {
                            const i = ingredient(l.ingredientId);
                            return i ? (
                              <div key={l.id}>
                                <span>{name(i)}</span>
                                <strong>{fmt(l.quantity, i.unit)}</strong>
                                {l.lossBps > 0 && (
                                  <small>
                                    {number(l.lossBps / 100)}%{" "}
                                    {t("loss").replace(" (%)", "").toLowerCase()}
                                  </small>
                                )}
                              </div>
                            ) : null;
                          })}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
          {/* v104: receptek áttekinthetően – kereső, szűrő, ételenként egy összecsukható sor. */}
          <div className="recipe-toolbar">
            <input type="search" placeholder={t("recipeSearch")} value={recipeQuery} onChange={(e) => setRecipeQuery(e.target.value)} />
            {(["all", "daily", "alacarte", "missing"] as const).map((k) => (
              <button key={k} type="button" className={"button secondary" + (recipeFilter === k ? " selected" : "")} aria-pressed={recipeFilter === k} onClick={() => setRecipeFilter(k)}>
                {t("recipeFilter_" + k)}
              </button>
            ))}
          </div>
          <div className="recipe-list recipe-folds">
            {data.products.filter((p) => {
              const r = latestRecipe(p.id, ops.recipes);
              if (recipeFilter === "daily" && p.section !== "daily") return false;
              if (recipeFilter === "alacarte" && p.section === "daily") return false;
              if (recipeFilter === "missing" && r) return false;
              return !recipeQuery.trim() || norm(p.hu + " " + p.ro).includes(norm(recipeQuery.trim()));
            }).map((p) => {
              const r = latestRecipe(p.id, ops.recipes);
              return (
                <details className="panel recipe-panel recipe-fold" key={p.id}>
                  <summary className="recipe-title">
                    <span className="food-icon">
                      <ChefHat size={22} />
                    </span>
                    <div>
                      <h2>{name(p)}</h2>
                      <small>
                        {r
                          ? "v" +
                            r.version +
                            " · " +
                            r.yield +
                            " " +
                            t("units") +
                            " · " +
                            ops.recipes.filter((v) => v.productId === p.id)
                              .length +
                            " " +
                            t("versions") +
                            " · " +
                            r.lines.length +
                            " " +
                            t("recipeIngredientCount") +
                            " · " +
                            money(Math.round(recipeCost(r, ops.ingredients, ops.preparationVersions) / Math.max(1, r.yield))) +
                            " / " +
                            t("recipePortion")
                          : t("missingRecipe")}
                      </small>
                    </div>
                    <button
                      className="button secondary"
                      disabled={!ops.ingredients.length || busy}
                      onClick={(e) => { e.preventDefault(); open("recipe", p.id); }}
                    >
                      <Plus size={14} />
                      {t(r ? "newVersion" : "newRecipe")}
                    </button>
                  </summary>
                  {r ? (
                    <>
                      <div className="recipe-ingredients">
                        {r.lines.map((l) => {
                          const i = ingredient(l.ingredientId);
                          return i ? (
                            <div key={l.id}>
                              <span>{name(i)}</span>
                              <strong>{fmt(l.quantity, i.unit)}</strong>
                              {l.lossBps > 0 && (
                                <small>
                                  {number(l.lossBps / 100)}%{" "}
                                  {t("loss").replace(" (%)", "").toLowerCase()}
                                </small>
                              )}
                            </div>
                          ) : null;
                        })}
                        {(r.preparations ?? []).map((l) => {
                          const prep = ops.preparations.find((p) => p.id === l.preparationId);
                          return prep ? (
                            <div key={l.id}>
                              <span>
                                <Layers size={13} /> {name(prep)}
                              </span>
                              <strong>{fmt(l.quantity, prep.unit)}</strong>
                              {l.lossBps > 0 && (
                                <small>
                                  {number(l.lossBps / 100)}%{" "}
                                  {t("loss").replace(" (%)", "").toLowerCase()}
                                </small>
                              )}
                            </div>
                          ) : null;
                        })}
                      </div>
                      <div className="recipe-cost">
                        <span>
                          {t("ingredientCost")}
                          <small>{t("costHint")}</small>
                        </span>
                        <strong>
                          {money(recipeCost(r, ops.ingredients, ops.preparationVersions))}
                        </strong>
                      </div>
                      {(() => {
                        const info = dishInfo(p, ops);
                        return info ? <DishInfoView info={info} lang={lang} t={t} /> : null;
                      })()}
                    </>
                  ) : (
                    <p className="quiet-empty">{t("noRecipes")}</p>
                  )}
                </details>
              );
            })}
          </div>
        </>
      )}
      {tab === "inventory" && (
        <>
          <div className="metrics ops-metrics">
            {[
              [t("lots"), ops.lots.filter((l) => l.remaining > 0).length],
              [
                t("expiring"),
                ops.lots.filter(
                  (l) =>
                    l.remaining > 0 &&
                    l.expires >= today() &&
                    l.expires <= soon,
                ).length,
              ],
              [
                t("expired"),
                ops.lots.filter((l) => l.remaining > 0 && l.expires < today())
                  .length,
              ],
              [
                t("stockValue"),
                money(
                  ops.lots.reduce(
                    (s, l) => s + costFor(l.remaining, l.totalCost, l.quantity),
                    0,
                  ),
                ),
              ],
            ].map(([label, value], idx) => (
              <div className={"metric metric-" + idx} key={label}>
                <div>
                  <span>{label}</span>
                  <Package size={17} />
                </div>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="ops-tabs" role="tablist" aria-label={t("inventory")}>
            {["lots", "ingredients", "movements"].map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={section === s}
                onClick={() => setSection(s)}
                className={section === s ? "selected" : ""}
              >
                {t(s)}
              </button>
            ))}
          </div>
          <label className="field inventory-search">
            <span>{t("inventorySearch")}</span>
            <input type="search" value={query} maxLength={60} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <section className="panel">
            {section === "lots" && Object.keys(woSel).length > 0 && (
              <div className="writeoff-panel">
                <strong>{t("writeOffTitle")}</strong>
                {Object.entries(woSel).map(([lotId, q]) => {
                  const l = ops.lots.find((x) => x.id === lotId);
                  const i = l ? ingredient(l.ingredientId) : undefined;
                  return (
                    <label key={lotId} className="writeoff-line">
                      <span>{i ? name(i) : "—"} · {l?.batch}</span>
                      <input inputMode="decimal" value={q} disabled={busy} onChange={(e) => setWoSel({ ...woSel, [lotId]: e.target.value })} />
                      <small>{i?.unit ?? "g"} / {l ? fmt(l.remaining, i?.unit ?? "g") : ""}</small>
                    </label>
                  );
                })}
                <label className="writeoff-line">
                  <span>{t("writeOffReason")}</span>
                  <select value={woReason} disabled={busy} onChange={(e) => setWoReason(e.target.value)}>
                    {["Expirat", "Degradat", "Deteriorat", "Altele"].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <input value={woNote} maxLength={200} placeholder={t("writeOffNote")} disabled={busy} onChange={(e) => setWoNote(e.target.value)} />
                </label>
                <div className="production-actions">
                  <button type="button" className="button" disabled={busy} onClick={() => void writeOff()}>{t("writeOffSubmit")}</button>
                  <button type="button" className="button secondary" disabled={busy} onClick={() => setWoSel({})}>{t("cancel")}</button>
                </div>
                <small>{t("writeOffHint")}</small>
              </div>
            )}
            {section === "lots" && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th />
                      <th>{t("ingredients")}</th>
                      <th>{t("batch")}</th>
                      <th>{t("received")}</th>
                      <th>{t("expires")}</th>
                      <th>{t("remaining")}</th>
                      <th>{t("stockState")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {ops.lots
                      .filter((l) => { const i = ingredient(l.ingredientId); return hit(i?.hu, i?.ro, l.supplier, l.batch, l.document); })
                      .sort((a, b) => a.expires.localeCompare(b.expires))
                      .map((l) => {
                        const i = ingredient(l.ingredientId);
                        return (
                          <tr key={l.id}>
                            <td>
                              <input type="checkbox" aria-label={t("writeOffSelect")} disabled={busy || l.remaining <= 0} checked={woSel[l.id] !== undefined} onChange={(e) => { const next = { ...woSel }; if (e.target.checked) next[l.id] = String(l.remaining); else delete next[l.id]; setWoSel(next); }} />
                            </td>
                            <td>
                              <strong>{i ? name(i) : "—"}</strong>
                              <small>{l.supplier}</small>
                            </td>
                            <td>
                              {l.batch}
                              <small>{l.document || "—"}</small>
                            </td>
                            <td>{l.received}</td>
                            <td>{l.expires}</td>
                            <td>
                              <strong>
                                {fmt(l.remaining, i?.unit ?? "g")}
                              </strong>
                              <small>{t("receivedQuantity")}: {fmt(l.quantity, i?.unit ?? "g")}</small>
                              {!!l.adjustmentTotal&&<small>{t("countAdjustments")}: {l.adjustmentTotal>0?"+":"−"}{fmt(Math.abs(l.adjustmentTotal),i?.unit??"g")}</small>}
                            </td>
                            <td>
                              <span
                                className={
                                  "badge " +
                                  (lotStatus(l.expires) === "expired"
                                    ? "failed"
                                    : lotStatus(l.expires) === "expiring"
                                      ? "cooking"
                                      : "ready")
                                }
                              >
                                {t(lotStatus(l.expires))}
                              </span>
                            </td>
                            <td>
                              {l.remaining > 0 && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => open("waste", l.id)}
                                >
                                  <Trash2 size={14} />
                                  {t("waste")}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                {!ops.lots.length && (
                  <p className="quiet-empty">{t("noLots")}</p>
                )}
              </div>
            )}
            {section === "ingredients" && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("ingredients")}</th>
                      <th>{t("supplier")}</th>
                      <th>{t("packPrice")}</th>
                      <th>{t("minimum")}</th>
                      <th>{t("allergens")}</th>
                      <th>{t("nutritionShort")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {ops.ingredients.filter((i) => hit(i.hu, i.ro)).map((i) => (
                      <tr key={i.id}>
                        <td>
                          <strong>{name(i)}</strong>
                          <small>{i[lang === "hu" ? "ro" : "hu"]}</small>
                        </td>
                        <td>{i.supplier || "—"}</td>
                        <td>
                          {money(i.packPrice)}
                          <small>/ {fmt(i.packQuantity, i.unit)}</small>
                        </td>
                        <td>{fmt(i.minStock, i.unit)}</td>
                        <td>
                          {i.allergens
                            ? i.allergens.split(",").map(t).join(", ")
                            : "—"}
                        </td>
                        <td>
                          <span className={"badge " + (i.nutrition ? "ready" : "pending")}>
                            {t(i.nutrition ? "nutritionGiven" : "nutritionNone")}
                          </span>
                          {!!i.frozen && <small>{t("frozen")}</small>}
                        </td>
                        <td>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => open("receipt", i.id)}
                          >
                            <Plus size={14} />
                            {t("receive")}
                          </button>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => open("ingredientDetails", i.id)}
                          >
                            {t("editDetails")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!ops.ingredients.length && (
                  <p className="quiet-empty">{t("noIngredients")}</p>
                )}
              </div>
            )}
            {section === "movements" && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("date")}</th>
                      <th>{t("ingredients")}</th>
                      <th>{t("batch")}</th>
                      <th>{t("status")}</th>
                      <th>{t("stockQuantity")}</th>
                      <th>{t("note")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ops.moves.filter((m) => { const lot = ops.lots.find((l) => l.id === m.lotId); const i = lot ? ingredient(lot.ingredientId) : undefined; return hit(i?.hu, i?.ro, lot?.batch, lot?.supplier, m.note); }).map((m) => {
                      const lot = ops.lots.find((l) => l.id === m.lotId);
                      const i = lot ? ingredient(lot.ingredientId) : undefined;
                      const issue = ops.issues.find((s) => s.id === m.issueId);
                      const related = data.orders.find(
                        (o) => o.id === issue?.orderId,
                      );
                      return (
                        <tr key={m.id}>
                          <td>
                            {new Intl.DateTimeFormat(
                              lang === "hu" ? "hu-HU" : "ro-RO",
                              {
                                dateStyle: "short",
                                timeStyle: "short",
                                timeZone: "Europe/Bucharest",
                              },
                            ).format(new Date(m.createdAt))}
                          </td>
                          <td>{i ? name(i) : "—"}</td>
                          <td>{lot?.batch}</td>
                          <td>
                            <span
                              className={
                                "badge " +
                                (m.quantity > 0
                                  ? "ready"
                                  : m.kind === "waste"
                                    ? "failed"
                                    : "cooking")
                              }
                            >
                              {t(
                                m.kind === "count_adjustment" ? "countAdjustmentKind" : m.kind === "count_reversal" ? "countReversalKind" : m.kind === "receipt_reversal" ? "receiptReversalKind" : m.kind === "production" ? "productionMovesKind" : m.kind === "production_reversal" ? "productionReversalKind" : m.kind === "received"
                                  ? "receivedKind"
                                  : m.kind === "waste"
                                    ? "wasteKind"
                                    : "issued",
                              )}
                            </span>
                          </td>
                          <td>
                            <strong>
                              {m.quantity > 0 ? "+" : "−"}
                              {fmt(Math.abs(m.quantity), i?.unit ?? "g")}
                            </strong>
                          </td>
                          <td>
                            {related ? (
                              <button
                                className="text-button"
                                onClick={() => onOrder(related)}
                              >
                                {related.customerName}
                                <ArrowRight size={13} />
                              </button>
                            ) : (
                              m.note || "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!ops.moves.length && (
                  <p className="quiet-empty">{t("noMoves")}</p>
                )}
              </div>
            )}
          </section>
          <section className="panel issue-orders">
            <div className="panel-heading">
              <h2>{t("todayIssues")}</h2>
              <ChefHat size={19} />
            </div>
            {data.orders
              .filter((o) => o.date === day && o.status === "confirmed")
              .map((o) => (
                <div className="issue-order-row" key={o.id}>
                  <button className="text-button" onClick={() => onOrder(o)}>
                    {o.time} · {o.customerName}
                  </button>
                  <span
                    className={
                      "badge " +
                      (ops.issues.some((i) => i.orderId === o.id)
                        ? "ready"
                        : "pending")
                    }
                  >
                    {t(
                      ops.issues.some((i) => i.orderId === o.id)
                        ? "alreadyIssued"
                        : "notIssued",
                    )}
                  </span>
                </div>
              ))}
          </section>
        </>
      )}
      {tab === "procurement" && (
        <>
          <p className="ops-note">{t("procurementHint")}</p>
          {plan.missing.length > 0 && (
            <div className="warning-note">
              <AlertCircle size={20} />
              <div>
                <strong>{t("missingRecipeHint")}</strong>
                <p>
                  {plan.missing
                    .map((id) => {
                      const p = data.products.find((p) => p.id === id);
                      return p ? name(p) : id;
                    })
                    .join(" · ")}
                </p>
              </div>
            </div>
          )}
          <div className="procurement-summary">
            <div>
              <p className="eyebrow">{t("shortage")}</p>
              <strong>
                {shortage.length}{" "}
                <small>{t("ingredients").toLowerCase()}</small>
              </strong>
            </div>
            <div>
              <p className="eyebrow">{t("estimatedCost")}</p>
              <strong>
                {money(shortage.reduce((s, r) => s + r.estimatedCost, 0))}
              </strong>
            </div>
          </div>
          <section className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("ingredients")}</th>
                    <th>{t("supplier")}</th>
                    <th>{t("required")}</th>
                    <th>{t("availableStock")}</th>
                    <th>{t("incomingSupply")}</th>
                    <th>{t("uncovered")}</th>
                    <th className="number">{t("estimatedCost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((r) => (
                    <tr key={r.ingredient.id}>
                      <td>
                        <strong>{name(r.ingredient)}</strong>
                      </td>
                      <td>{r.ingredient.supplier || "—"}</td>
                      <td>{fmt(r.required, r.ingredient.unit)}</td>
                      <td>{fmt(r.available, r.ingredient.unit)}</td>
                      <td>{fmt(r.incoming, r.ingredient.unit)}</td>
                      <td>
                        <strong className={r.shortage ? "shortage-value" : ""}>
                          {fmt(r.shortage, r.ingredient.unit)}
                        </strong>
                      </td>
                      <td className="number">{money(r.estimatedCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!plan.rows.length ? (
              <p className="quiet-empty">{t("noPlan")}</p>
            ) : (
              !shortage.length && (
                <p className="ops-success">
                  <CheckCircle2 size={17} />
                  {t(
                    plan.rows.some((r) => r.incoming > 0)
                      ? "coveredByIncoming"
                      : "noShortage",
                  )}
                </p>
              )
            )}
          </section>
        </>
      )}
      {modal && (
        <OperationDialog
          title={t(
            modal === "ingredient"
              ? "newIngredient"
              : modal === "ingredientDetails"
                ? "editDetails"
                : modal === "preparation"
                  ? prepId
                    ? "newVersion"
                    : "newPreparation"
                  : modal === "recipe"
                ? "newVersion"
                : modal === "receipt"
                  ? "receive"
                  : modal === "issue"
                    ? "issue"
                    : "waste",
          )}
          close={() => !busy && setModal(null)}
          closeLabel={t("close")}
        >
          <form onSubmit={submit}>
            {error && (
              <div role="alert" className="error-banner">
                {messages[lang][error] ?? t("saveError")}
              </div>
            )}
            {modal === "ingredient" && (
              <>
                <div className="form-grid">
                  <OpField label={t("huName")}>
                    <input name="hu" required maxLength={200} />
                  </OpField>
                  <OpField label={t("roName")}>
                    <input name="ro" required maxLength={200} />
                  </OpField>
                  <OpField label={t("baseUnit")}>
                    <select
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                    >
                      {["g", "ml", "pcs"].map((u) => (
                        <option key={u} value={u}>
                          {t(u)}
                        </option>
                      ))}
                    </select>
                  </OpField>
                  <OpField label={t("packQuantity") + " (" + t(unit) + ")"}>
                    <input
                      name="packQuantity"
                      type="number"
                      min="1"
                      max="10000000"
                      step="1"
                      required
                      defaultValue="1000"
                    />
                  </OpField>
                  <OpField label={t("packPrice")}>
                    <input
                      name="packPrice"
                      type="number"
                      min="0"
                      max="100000"
                      step="0.01"
                      required
                    />
                  </OpField>
                  <OpField label={t("minimum") + " (" + t(unit) + ")"}>
                    <input
                      name="minStock"
                      type="number"
                      min="0"
                      max="10000000"
                      step="1"
                      required
                      defaultValue="0"
                    />
                  </OpField>
                </div>
                <OpField label={t("supplier")}>
                  <input name="supplier" maxLength={200} />
                </OpField>
                <fieldset className="allergen-picker">
                  <legend>{t("allergens")}</legend>
                  {allergens.map((a) => (
                    <label key={a}>
                      <input type="checkbox" name="allergens" value={a} />
                      {t(a)}
                    </label>
                  ))}
                </fieldset>
                <label className="checkbox-label">
                  <input type="checkbox" name="frozen" />
                  {t("frozenIngredient")}
                </label>
                {unit === "pcs" && (
                  <OpField label={t("gramsPerPiece")}>
                    <input name="gramsPerPiece" type="number" min="1" max="100000" step="1" />
                  </OpField>
                )}
                <NutritionFields t={t} />
              </>
            )}
            {modal === "ingredientDetails" &&
              (() => {
                const i = ingredient(detailsId);
                if (!i) return null;
                const current = i.allergens.split(",").filter(Boolean);
                return (
                  <>
                    <p className="ops-note">
                      <strong>{name(i)}</strong> · {t(i.unit)}
                    </p>
                    <fieldset className="allergen-picker">
                      <legend>{t("allergens")}</legend>
                      {allergens.map((a) => (
                        <label key={a}>
                          <input type="checkbox" name="allergens" value={a} defaultChecked={current.includes(a)} />
                          {t(a)}
                        </label>
                      ))}
                    </fieldset>
                    <p className="ops-note">{t("allergenEditHint")}</p>
                    <label className="checkbox-label">
                      <input type="checkbox" name="frozen" defaultChecked={!!i.frozen} />
                      {t("frozenIngredient")}
                    </label>
                    {i.unit === "pcs" && (
                      <OpField label={t("gramsPerPiece")}>
                        <input
                          name="gramsPerPiece"
                          type="number"
                          min="1"
                          max="100000"
                          step="1"
                          defaultValue={i.gramsPerPiece ?? ""}
                        />
                      </OpField>
                    )}
                    <NutritionFields t={t} initial={i.nutrition} />
                  </>
                );
              })()}
            {modal === "preparation" && (
              <>
                {prepId ? (
                  <p className="ops-note">
                    <strong>{name(ops.preparations.find((p) => p.id === prepId) ?? { hu: "", ro: "" })}</strong>
                  </p>
                ) : (
                  <div className="form-grid">
                    <OpField label={t("huName")}>
                      <input name="hu" required maxLength={200} />
                    </OpField>
                    <OpField label={t("roName")}>
                      <input name="ro" required maxLength={200} />
                    </OpField>
                    <OpField label={t("preparationUnit")}>
                      <select value={prepUnit} onChange={(e) => setPrepUnit(e.target.value)}>
                        {["g", "ml"].map((u) => (
                          <option key={u} value={u}>
                            {t(u)}
                          </option>
                        ))}
                      </select>
                    </OpField>
                  </div>
                )}
                <OpField label={t("preparationOutput") + " (" + t(prepUnit) + ")"}>
                  <input
                    type="number"
                    min="1"
                    max="10000000"
                    step="1"
                    required
                    value={prepOutput || ""}
                    onChange={(e) => setPrepOutput(Number(e.target.value))}
                  />
                </OpField>
                {prepRows.map((row, idx) => (
                  <div className="recipe-editor-line" key={idx}>
                    <OpField label={t("ingredients")}>
                      <select
                        value={row.ingredientId}
                        required
                        onChange={(e) =>
                          setPrepRows((prev) => prev.map((r, j) => (j === idx ? { ...r, ingredientId: e.target.value } : r)))
                        }
                      >
                        <option value="" disabled>
                          {t("selectIngredient")}
                        </option>
                        {ops.ingredients
                          .filter((i) => i.id === row.ingredientId || !prepRows.some((r) => r.ingredientId === i.id))
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {name(i)} · {t(i.unit)}
                            </option>
                          ))}
                      </select>
                    </OpField>
                    <OpField label={t("netQuantity") + " (" + t(ingredient(row.ingredientId)?.unit ?? "g") + ")"}>
                      <input
                        type="number"
                        min="1"
                        max="10000000"
                        step="1"
                        required
                        value={row.quantity || ""}
                        onChange={(e) =>
                          setPrepRows((prev) => prev.map((r, j) => (j === idx ? { ...r, quantity: Number(e.target.value) } : r)))
                        }
                      />
                    </OpField>
                    <OpField label={t("loss")}>
                      <input
                        type="number"
                        min="0"
                        max="90"
                        step="0.01"
                        required
                        value={row.lossBps / 100}
                        onChange={(e) =>
                          setPrepRows((prev) =>
                            prev.map((r, j) => (j === idx ? { ...r, lossBps: Math.round(Number(e.target.value) * 100) } : r)),
                          )
                        }
                      />
                    </OpField>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t("remove")}
                      disabled={prepRows.length === 1}
                      onClick={() => setPrepRows((prev) => prev.filter((_, j) => j !== idx))}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <OpButton
                  busy={busy}
                  secondary
                  disabled={prepRows.length >= ops.ingredients.length || prepRows.length >= 25}
                  action={() =>
                    setPrepRows((prev) => [
                      ...prev,
                      {
                        ingredientId: ops.ingredients.find((i) => !prev.some((r) => r.ingredientId === i.id))?.id ?? "",
                        quantity: 100,
                        lossBps: 0,
                      },
                    ])
                  }
                >
                  <Plus size={15} />
                  {t("addIngredient")}
                </OpButton>
                <OpField label={t("note")}>
                  <textarea value={prepNote} onChange={(e) => setPrepNote(e.target.value)} maxLength={1000} />
                </OpField>
                <p className="ops-note">{t("preparationSaveHint")}</p>
              </>
            )}
            {modal === "recipe" && (
              <>
                <div className="form-grid">
                  <OpField label={t("selectDish")}>
                    <select
                      value={recipeProduct}
                      required
                      onChange={(e) => {
                        const p = e.target.value;
                        const r = latestRecipe(p, ops.recipes);
                        setRecipeProduct(p);
                        setRecipePreps(
                          (r?.preparations ?? []).map((l) => ({
                            preparationId: l.preparationId,
                            quantity: l.quantity,
                            lossBps: l.lossBps,
                          })),
                        );
                        setYield(r?.yield ?? 10);
                        setRecipeNote(r?.note ?? "");
                        setRecipeRows(
                          r
                            ? r.lines.map((l) => ({
                                ingredientId: l.ingredientId,
                                quantity: l.quantity,
                                lossBps: l.lossBps,
                              }))
                            : [
                                {
                                  ingredientId: ops.ingredients[0]?.id ?? "",
                                  quantity: 100,
                                  lossBps: 0,
                                },
                              ],
                        );
                      }}
                    >
                      {data.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {name(p)}
                        </option>
                      ))}
                    </select>
                  </OpField>
                  <OpField label={t("recipeYield")}>
                    <input
                      value={yieldPortions || ""}
                      onChange={(e) => setYield(Number(e.target.value))}
                      type="number"
                      min="1"
                      max="1000"
                      step="1"
                      required
                    />
                  </OpField>
                </div>
                <p className="ops-note">{t("recipeHint")}</p>
                {recipeRows.map((row, idx) => (
                  <div className="recipe-editor-line" key={idx}>
                    <OpField label={t("ingredients")}>
                      <select
                        value={row.ingredientId}
                        required
                        onChange={(e) =>
                          setRecipeRows((prev) =>
                            prev.map((r, j) =>
                              j === idx
                                ? { ...r, ingredientId: e.target.value }
                                : r,
                            ),
                          )
                        }
                      >
                        <option value="" disabled>
                          {t("selectIngredient")}
                        </option>
                        {ops.ingredients
                          .filter(
                            (i) =>
                              i.id === row.ingredientId ||
                              !recipeRows.some((r) => r.ingredientId === i.id),
                          )
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {name(i)} · {t(i.unit)}
                            </option>
                          ))}
                      </select>
                    </OpField>
                    <OpField
                      label={
                        t("netQuantity") +
                        " (" +
                        t(ingredient(row.ingredientId)?.unit ?? "g") +
                        ")"
                      }
                    >
                      <input
                        type="number"
                        min="1"
                        max="10000000"
                        step="1"
                        required
                        value={row.quantity || ""}
                        onChange={(e) =>
                          setRecipeRows((prev) =>
                            prev.map((r, j) =>
                              j === idx
                                ? { ...r, quantity: Number(e.target.value) }
                                : r,
                            ),
                          )
                        }
                      />
                    </OpField>
                    <OpField label={t("loss")}>
                      <input
                        type="number"
                        min="0"
                        max="90"
                        step="0.01"
                        required
                        value={row.lossBps / 100}
                        onChange={(e) =>
                          setRecipeRows((prev) =>
                            prev.map((r, j) =>
                              j === idx
                                ? {
                                    ...r,
                                    lossBps: Math.round(
                                      Number(e.target.value) * 100,
                                    ),
                                  }
                                : r,
                            ),
                          )
                        }
                      />
                    </OpField>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t("remove")}
                      disabled={recipeRows.length + recipePreps.length === 1}
                      onClick={() =>
                        setRecipeRows((prev) =>
                          prev.filter((_, j) => j !== idx),
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <OpButton
                  busy={busy}
                  secondary
                  disabled={
                    recipeRows.length >= ops.ingredients.length ||
                    recipeRows.length >= 25
                  }
                  action={() =>
                    setRecipeRows((prev) => [
                      ...prev,
                      {
                        ingredientId:
                          ops.ingredients.find(
                            (i) => !prev.some((r) => r.ingredientId === i.id),
                          )?.id ?? "",
                        quantity: 100,
                        lossBps: 0,
                      },
                    ])
                  }
                >
                  <Plus size={15} />
                  {t("addIngredient")}
                </OpButton>
                {recipePreps.map((row, idx) => {
                  const prep = ops.preparations.find((p) => p.id === row.preparationId);
                  return (
                    <div className="recipe-editor-line" key={"prep-" + idx}>
                      <OpField label={t("preparation")}>
                        <select
                          value={row.preparationId}
                          required
                          onChange={(e) =>
                            setRecipePreps((prev) =>
                              prev.map((r, j) => (j === idx ? { ...r, preparationId: e.target.value } : r)),
                            )
                          }
                        >
                          <option value="" disabled>
                            {t("selectPreparation")}
                          </option>
                          {ops.preparations
                            .filter(
                              (p) =>
                                p.id === row.preparationId ||
                                !recipePreps.some((r) => r.preparationId === p.id),
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {name(p)} · {t(p.unit)}
                              </option>
                            ))}
                        </select>
                      </OpField>
                      <OpField label={t("netQuantity") + " (" + t(prep?.unit ?? "g") + ")"}>
                        <input
                          type="number"
                          min="1"
                          max="10000000"
                          step="1"
                          required
                          value={row.quantity || ""}
                          onChange={(e) =>
                            setRecipePreps((prev) =>
                              prev.map((r, j) => (j === idx ? { ...r, quantity: Number(e.target.value) } : r)),
                            )
                          }
                        />
                      </OpField>
                      <OpField label={t("loss")}>
                        <input
                          type="number"
                          min="0"
                          max="90"
                          step="0.01"
                          required
                          value={row.lossBps / 100}
                          onChange={(e) =>
                            setRecipePreps((prev) =>
                              prev.map((r, j) =>
                                j === idx ? { ...r, lossBps: Math.round(Number(e.target.value) * 100) } : r,
                              ),
                            )
                          }
                        />
                      </OpField>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={t("remove")}
                        disabled={recipeRows.length + recipePreps.length === 1}
                        onClick={() => setRecipePreps((prev) => prev.filter((_, j) => j !== idx))}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })}
                {ops.preparations.length > 0 && (
                  <OpButton
                    busy={busy}
                    secondary
                    disabled={recipePreps.length >= ops.preparations.length || recipePreps.length >= 25}
                    action={() =>
                      setRecipePreps((prev) => [
                        ...prev,
                        {
                          preparationId:
                            ops.preparations.find((p) => !prev.some((r) => r.preparationId === p.id))?.id ?? "",
                          quantity: 100,
                          lossBps: 0,
                        },
                      ])
                    }
                  >
                    <Layers size={15} />
                    {t("addPreparation")}
                  </OpButton>
                )}
                <OpField label={t("note")}>
                  <textarea
                    value={recipeNote}
                    onChange={(e) => setRecipeNote(e.target.value)}
                    maxLength={1000}
                  />
                </OpField>
                <p className="ops-note">{t("allergenSync")}</p>
              </>
            )}
            {modal === "receipt" && (
              <>
                <OpField label={t("ingredients")}>
                  <select
                    required
                    value={selectedIngredient}
                    onChange={(e) => setSelectedIngredient(e.target.value)}
                  >
                    {ops.ingredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {name(i)} · {t(i.unit)}
                      </option>
                    ))}
                  </select>
                </OpField>
                <div className="form-grid">
                  <OpField label={t("batch")}>
                    <input name="batch" required maxLength={200} />
                  </OpField>
                  <OpField label={t("supplier")}>
                    <input
                      key={selectedIngredient}
                      name="supplier"
                      required
                      maxLength={200}
                      defaultValue={
                        ingredient(selectedIngredient)?.supplier ?? ""
                      }
                    />
                  </OpField>
                  <OpField label={t("received")}>
                    <input
                      name="received"
                      type="date"
                      required
                      defaultValue={today()}
                      max={today()}
                    />
                  </OpField>
                  <OpField label={t("expires")}>
                    <input name="expires" type="date" required />
                  </OpField>
                  <OpField
                    label={
                      t("receivedQuantity") +
                      " (" +
                      t(ingredient(selectedIngredient)?.unit ?? "g") +
                      ")"
                    }
                  >
                    <input
                      name="quantity"
                      type="number"
                      min="1"
                      max="10000000"
                      step="1"
                      required
                    />
                  </OpField>
                  <OpField label={t("totalCost")}>
                    <input
                      name="totalCost"
                      type="number"
                      min="0"
                      max="1000000"
                      step="0.01"
                      required
                    />
                  </OpField>
                </div>
                <OpField label={t("document")}>
                  <input name="document" maxLength={200} />
                </OpField>
              </>
            )}
            {modal === "waste" && (
              <>
                <p className="ops-note">{t("wasteHint")}</p>
                <OpField label={t("batch")}>
                  <select
                    required
                    value={selectedLot}
                    onChange={(e) => setSelectedLot(e.target.value)}
                  >
                    {ops.lots
                      .filter((l) => l.remaining > 0)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {ingredient(l.ingredientId)
                            ? name(ingredient(l.ingredientId)!)
                            : ""}{" "}
                          · {l.batch} ·{" "}
                          {fmt(
                            l.remaining,
                            ingredient(l.ingredientId)?.unit ?? "g",
                          )}
                        </option>
                      ))}
                  </select>
                </OpField>
                <OpField
                  label={
                    t("stockQuantity") +
                    " (" +
                    t(
                      ingredient(
                        ops.lots.find((l) => l.id === selectedLot)
                          ?.ingredientId ?? "",
                      )?.unit ?? "g",
                    ) +
                    ")"
                  }
                >
                  <input
                    name="quantity"
                    type="number"
                    min="1"
                    step="1"
                    max={
                      ops.lots.find((l) => l.id === selectedLot)?.remaining ?? 0
                    }
                    required
                  />
                </OpField>
                <OpField label={t("note")}>
                  <textarea name="note" required maxLength={1000} />
                </OpField>
              </>
            )}
            {modal === "issue" && (
              <>
                <p className="ops-note">{t("issueHint")}</p>
                <OpField label={t("orders")}>
                  <select
                    required
                    value={selectedOrder}
                    onChange={(e) => chooseOrder(e.target.value)}
                  >
                    {issueOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.time} · {o.customerName}
                      </option>
                    ))}
                  </select>
                </OpField>
                {order?.items.some((i) => !i.recipeId) && (
                  <p className="ops-note">{t("fallbackRecipe")}</p>
                )}
                {req.missing.length > 0 && (
                  <div className="warning-note">{t("MISSING_RECIPE")}</div>
                )}
                <div className="issue-lines">
                  {[...req.needs].map(([id, quantity]) => {
                    const i = ingredient(id);
                    return i ? (
                      <div className="issue-line" key={id}>
                        <div>
                          <strong>{name(i)}</strong>
                          <small>
                            {t("plannedQuantity")}: {fmt(quantity, i.unit)}
                          </small>
                        </div>
                        <OpField
                          label={t("actualQuantity") + " (" + t(i.unit) + ")"}
                        >
                          <input
                            type="number"
                            min="1"
                            max="10000000"
                            step="1"
                            required
                            value={actual[id] || ""}
                            onChange={(e) =>
                              setActual((prev) => ({
                                ...prev,
                                [id]: Number(e.target.value),
                              }))
                            }
                          />
                        </OpField>
                      </div>
                    ) : null;
                  })}
                </div>
                {allocations.shortage.length > 0 && (
                  <div className="warning-note">
                    <AlertCircle size={17} />
                    <div>
                      <strong>{t("INSUFFICIENT_STOCK")}</strong>
                      <p>
                        {allocations.shortage
                          .map((s) => {
                            const i = ingredient(s.ingredientId);
                            return (
                              (i ? name(i) : "") +
                              ": " +
                              fmt(s.quantity, i?.unit ?? "g")
                            );
                          })
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                )}
                <OpField label={t("issueNote")}>
                  <textarea
                    name="note"
                    required={[...req.needs].some(
                      ([id, n]) => actual[id] !== n,
                    )}
                    maxLength={1000}
                  />
                </OpField>
                <p className="ops-note">{t("issueDateHint")}</p>
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
              <button
                className="button"
                type="submit"
                disabled={
                  busy ||
                  (modal === "issue" &&
                    (!order ||
                      req.missing.length > 0 ||
                      allocations.shortage.length > 0 ||
                      !req.needs.size))
                }
              >
                <Check size={16} />
                {t(
                  busy ? "saving" : modal === "issue" ? "confirmIssue" : "save",
                )}
              </button>
            </div>
          </form>
        </OperationDialog>
      )}
    </div>
  );
}
function OpButton({
  children,
  action,
  secondary = false,
  disabled = false,
  busy = false,
}: {
  children: ReactNode;
  action: () => void;
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className={"button " + (secondary ? "secondary" : "")}
      onClick={action}
      disabled={disabled || busy}
    >
      {children}
    </button>
  );
}
function OpField({ label, children }: { label: string; children: ReactNode }) {
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
function OperationDialog({
  title,
  children,
  close,
  closeLabel,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  closeLabel: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal operation-modal"
      aria-label={title}
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
        <button
          type="button"
          className="icon-button"
          aria-label={closeLabel}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
