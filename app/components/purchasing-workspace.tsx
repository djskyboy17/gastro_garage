"use client";
import {
  useState,
  useRef,
  useEffect,
  useId,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  Plus,
  ArrowLeft,
  ArrowRight,
  Truck,
  Printer,
  Check,
  Trash2,
  X,
  ClipboardList,
  Building2,
} from "lucide-react";
import { messages } from "@/src/modules/shared/i18n";
import {
  today,
  type AppData,
  type Language,
} from "@/src/modules/shared/domain";
import {
  purchasePhase,
  purchaseValue,
  type PurchaseOrder,
} from "@/src/modules/purchasing/domain";
import { costFor } from "@/src/modules/inventory/domain";
type DraftLine = {
  ingredientId: string;
  quantity: number;
  packQuantity: number;
  packPrice: number;
};
type Props = {
  data: AppData;
  lang: Language;
  day: string;
  busy: boolean;
  error: string;
  onSave: (path: string, body: unknown) => Promise<boolean>;
  renderPlan: (
    create: (lines: { ingredientId: string; quantity: number }[]) => void,
  ) => ReactNode;
};
export default function PurchasingWorkspace({
  data,
  lang,
  day,
  busy,
  error,
  onSave,
  renderPlan,
}: Props) {
  const t = (k: string) => messages[lang][k] ?? k;
  const named = (p: { hu: string; ro: string }) => p[lang];
  const money = (n: number) =>
    new Intl.NumberFormat(lang === "hu" ? "hu-HU" : "ro-RO", {
      style: "currency",
      currency: "RON",
    }).format(n / 100);
  const num = (n: number) =>
    new Intl.NumberFormat(lang === "hu" ? "hu-HU" : "ro-RO", {
      maximumFractionDigits: 3,
    }).format(n);
  const fmt = (n: number, u: string) =>
    n >= 1000 && u !== "pcs"
      ? num(n / 1000) + " " + (u === "g" ? "kg" : "l")
      : num(n) + " " + t(u);
  const [view, setView] = useState("plan"),
    [selected, setSelected] = useState(""),
    [modal, setModal] = useState<string | null>(null),
    [requestId, setRequestId] = useState("");
  const [editId, setEditId] = useState(""),
    [revision, setRevision] = useState(0),
    [supplierId, setSupplierId] = useState(""),
    [due, setDue] = useState(day),
    [note, setNote] = useState(""),
    [rows, setRows] = useState<DraftLine[]>([]);
  const [receiveLine, setReceiveLine] = useState(""),
    [receiptQty, setReceiptQty] = useState(1),
    [receiptCost, setReceiptCost] = useState(0);
  const purchase = data.purchasing.orders.find((p) => p.id === selected);
  const phase = purchase ? purchasePhase(purchase) : "";
  const ingredient = (id: string) =>
    data.operations.ingredients.find((i) => i.id === id);
  const rowFor = (id: string, quantity = 1): DraftLine => {
    const i = ingredient(id);
    return {
      ingredientId: id,
      quantity,
      packQuantity: i?.packQuantity ?? 1000,
      packPrice: i?.packPrice ?? 0,
    };
  };
  function create(lines?: { ingredientId: string; quantity: number }[]) {
    setEditId("");
    setRequestId(crypto.randomUUID());
    setSupplierId(data.purchasing.suppliers[0]?.id ?? "");
    setDue(day);
    setNote("");
    setRows(
      lines?.length
        ? lines.map((l) => rowFor(l.ingredientId, l.quantity))
        : [rowFor(data.operations.ingredients[0]?.id ?? "")],
    );
    setModal("purchase");
  }
  function edit(p: PurchaseOrder) {
    setEditId(p.id);
    setRevision(p.revision);
    setRequestId(p.id);
    setSupplierId(p.supplierId);
    setDue(p.due);
    setNote(p.note);
    setRows(
      p.lines.map((l) => ({
        ingredientId: l.ingredientId,
        quantity: l.quantity,
        packQuantity: l.packQuantity,
        packPrice: l.packPrice,
      })),
    );
    setModal("purchase");
  }
  function chooseLine(id: string) {
    const l = purchase?.lines.find((l) => l.id === id);
    setReceiveLine(id);
    setReceiptQty(l ? l.quantity - l.received : 1);
    setReceiptCost(
      l ? costFor(l.quantity - l.received, l.packPrice, l.packQuantity) : 0,
    );
  }
  function openReceive() {
    if (!purchase) return;
    setRequestId(crypto.randomUUID());
    setRevision(purchase.revision);
    chooseLine(purchase.lines.find((l) => l.received < l.quantity)?.id ?? "");
    setModal("receipt");
  }
  async function act(action: string, note = "") {
    if (purchase)
      await onSave("purchasing/state", {
        id: purchase.id,
        revision: purchase.revision,
        action,
        note,
      });
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let path = "",
      body: unknown;
    if (modal === "supplier") {
      path = "suppliers";
      body = {
        id: requestId,
        name: f.get("name"),
        taxId: f.get("taxId"),
        address: f.get("address"),
        email: f.get("email"),
        phone: f.get("phone"),
        note: f.get("note"),
      };
    }
    if (modal === "purchase") {
      path = editId ? "update" : "create";
      body = {
        id: requestId,
        ...(editId ? { revision } : {}),
        supplierId,
        due,
        note,
        lines: rows,
      };
    }
    if (modal === "receipt" && purchase) {
      path = "receive";
      body = {
        id: requestId,
        purchaseId: purchase.id,
        revision,
        lineId: receiveLine,
        quantity: receiptQty,
        batch: f.get("batch"),
        received: f.get("received"),
        expires: f.get("expires"),
        totalCost: receiptCost,
        document: f.get("document"),
      };
    }
    if (modal === "close" && purchase) {
      if (
        await onSave("purchasing/state", {
          id: purchase.id,
          revision: purchase.revision,
          action: "close",
          note: f.get("note"),
        })
      )
        setModal(null);
      return;
    }
    if (path && (await onSave("purchasing/" + path, body))) {
      setModal(null);
      if (modal === "purchase") {
        setView("orders");
        setSelected(requestId);
      }
    }
  }
  const selectPurchase = (p: PurchaseOrder) => {
    setSelected(p.id);
    setView("orders");
  };
  const openOrders = data.purchasing.orders.filter((p) =>
    ["ordered", "partial"].includes(purchasePhase(p)),
  );
  const receipts = purchase
    ? data.operations.lots.filter((l) =>
        purchase.lines.some((line) => line.id === l.purchaseLineId),
      )
    : [];
  const Badge = ({ value }: { value: string }) => (
    <span
      className={
        "badge " +
        (["received", "closed"].includes(value)
          ? "ready"
          : value === "partial"
            ? "cooking"
            : value === "cancelled"
              ? "failed"
              : "pending")
      }
    >
      {t("po_" + value)}
    </span>
  );
  return (
    <div className="purchasing-workspace">
      <div
        className="purchase-tabs"
        role="tablist"
        aria-label={t("procurement")}
      >
        {["plan", "orders", "suppliers"].map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            className={view === v ? "selected" : ""}
            onClick={() => {
              setView(v);
              setSelected("");
            }}
          >
            {t(
              v === "plan"
                ? "procurement"
                : v === "orders"
                  ? "purchaseOrders"
                  : "suppliers",
            )}
            {v === "orders" && openOrders.length > 0 && (
              <span>{openOrders.length}</span>
            )}
          </button>
        ))}
      </div>
      {view === "plan" && (
        <>
          {!data.purchasing.suppliers.length && (
            <p className="ops-note">{t("supplierFirst")}</p>
          )}
          {renderPlan(create)}
          <p className="ops-note">{t("incomingHint")}</p>
        </>
      )}
      {view === "suppliers" && (
        <>
          <div className="ops-actions">
            <Action
              busy={busy}
              onClick={() => {
                setRequestId(crypto.randomUUID());
                setModal("supplier");
              }}
            >
              <Plus size={16} />
              {t("newSupplier")}
            </Action>
          </div>
          <div className="supplier-grid">
            {data.purchasing.suppliers.map((s) => (
              <article className="panel supplier-card" key={s.id}>
                <Building2 size={24} />
                <h2>{s.name}</h2>
                <p>{s.taxId || "—"}</p>
                <p>{s.address || "—"}</p>
                <div>
                  <span>{s.email || "—"}</span>
                  <span>{s.phone || "—"}</span>
                </div>
                {s.note && <p className="supplier-note">{s.note}</p>}
              </article>
            ))}
          </div>
          {!data.purchasing.suppliers.length && (
            <div className="panel empty">
              <Building2 size={30} />
              <h3>{t("noSuppliers")}</h3>
            </div>
          )}
        </>
      )}
      {view === "orders" && !purchase && (
        <>
          <div className="ops-actions">
            <Action
              busy={busy}
              onClick={() => create()}
              disabled={
                !data.purchasing.suppliers.length ||
                !data.operations.ingredients.length
              }
            >
              <Plus size={16} />
              {t("newPurchase")}
            </Action>
          </div>
          <p className="ops-note">{t("purchaseHint")}</p>
          <div className="metrics purchase-metrics">
            <div className="metric">
              <div>
                {t("openPurchases")}
                <ClipboardList size={17} />
              </div>
              <strong>{openOrders.length}</strong>
            </div>
            <div className="metric">
              <div>
                {t("overduePurchases")}
                <Truck size={17} />
              </div>
              <strong>
                {openOrders.filter((p) => p.due < today()).length}
              </strong>
            </div>
            <div className="metric">
              <div>{t("purchaseValue")}</div>
              <strong>
                {money(
                  openOrders.reduce(
                    (s, p) =>
                      s +
                      purchaseValue(
                        p.lines.map((l) => ({
                          ...l,
                          quantity: l.quantity - l.received,
                        })),
                      ),
                    0,
                  ),
                )}
              </strong>
            </div>
          </div>
          <section className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("purchaseNumber")}</th>
                    <th>{t("supplier")}</th>
                    <th>{t("dueDate")}</th>
                    <th>{t("status")}</th>
                    <th className="number">{t("amount")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.purchasing.orders.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => selectPurchase(p)}
                        >
                          BR-{p.id.slice(0, 8).toUpperCase()}
                        </button>
                        <small>
                          {p.lines.length} {t("items").toLowerCase()}
                        </small>
                      </td>
                      <td>
                        <strong>{p.supplierName}</strong>
                      </td>
                      <td
                        className={
                          p.due < today() &&
                          ["ordered", "partial"].includes(purchasePhase(p))
                            ? "shortage-value"
                            : ""
                        }
                      >
                        {p.due}
                      </td>
                      <td>
                        <Badge value={purchasePhase(p)} />
                      </td>
                      <td className="number">
                        {money(purchaseValue(p.lines))}
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={t("open")}
                          onClick={() => selectPurchase(p)}
                        >
                          <ArrowRight size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.purchasing.orders.length && (
              <div className="empty">
                <ClipboardList size={27} />
                <h3>{t("noPurchases")}</h3>
              </div>
            )}
          </section>
        </>
      )}
      {view === "orders" && purchase && (
        <section className="purchase-detail">
          <div className="purchase-detail-toolbar">
            <button className="text-button" onClick={() => setSelected("")}>
              <ArrowLeft size={15} />
              {t("backToPurchases")}
            </button>
            <button className="text-button" onClick={() => window.print()}>
              <Printer size={15} />
              {t("print")}
            </button>
          </div>
          <section className="panel">
            <div className="purchase-detail-head">
              <div>
                <p className="eyebrow">
                  BR-{purchase.id.slice(0, 8).toUpperCase()}
                </p>
                <h2>{purchase.supplierName}</h2>
                <p>
                  {purchase.supplierTaxId} {purchase.supplierAddress}
                </p>
                <p>
                  {t("dueDate")}: {purchase.due}
                </p>
              </div>
              <Badge value={phase} />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("ingredients")}</th>
                    <th>{t("orderedQuantity")}</th>
                    <th>{t("receivedQuantityPo")}</th>
                    <th>{t("outstandingQuantity")}</th>
                    <th className="number">{t("amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {purchase.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <strong>{named(l)}</strong>
                        <small>
                          {money(l.packPrice)} / {fmt(l.packQuantity, l.unit)}
                        </small>
                      </td>
                      <td>{fmt(l.quantity, l.unit)}</td>
                      <td>{fmt(l.received, l.unit)}</td>
                      <td>{fmt(l.quantity - l.received, l.unit)}</td>
                      <td className="number">{money(purchaseValue([l]))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="purchase-total">
              <span>{t("purchaseValue")}</span>
              <strong>{money(purchaseValue(purchase.lines))}</strong>
            </div>
            {purchase.note && <p className="purchase-note">{purchase.note}</p>}
            <div className="purchase-actions">
              {phase === "draft" && (
                <>
                  <Action busy={busy} onClick={() => void act("confirm")}>
                    <Check size={15} />
                    {t("confirmPurchase")}
                  </Action>
                  <Action busy={busy} secondary onClick={() => edit(purchase)}>
                    {t("editDraft")}
                  </Action>
                </>
              )}
              {["ordered", "partial"].includes(phase) && (
                <Action busy={busy} onClick={openReceive}>
                  <Truck size={15} />
                  {t("receivePurchase")}
                </Action>
              )}
              {["draft", "ordered"].includes(phase) && (
                <button
                  disabled={busy}
                  className="danger-button"
                  onClick={() => {
                    if (window.confirm(t("confirmCancelPurchase")))
                      void act("cancel");
                  }}
                >
                  {t("cancelPurchase")}
                </button>
              )}
              {phase === "partial" && (
                <Action busy={busy} secondary onClick={() => setModal("close")}>
                  {t("closeRemainder")}
                </Action>
              )}
            </div>
          </section>
          <p className="ops-note">{t("purchaseHint")}</p>
          <section className="panel">
            <div className="panel-heading">
              <h2>{t("purchaseReceipts")}</h2>
              <Truck size={18} />
            </div>
            {receipts.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("received")}</th>
                      <th>{t("ingredients")}</th>
                      <th>{t("batch")}</th>
                      <th>{t("receivedQuantityPo")}</th>
                      <th>{t("expires")}</th>
                      <th className="number">{t("amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((lot) => {
                      const l = purchase.lines.find(
                        (l) => l.id === lot.purchaseLineId,
                      )!;
                      return (
                        <tr key={lot.id}>
                          <td>
                            {lot.received}
                            <small>{lot.document || "—"}</small>
                          </td>
                          <td>{named(l)}</td>
                          <td>{lot.batch}</td>
                          <td>{fmt(lot.quantity, l.unit)}</td>
                          <td>{lot.expires}</td>
                          <td className="number">{money(lot.totalCost)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="quiet-empty">{t("noPurchaseReceipts")}</p>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>{t("purchaseHistory")}</h2>
            </div>
            {data.purchasing.events
              .filter((e) => e.purchaseId === purchase.id)
              .map((e) => (
                <div className="audit-row" key={e.id}>
                  <span className="audit-dot" />
                  <div>
                    <strong>{t("poEvent_" + e.kind)}</strong>
                    {e.kind === "receipt" ? (
                      <p>
                        {(() => {
                          try {
                            const d = JSON.parse(e.detail);
                            return (
                              receipts.find((l) => l.id === d.lotId)?.batch ??
                              ""
                            );
                          } catch {
                            return "";
                          }
                        })()}
                      </p>
                    ) : (
                      e.detail && <p>{e.detail}</p>
                    )}
                  </div>
                  <time>
                    {new Intl.DateTimeFormat(
                      lang === "hu" ? "hu-HU" : "ro-RO",
                      {
                        dateStyle: "short",
                        timeStyle: "short",
                        timeZone: "Europe/Bucharest",
                      },
                    ).format(new Date(e.createdAt))}
                  </time>
                </div>
              ))}
          </section>
        </section>
      )}
      {modal && (
        <PurchaseDialog
          title={t(
            modal === "supplier"
              ? "newSupplier"
              : modal === "receipt"
                ? "receivePurchase"
                : modal === "close"
                  ? "closeRemainder"
                  : editId
                    ? "editDraft"
                    : "newPurchase",
          )}
          onClose={() => !busy && setModal(null)}
          closeLabel={t("close")}
        >
          <form onSubmit={submit}>
            {error && (
              <div role="alert" className="error-banner">
                {messages[lang][error] ?? t("saveError")}
              </div>
            )}
            {modal === "supplier" && (
              <>
                <Field label={t("name")}>
                  <input name="name" required maxLength={200} />
                </Field>
                <div className="form-grid">
                  <Field label={t("supplierTaxId")}>
                    <input name="taxId" maxLength={40} />
                  </Field>
                  <Field label={t("phone")}>
                    <input name="phone" type="tel" maxLength={40} />
                  </Field>
                </div>
                <Field label={t("supplierAddress")}>
                  <input name="address" maxLength={500} />
                </Field>
                <Field label={t("supplierEmail")}>
                  <input name="email" type="email" maxLength={200} />
                </Field>
                <Field label={t("note")}>
                  <textarea name="note" maxLength={1000} />
                </Field>
              </>
            )}
            {modal === "purchase" && (
              <>
                <div className="form-grid">
                  <Field label={t("supplier")}>
                    <select
                      required
                      value={supplierId}
                      onChange={(e) => setSupplierId(e.target.value)}
                    >
                      <option value="" disabled>
                        {t("chooseSupplier")}
                      </option>
                      {data.purchasing.suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("dueDate")}>
                    <input
                      type="date"
                      value={due}
                      onChange={(e) => setDue(e.target.value)}
                      required
                    />
                  </Field>
                </div>
                <p className="ops-note">{t("purchaseUnitHint")}</p>
                {rows.map((row, idx) => (
                  <div className="purchase-editor-row" key={idx}>
                    <Field label={t("ingredients")}>
                      <select
                        required
                        value={row.ingredientId}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r, j) =>
                              j === idx
                                ? rowFor(e.target.value, r.quantity)
                                : r,
                            ),
                          )
                        }
                      >
                        <option value="" disabled>
                          {t("selectIngredient")}
                        </option>
                        {data.operations.ingredients
                          .filter(
                            (i) =>
                              i.id === row.ingredientId ||
                              !rows.some((r) => r.ingredientId === i.id),
                          )
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {named(i)} · {t(i.unit)}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <div className="purchase-row-numbers">
                      <Field
                        label={
                          t("stockQuantity") +
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
                            setRows((prev) =>
                              prev.map((r, j) =>
                                j === idx
                                  ? { ...r, quantity: Number(e.target.value) }
                                  : r,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field label={t("quotedPackQuantity")}>
                        <input
                          type="number"
                          min="1"
                          max="10000000"
                          step="1"
                          required
                          value={row.packQuantity || ""}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r, j) =>
                                j === idx
                                  ? {
                                      ...r,
                                      packQuantity: Number(e.target.value),
                                    }
                                  : r,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field label={t("quotedPackPrice")}>
                        <input
                          type="number"
                          min="0"
                          max="100000"
                          step="0.01"
                          required
                          value={row.packPrice / 100}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r, j) =>
                                j === idx
                                  ? {
                                      ...r,
                                      packPrice: Math.round(
                                        Number(e.target.value) * 100,
                                      ),
                                    }
                                  : r,
                              ),
                            )
                          }
                        />
                      </Field>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={rows.length === 1}
                        aria-label={t("remove")}
                        onClick={() =>
                          setRows((prev) => prev.filter((_, j) => j !== idx))
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
                <Action
                  busy={busy}
                  secondary
                  disabled={
                    rows.length >= 25 ||
                    rows.length >= data.operations.ingredients.length
                  }
                  onClick={() =>
                    setRows((prev) => [
                      ...prev,
                      rowFor(
                        data.operations.ingredients.find(
                          (i) => !prev.some((r) => r.ingredientId === i.id),
                        )?.id ?? "",
                      ),
                    ])
                  }
                >
                  <Plus size={15} />
                  {t("addIngredient")}
                </Action>
                <Field label={t("note")}>
                  <textarea
                    maxLength={1000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
                <p className="ops-note">{t("purchaseHint")}</p>
              </>
            )}
            {modal === "receipt" && purchase && (
              <>
                <p className="ops-note">{t("receiveRemainingHint")}</p>
                <Field label={t("choosePurchaseLine")}>
                  <select
                    required
                    value={receiveLine}
                    onChange={(e) => chooseLine(e.target.value)}
                  >
                    {purchase.lines
                      .filter((l) => l.received < l.quantity)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {named(l)} · {fmt(l.quantity - l.received, l.unit)}
                        </option>
                      ))}
                  </select>
                </Field>
                <div className="form-grid">
                  <Field
                    label={
                      t("receivedQuantityPo") +
                      " (" +
                      t(
                        purchase.lines.find((l) => l.id === receiveLine)
                          ?.unit ?? "g",
                      ) +
                      ")"
                    }
                  >
                    <input
                      type="number"
                      min="1"
                      max={(() => {
                        const l = purchase.lines.find(
                          (l) => l.id === receiveLine,
                        );
                        return l ? l.quantity - l.received : 0;
                      })()}
                      step="1"
                      required
                      value={receiptQty || ""}
                      onChange={(e) => {
                        const q = Number(e.target.value),
                          l = purchase.lines.find((l) => l.id === receiveLine);
                        setReceiptQty(q);
                        if (l && Number.isSafeInteger(q) && q >= 0)
                          setReceiptCost(
                            costFor(q, l.packPrice, l.packQuantity),
                          );
                      }}
                    />
                  </Field>
                  <Field label={t("actualReceiptValue")}>
                    <input
                      type="number"
                      min="0"
                      max="1000000"
                      step="0.01"
                      required
                      value={receiptCost / 100}
                      onChange={(e) =>
                        setReceiptCost(Math.round(Number(e.target.value) * 100))
                      }
                    />
                  </Field>
                  <Field label={t("batch")}>
                    <input name="batch" required maxLength={200} />
                  </Field>
                  <Field label={t("document")}>
                    <input name="document" maxLength={200} />
                  </Field>
                  <Field label={t("received")}>
                    <input
                      name="received"
                      type="date"
                      required
                      max={today()}
                      defaultValue={today()}
                    />
                  </Field>
                  <Field label={t("expires")}>
                    <input name="expires" type="date" required />
                  </Field>
                </div>
              </>
            )}
            {modal === "close" && (
              <>
                <p className="ops-note">{t("closeHint")}</p>
                <Field label={t("closeReason")}>
                  <textarea name="note" required maxLength={1000} />
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
              <button type="submit" className="button" disabled={busy}>
                <Check size={16} />
                {t(busy ? "saving" : "save")}
              </button>
            </div>
          </form>
        </PurchaseDialog>
      )}
    </div>
  );
}
function Action({
  children,
  onClick,
  secondary = false,
  disabled = false,
  busy = false,
}: {
  children: ReactNode;
  onClick: () => void;
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className={"button " + (secondary ? "secondary" : "")}
      disabled={disabled || busy}
      onClick={onClick}
    >
      {children}
    </button>
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
function PurchaseDialog({
  title,
  children,
  onClose,
  closeLabel,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
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
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={closeLabel}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
