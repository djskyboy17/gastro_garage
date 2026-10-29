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
  type Recipe,
  type Ingredient,
  type OperationsData,
} from "@/src/modules/inventory/domain";
type Props = {
  tab: string;
  data: AppData;
  lang: Language;
  day: string;
  busy: boolean;
  error: string;
  onSave: (path: string, body: unknown) => Promise<boolean>;
  onOrder: (order: Order) => void;
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
  const [modal, setModal] = useState<string | null>(null);
  const [minimum, setMinimum] = useState(false);
  const [unit, setUnit] = useState("g");
  const [recipeProduct, setRecipeProduct] = useState("");
  const [yieldPortions, setYield] = useState(10);
  const [recipeNote, setRecipeNote] = useState("");
  const [recipeRows, setRecipeRows] = useState([
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
      o.status !== "cancelled" &&
      ["queued", "cooking"].includes(o.production) &&
      o.delivery === "pending" &&
      !ops.issues.some((i) => i.orderId === o.id),
  );
  const order = issueOrders.find((o) => o.id === selectedOrder);
  const req = order
    ? requirements(order, ops.recipes)
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
  const plan = procurementPlan(data.orders, ops, day, minimum);
  const shortage = plan.rows.filter((r) => r.shortage > 0);
  const soonDate = new Date(today() + "T12:00:00Z");
  soonDate.setUTCDate(soonDate.getUTCDate() + 3);
  const soon = soonDate.toISOString().slice(0, 10);
  function chooseOrder(id: string) {
    setSelectedOrder(id);
    const o = issueOrders.find((o) => o.id === id);
    setActual(o ? Object.fromEntries(requirements(o, ops.recipes).needs) : {});
  }
  function open(type: string, id?: string) {
    setRequestId(crypto.randomUUID());
    setModal(type);
    if (type === "ingredient") setUnit("g");
    if (type === "receipt")
      setSelectedIngredient(id ?? ops.ingredients[0]?.id ?? "");
    if (type === "waste") setSelectedLot(id ?? "");
    if (type === "issue") chooseOrder(issueOrders[0]?.id ?? "");
    if (type === "recipe") {
      const p = id ?? data.products[0]?.id ?? "";
      setRecipeProduct(p);
      const r = latestRecipe(p, ops.recipes);
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
      };
    }
    if (modal === "recipe") {
      path = "recipes";
      body = {
        productId: recipeProduct,
        yield: yieldPortions,
        note: recipeNote,
        lines: recipeRows,
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
        t("shortage"),
        t("estimatedCost"),
      ],
      ...shortage.map((r) => [
        name(r.ingredient),
        r.ingredient.supplier,
        t(r.ingredient.unit),
        String(r.required),
        String(r.available),
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
            <OpButton
              busy={busy}
              secondary
              action={() => open("issue")}
              disabled={!issueOrders.length}
            >
              <ChefHat size={16} />
              {t("issue")}
            </OpButton>
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
          <div className="recipe-list">
            {data.products.map((p) => {
              const r = latestRecipe(p.id, ops.recipes);
              return (
                <article className="panel recipe-panel" key={p.id}>
                  <div className="recipe-title">
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
                            t("versions")
                          : t("missingRecipe")}
                      </small>
                    </div>
                    <button
                      className="button secondary"
                      disabled={!ops.ingredients.length || busy}
                      onClick={() => open("recipe", p.id)}
                    >
                      <Plus size={14} />
                      {t(r ? "newVersion" : "newRecipe")}
                    </button>
                  </div>
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
                      </div>
                      <div className="recipe-cost">
                        <span>
                          {t("ingredientCost")}
                          <small>{t("costHint")}</small>
                        </span>
                        <strong>{money(recipeCost(r, ops.ingredients))}</strong>
                      </div>
                    </>
                  ) : (
                    <p className="quiet-empty">{t("noRecipes")}</p>
                  )}
                </article>
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
          <section className="panel">
            {section === "lots" && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
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
                      .slice()
                      .sort((a, b) => a.expires.localeCompare(b.expires))
                      .map((l) => {
                        const i = ingredient(l.ingredientId);
                        return (
                          <tr key={l.id}>
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
                              <small>/ {fmt(l.quantity, i?.unit ?? "g")}</small>
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
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {ops.ingredients.map((i) => (
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
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => open("receipt", i.id)}
                          >
                            <Plus size={14} />
                            {t("receive")}
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
                    {ops.moves.map((m) => {
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
                                m.kind === "received"
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
              .filter((o) => o.date === day && o.status !== "cancelled")
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
                    <th>{t("shortage")}</th>
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
                  {t("noShortage")}
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
                      disabled={recipeRows.length === 1}
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
