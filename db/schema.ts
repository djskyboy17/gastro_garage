import {
  sqliteTable,
  text,
  integer,
  check,
  uniqueIndex,
  index,
  primaryKey,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const products = sqliteTable("products", {
  portalVisible: integer("portal_visible").notNull().default(0),
  portalRevision: integer("portal_revision").notNull().default(0),
  id: text("id").primaryKey(),
  hu: text("hu").notNull(),
  ro: text("ro").notNull(),
  descriptionHu: text("description_hu").notNull(),
  descriptionRo: text("description_ro").notNull(),
  category: text("category").notNull(),
  /** Katalógus-rész (v49): "daily" = Napi menü (leves, főétel, desszert), "alacarte" = Étlap. */
  section: text("section").notNull().default("alacarte"),
  price: integer("price").notNull(),
  portion: integer("portion").notNull(),
  allergens: text("allergens").notNull(),
  active: integer("active").notNull().default(1),
  /** 1, ha van kép. */
  hasImage: integer("has_image").notNull().default(0),
  /** Minden feltöltés és törlés növeli; a kép URL-jének verziója is, ezért soha nem csökken. */
  imageRevision: integer("image_revision").notNull().default(0),
});
/** Étel képe: a böngésző által lekicsinyített JPG/PNG/WebP, base64-ben (v23). */
export const productImages = sqliteTable("product_images", {
  productId: text("product_id")
    .primaryKey()
    .references(() => products.id),
  mime: text("mime").notNull(),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  phone: text("phone").notNull(),
  note: text("note").notNull(),
});
export const orders = sqliteTable("orders", {
  packingItems:text("packing_items").notNull().default("[]"),
  packingReady:integer("packing_ready").notNull().default(0),
  packingCheckedAt:text("packing_checked_at").notNull().default(""),
  fulfillmentMode: text("fulfillment_mode").notNull().default("delivery"),
  fulfillmentSlotId: text("fulfillment_slot_id"),
  fulfillmentPostalCode: text("fulfillment_postal_code").notNull().default(""),
  fulfillmentSnapshot: text("fulfillment_snapshot").notNull().default(""),
  deliveryFee: integer("delivery_fee").notNull().default(0),
  portalUserId: text("portal_user_id").references(() => portalProfiles.userId),
  reviewNote: text("review_note").notNull().default(""),
  courierName: text("courier_name").notNull().default(""),
  courierPhone: text("courier_phone").notNull().default(""),
  /** v75: az iroda kérte, hogy ehhez a rendeléshez aviz készüljön. */
  deliveryNoteRequired: integer("delivery_note_required").notNull().default(0),
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  customerName: text("customer_name").notNull(),
  address: text("address").notNull(),
  phone: text("phone").notNull(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  note: text("note").notNull(),
  production: text("production").notNull().default("queued"),
  delivery: text("delivery").notNull().default("pending"),
  payment: text("payment").notNull().default("unpaid"),
  status: text("status").notNull().default("confirmed"),
  revision: integer("revision").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (t) => [index("orders_date_status").on(t.date, t.status)]);
export const orderItems = sqliteTable("order_items", {
  recipeId: text("recipe_id").references(() => recipes.id),
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  hu: text("hu").notNull(),
  ro: text("ro").notNull(),
  allergens: text("allergens").notNull(),
  quantity: integer("quantity").notNull(),
  price: integer("price").notNull(),
  ready: integer("ready").notNull().default(0),
  /** v49: "napi_menu", ha a tétel egy napi menü (leves + főétel + desszert egy áron) része; különben üres. */
  setGroup: text("set_group").notNull().default(""),
}, (t) => [index("order_items_order").on(t.orderId)]);
export const audit = sqliteTable("audit", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  detail: text("detail").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [index("audit_entity_created").on(t.entity, t.createdAt)]);


export const workspaceOwners = sqliteTable("workspace_owners", {
  id: integer("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
}, t => [check("single_workspace_owner", sql`${t.id}=1`)]);
export const members = sqliteTable("members", {
  userId: text("user_id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("pending"),
  revision: integer("revision").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, t => [check("member_role", sql`${t.role} IN ('admin','dispatcher','kitchen','warehouse','courier','pending','disabled')`)]);
export const deliveryEvents = sqliteTable("delivery_events", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id),
  kind: text("kind").notNull(),
  detail: text("detail").notNull(),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [index("delivery_event_order").on(t.orderId, t.createdAt)]);
export const ingredients = sqliteTable("ingredients", {
  id: text("id").primaryKey(),
  hu: text("hu").notNull(),
  ro: text("ro").notNull(),
  unit: text("unit").notNull(),
  packQuantity: integer("pack_quantity").notNull(),
  packPrice: integer("pack_price").notNull(),
  minStock: integer("min_stock").notNull().default(0),
  allergens: text("allergens").notNull(),
  supplier: text("supplier").notNull(),
  // Tápérték 100 g-ra (ml-nél 100 ml-re), JSON, századokban; üres = nincs megadva.
  nutrition: text("nutrition").notNull().default(""),
  frozen: integer("frozen").notNull().default(0),
  gramsPerPiece: integer("grams_per_piece"),
});
// Al-receptek (félkész termékek): csak alapanyagot tartalmazhatnak.
export const preparations = sqliteTable("preparations", {
  id: text("id").primaryKey(),
  hu: text("hu").notNull(),
  ro: text("ro").notNull(),
  unit: text("unit").notNull(),
  createdAt: text("created_at").notNull(),
});
export const preparationVersions = sqliteTable(
  "preparation_versions",
  {
    id: text("id").primaryKey(),
    preparationId: text("preparation_id")
      .notNull()
      .references(() => preparations.id),
    version: integer("version").notNull(),
    output: integer("output").notNull(),
    note: text("note").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("preparation_version").on(t.preparationId, t.version),
    check("preparation_output_positive", sql`${t.output} > 0`),
  ],
);
export const preparationLines = sqliteTable(
  "preparation_lines",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => preparationVersions.id),
    ingredientId: text("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
    lossBps: integer("loss_bps").notNull().default(0),
  },
  (t) => [uniqueIndex("preparation_ingredient").on(t.versionId, t.ingredientId)],
);
export const recipePreparationLines = sqliteTable(
  "recipe_preparation_lines",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id),
    preparationId: text("preparation_id")
      .notNull()
      .references(() => preparations.id),
    quantity: integer("quantity").notNull(),
    lossBps: integer("loss_bps").notNull().default(0),
  },
  (t) => [uniqueIndex("recipe_preparation").on(t.recipeId, t.preparationId)],
);
export const recipes = sqliteTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    version: integer("version").notNull(),
    yield: integer("yield").notNull(),
    note: text("note").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("recipe_product_version").on(t.productId, t.version)],
);
export const recipeLines = sqliteTable(
  "recipe_lines",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id),
    ingredientId: text("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
    lossBps: integer("loss_bps").notNull().default(0),
  },
  (t) => [uniqueIndex("recipe_ingredient").on(t.recipeId, t.ingredientId)],
);
export const stockLots = sqliteTable(
  "stock_lots",
  {
    revision: integer("revision").notNull().default(0),
    adjustmentTotal: integer("adjustment_total").notNull().default(0),
    purchaseLineId: text("purchase_line_id").references(() => purchaseLines.id),
    id: text("id").primaryKey(),
    ingredientId: text("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    batch: text("batch").notNull(),
    supplier: text("supplier").notNull(),
    received: text("received").notNull(),
    expires: text("expires").notNull(),
    quantity: integer("quantity").notNull(),
    remaining: integer("remaining").notNull(),
    totalCost: integer("total_cost").notNull(),
    document: text("document").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check(
      "stock_lot_balance",
      sql`${t.remaining} >= 0 AND ${t.remaining} <= ${t.quantity}+${t.adjustmentTotal} AND ABS(${t.adjustmentTotal})<=1000000000`,
    ),
    index("stock_lot_ingredient_expiry").on(t.ingredientId, t.expires),
  ],
);
export const stockIssues = sqliteTable(
  "stock_issues",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    recipeSnapshot: text("recipe_snapshot").notNull(),
    createdAt: text("created_at").notNull(),
    actor: text("actor").notNull(),
  },
  (t) => [uniqueIndex("one_issue_per_order").on(t.orderId)],
);
export const stockMoves = sqliteTable("stock_moves", {
  id: text("id").primaryKey(),
  lotId: text("lot_id")
    .notNull()
    .references(() => stockLots.id),
  issueId: text("issue_id").references(() => stockIssues.id),
  /** v73: a gyártási tétel anyagkiadása / sztornója. */
  batchId: text("batch_id").references((): AnySQLiteColumn => productionBatches.id),
  quantity: integer("quantity").notNull(),
  kind: text("kind").notNull(),
  note: text("note").notNull(),
  createdAt: text("created_at").notNull(),
});
export const suppliers = sqliteTable("suppliers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  taxId: text("tax_id").notNull(),
  address: text("address").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  note: text("note").notNull(),
});
export const purchaseOrders = sqliteTable("purchase_orders", {
  id: text("id").primaryKey(),
  supplierId: text("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  supplierName: text("supplier_name").notNull(),
  supplierTaxId: text("supplier_tax_id").notNull(),
  supplierAddress: text("supplier_address").notNull(),
  due: text("due").notNull(),
  note: text("note").notNull(),
  status: text("status").notNull().default("draft"),
  revision: integer("revision").notNull().default(0),
  createdAt: text("created_at").notNull(),
});
export const purchaseLines = sqliteTable(
  "purchase_lines",
  {
    id: text("id").primaryKey(),
    purchaseId: text("purchase_id")
      .notNull()
      .references(() => purchaseOrders.id),
    ingredientId: text("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    hu: text("hu").notNull(),
    ro: text("ro").notNull(),
    unit: text("unit").notNull(),
    quantity: integer("quantity").notNull(),
    received: integer("received").notNull().default(0),
    packQuantity: integer("pack_quantity").notNull(),
    packPrice: integer("pack_price").notNull(),
  },
  (t) => [
    check(
      "purchase_received_bounds",
      sql`${t.received}>=0 AND ${t.received}<=${t.quantity}`,
    ),
    uniqueIndex("purchase_ingredient").on(t.purchaseId, t.ingredientId),
  ],
);
export const purchaseEvents = sqliteTable("purchase_events", {
  id: text("id").primaryKey(),
  purchaseId: text("purchase_id")
    .notNull()
    .references(() => purchaseOrders.id),
  kind: text("kind").notNull(),
  detail: text("detail").notNull(),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
});
export const safetyPoints = sqliteTable("safety_points", {
  id: text("id").primaryKey(),
  hu: text("hu").notNull(),
  ro: text("ro").notNull(),
  area: text("area").notNull(),
  kind: text("kind").notNull(),
  min: integer("min"),
  max: integer("max"),
  instructionsHu: text("instructions_hu").notNull(),
  instructionsRo: text("instructions_ro").notNull(),
  active: integer("active").notNull().default(1),
  revision: integer("revision").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, t => [check("safety_point_limits",sql`(${t.kind}='temperature' AND ${t.min} IS NOT NULL AND ${t.max} IS NOT NULL AND ${t.min}<=${t.max}) OR (${t.kind}='checklist' AND ${t.min} IS NULL AND ${t.max} IS NULL)`)]);
export const safetyRecords = sqliteTable("safety_records", {
  id: text("id").primaryKey(),
  pointId: text("point_id").notNull().references(() => safetyPoints.id),
  snapshot: text("snapshot").notNull(),
  temperature: integer("temperature"),
  answer: text("answer"),
  outcome: text("outcome").notNull(),
  day: text("day").notNull(),
  note: text("note").notNull(),
  actor: text("actor").notNull(),
  actorName: text("actor_name").notNull(),
  createdAt: text("created_at").notNull(),
  request: text("request").notNull(),
  status: text("status").notNull(),
  revision: integer("revision").notNull().default(0),
  correction: text("correction").notNull().default(""),
  recheckId: text("recheck_id"),
  resolvedBy: text("resolved_by").notNull().default(""),
  resolvedAt: text("resolved_at").notNull().default(""),
}, t => [index("safety_record_point_day").on(t.pointId,t.day),index("safety_record_status").on(t.status)]);
export const recurringTemplates = sqliteTable("recurring_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  customerId: text("customer_id").notNull().references(() => customers.id),
  content: text("content").notNull(),
  active: integer("active").notNull().default(1),
  revision: integer("revision").notNull().default(0),
  createdAt: text("created_at").notNull(),
});
export const recurringRuns = sqliteTable("recurring_runs", {
  id: text("id").primaryKey(),
  templateId: text("template_id").notNull().references(() => recurringTemplates.id),
  request: text("request").notNull(),
  requestedCount: integer("requested_count").notNull(),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
});
export const recurringOccurrences = sqliteTable("recurring_occurrences", {
  id: text("id").primaryKey(),
  templateId: text("template_id").notNull().references(() => recurringTemplates.id),
  day: text("day").notNull(),
  orderId: text("order_id").notNull().references(() => orders.id),
  runId: text("run_id").notNull().references(() => recurringRuns.id),
  templateRevision: integer("template_revision").notNull(),
}, t => [uniqueIndex("recurring_template_day").on(t.templateId,t.day),uniqueIndex("recurring_order").on(t.orderId)]);
export const portalProfiles = sqliteTable("portal_profiles", {
  userId: text("user_id").primaryKey(),
  customerId: text("customer_id").notNull().references(() => customers.id),
  active: integer("active").notNull().default(1),
  revision: integer("revision").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, t => [uniqueIndex("portal_customer").on(t.customerId)]);
export const portalSubmissions = sqliteTable("portal_submissions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => portalProfiles.userId),
  orderId: text("order_id").notNull().references(() => orders.id),
  request: text("request").notNull(),
  createdAt: text("created_at").notNull(),
}, t => [index("portal_submission_user_time").on(t.userId,t.createdAt)]);
export const menuDays = sqliteTable("menu_days", {
  date: text("date").primaryKey(),
  cutoffAt: text("cutoff_at").notNull(),
  active: integer("active").notNull().default(1),
  revision: integer("revision").notNull().default(0),
  /** v49: a nap menüje (leves + főétel + desszert egy áron). Vagy mindhárom meg van adva, vagy egyik sem. */
  setSoupId: text("set_soup_id").references(()=>products.id),
  setMainId: text("set_main_id").references(()=>products.id),
  setDessertId: text("set_dessert_id").references(()=>products.id),
}, t=>[check("menu_day_active",sql`${t.active} IN (0,1)`)]);
/** v49: a napi menü állandó ára (bani). Egyetlen sor (id=1); 0 = a menü nem rendelhető. */
export const menuSettings = sqliteTable("menu_settings", {
  id: integer("id").primaryKey(),
  setPrice: integer("set_price").notNull().default(0),
  /** v54: alapértelmezett rendelési határidő (HH:MM, romániai idő) a külön nem mentett napokra. */
  defaultCutoff: text("default_cutoff").notNull().default("09:00"),
  revision: integer("revision").notNull().default(0),
}, t=>[check("menu_settings_single",sql`${t.id} = 1`),check("menu_set_price",sql`${t.setPrice}>=0 AND ${t.setPrice}<=10000000`)]);
export const menuLines = sqliteTable("menu_lines", {
  date: text("date").notNull().references(()=>menuDays.date),
  productId: text("product_id").notNull().references(()=>products.id),
  capacity: integer("capacity").notNull(),
}, t=>[uniqueIndex("menu_date_product").on(t.date,t.productId),check("menu_capacity",sql`${t.capacity}>=0 AND ${t.capacity}<=100000`)]);

export const stocktakes = sqliteTable("stocktakes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  revision: integer("revision").notNull().default(0),
  request: text("request").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  postedBy: text("posted_by").notNull().default(""),
  postedAt: text("posted_at").notNull().default(""),
  closedBy: text("closed_by").notNull().default(""),
  closedAt: text("closed_at").notNull().default(""),
  closeNote: text("close_note").notNull().default(""),
},t=>[check("stocktake_status",sql`${t.status} IN ('draft','posted','cancelled','reversed')`)]);
export const stocktakeLines=sqliteTable("stocktake_lines",{
  id:text("id").primaryKey(),
  stocktakeId:text("stocktake_id").notNull().references(()=>stocktakes.id),
  lotId:text("lot_id").notNull().references(()=>stockLots.id),
  snapshot:text("snapshot").notNull(),
  expected:integer("expected").notNull(),
  lotRevision:integer("lot_revision").notNull(),
  counted:integer("counted"),
  note:text("note").notNull().default(""),
},t=>[uniqueIndex("stocktake_lot").on(t.stocktakeId,t.lotId),check("stocktake_count",sql`${t.counted} IS NULL OR (${t.counted}>=0 AND ${t.counted}<=10000000)`)]);

export const fulfillmentPolicy=sqliteTable("fulfillment_policy",{
  id:integer("id").primaryKey(),
  revision:integer("revision").notNull().default(0),
  content:text("content").notNull(),
},t=>[check("fulfillment_singleton",sql`${t.id}=1`)]);
/** Saját fiókok (v28): e-mail + jelszó. Az azonosító ugyanaz, amit a members / portal_profiles user_id használ. */
export const authUsers = sqliteTable(
  "auth_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** Üres, ha a fiók csak Google-lel lép be (v30). */
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at").notNull(),
    passwordChangedAt: text("password_changed_at").notNull(),
    /** 1, ha ideiglenes jelszót kapott: belépés után előbb új jelszót kell adnia (v30). */
    mustChangePassword: integer("must_change_password").notNull().default(0),
  },
  (t) => [uniqueIndex("auth_users_email").on(t.email)],
);
/** Munkamenetek: csak a süti tartalmának SHA-256 lenyomata kerül ide. */
export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("auth_sessions_user").on(t.userId)],
);
/** Sikertelen belépések a próbálkozások korlátozásához. */
export const authFailures = sqliteTable(
  "auth_failures",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    /** A kérés IP-címe: címenkénti korlátozáshoz is (v30). */
    ip: text("ip").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("auth_failures_email").on(t.email, t.createdAt), index("auth_failures_ip").on(t.ip, t.createdAt)],
);
/** Külső belépés (Google) összekötése egy fiókkal; id = "google:<sub>" (v30). */
export const authIdentities = sqliteTable(
  "auth_identities",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    email: text("email").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("auth_identities_user").on(t.userId)],
);
/** Folyamatban lévő Google-belépés (10 percig érvényes): állapot, PKCE-kulcs, nonce, visszatérési cím. */
export const oauthStates = sqliteTable("oauth_states", {
  id: text("id").primaryKey(),
  verifier: text("verifier").notNull(),
  nonce: text("nonce").notNull(),
  returnTo: text("return_to").notNull(),
  createdAt: text("created_at").notNull(),
});
/** Fogyasztói címke ételenként (v32): fogyaszthatósági idő napokban és tárolási feltétel. */
export const productLabels = sqliteTable("product_labels", {
  productId: text("product_id")
    .primaryKey()
    .references(() => products.id),
  /** A gyártás napjához képest hány nap múlva jár le (0 = aznap fogyasztandó). */
  shelfLifeDays: integer("shelf_life_days").notNull(),
  storageRo: text("storage_ro").notNull().default(""),
  storageHu: text("storage_hu").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});
/** A címkén szereplő gyártói adatok (egyetlen sor, v32). */
export const labelSettings = sqliteTable(
  "label_settings",
  {
    id: integer("id").primaryKey(),
    revision: integer("revision").notNull().default(0),
    content: text("content").notNull(),
  },
  (t) => [check("label_settings_singleton", sql`${t.id}=1`)],
);

/**
 * Beszállítói számla (v65): fotóról / PDF-ről AI-val (Gemini) kiolvasva vagy kézzel felvéve.
 * Pénz egész baniban. Állapot: draft (átnézésre vár) → received (bevételezve). A piszkozat elvetése törli.
 */
export const supplierInvoices = sqliteTable(
  "supplier_invoices",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("draft"),
    revision: integer("revision").notNull().default(0),
    supplierName: text("supplier_name").notNull().default(""),
    supplierTaxId: text("supplier_tax_id").notNull().default(""),
    series: text("series").notNull().default(""),
    number: text("number").notNull().default(""),
    issueDate: text("issue_date").notNull().default(""),
    currency: text("currency").notNull().default("RON"),
    subtotal: integer("subtotal"),
    vatTotal: integer("vat_total"),
    sgrTotal: integer("sgr_total").notNull().default(0),
    total: integer("total"),
    source: text("source").notNull(),
    model: text("model").notNull().default(""),
    hasFile: integer("has_file").notNull().default(0),
    note: text("note").notNull().default(""),
    costBasis: text("cost_basis").notNull().default(""),
    /** v72: a beszállító-törzs sora (CUI szerint párosítva vagy bevételezéskor felvéve). */
    supplierId: text("supplier_id").references(() => suppliers.id),
    /** v72: fizetési határidő (scadență), YYYY-MM-DD vagy üres. */
    dueDate: text("due_date").notNull().default(""),
    /** v72: ha a sorok összege a tűrésnél jobban eltér a végösszegtől, csak indoklással vételezhető be. */
    mismatchReason: text("mismatch_reason").notNull().default(""),
    receivedDate: text("received_date").notNull().default(""),
    receivedBy: text("received_by").notNull().default(""),
    receivedAt: text("received_at").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("supplier_invoice_kind", sql`${t.kind} IN ('factura','bon_fiscal')`),
    check("supplier_invoice_status", sql`${t.status} IN ('draft','received')`),
    check("supplier_invoice_source", sql`${t.source} IN ('ai','manual')`),
    index("supplier_invoice_created").on(t.createdAt),
  ],
);
/** A számla eredeti képe vagy PDF-je (base64), a termékképekhez hasonlóan az adatbázisban. */
export const supplierInvoiceFiles = sqliteTable("supplier_invoice_files", {
  invoiceId: text("invoice_id").primaryKey().references(() => supplierInvoices.id),
  mime: text("mime").notNull(),
  bytes: integer("bytes").notNull(),
  data: text("data").notNull(),
});
/**
 * Számlasor. A számlán szereplő mennyiség ezredekben (`invoiceQuantity` 1250 = 1,25), a raktárba kerülő mennyiség alapegységben
 * (`baseQuantity`: g / ml / db). Kihagyott sor (pl. SGR-betét, zacskó) nem kerül a raktárba.
 */
export const supplierInvoiceLines = sqliteTable(
  "supplier_invoice_lines",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull().references(() => supplierInvoices.id),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    invoiceQuantity: integer("invoice_quantity").notNull(),
    invoiceUnit: text("invoice_unit").notNull().default(""),
    lineNet: integer("line_net"),
    vatRate: integer("vat_rate"),
    lineGross: integer("line_gross"),
    deposit: integer("deposit").notNull().default(0),
    skip: integer("skip").notNull().default(0),
    ingredientId: text("ingredient_id").references(() => ingredients.id),
    baseQuantity: integer("base_quantity").notNull().default(0),
    /** v72: ténylegesen átvett mennyiség alapegységben; üres = a számlázott (base_quantity). Eltérés a NIR-en látszik. */
    receivedQuantity: integer("received_quantity"),
    expires: text("expires").notNull().default(""),
    batch: text("batch").notNull().default(""),
    lotId: text("lot_id").references(() => stockLots.id),
  },
  (t) => [
    index("supplier_invoice_line_invoice").on(t.invoiceId),
    check("supplier_invoice_line_quantity", sql`${t.invoiceQuantity}>=0 AND ${t.baseQuantity}>=0`),
  ],
);
/** Megjegyzett párosítás: szállító + számlán szereplő megnevezés → alapanyag és átváltás (alapegység / számlaegység, ezredekben). */
export const invoiceItemMappings = sqliteTable("invoice_item_mappings", {
  key: text("key").primaryKey(),
  ingredientId: text("ingredient_id").notNull().references(() => ingredients.id),
  factor: integer("factor").notNull(),
  updatedAt: text("updated_at").notNull(),
});
/** Beszerzési beállítások (egy sor): bekerülési érték nettó vagy bruttó. [ELLENŐRIZENDŐ] a könyvelővel – alapból nettó. */
export const purchaseSettings = sqliteTable(
  "purchase_settings",
  {
    id: integer("id").primaryKey(),
    costBasis: text("cost_basis").notNull().default("net"),
    /** v72: a recepciós bizottság tagjai (soronként egy név), a NIR-re pillanatképként kerül. */
    nirCommittee: text("nir_committee").notNull().default(""),
    revision: integer("revision").notNull().default(0),
  },
  (t) => [
    check("purchase_settings_singleton", sql`${t.id}=1`),
    check("purchase_settings_basis", sql`${t.costBasis} IN ('net','gross')`),
  ],
);

/**
 * Bizonylat-sorozatok (v71): típusonként és évenként egy számláló (kulcs: „nir:2026”). A szám a bizonylattal egy
 * D1-kötegben fogy (lásd src/modules/documents/server.ts), ezért hézag nélküli. Az előtag sorozatonként átírható.
 */
export const documentSeries = sqliteTable(
  "document_series",
  {
    key: text("key").primaryKey(),
    docType: text("doc_type").notNull(),
    year: integer("year").notNull(),
    prefix: text("prefix").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("document_series_type_year").on(t.docType, t.year),
    check("document_series_next", sql`${t.nextNumber}>=1`),
  ],
);

/**
 * NIR – Notă de intrare-recepție (v72). A beszállítói számla bevételezésekor keletkezik, sorszámmal (document_series: nir).
 * Pillanatkép: szállító, számla, bizottság, sorok (számlázott / átvett mennyiség, érték, TVA, raktártétel). Végleges:
 * nem módosítható és nem törölhető; sztornó-NIR-rel (negatív sorok) érvényteleníthető, ami a raktári tételt is visszaveszi.
 */
export const nirDocuments = sqliteTable(
  "nir_documents",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull().references(() => supplierInvoices.id),
    year: integer("year").notNull(),
    number: integer("number").notNull(),
    kind: text("kind").notNull().default("receipt"),
    status: text("status").notNull().default("issued"),
    reversalOf: text("reversal_of"),
    reversedBy: text("reversed_by"),
    issueDate: text("issue_date").notNull(),
    content: text("content").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("nir_number").on(t.year, t.number),
    index("nir_invoice").on(t.invoiceId),
    check("nir_kind", sql`${t.kind} IN ('receipt','reversal')`),
    check("nir_status", sql`${t.status} IN ('issued','reversed')`),
  ],
);

/**
 * Gyártási tétel (v73): ételenként és gyártási naponként egy (egyszerre főzik a nap összes adagját).
 * A tételkód a címkén is szereplő lotCode(nap, étel). A receptváltozat és az al-receptek változata a felvételkor
 * (nyitott tételnél mentéskor frissül) rögzül; lezáráskor erre a tényleges adagszámra adja ki az anyagot (bon de consum).
 */
export const productionBatches = sqliteTable(
  "production_batches",
  {
    id: text("id").primaryKey(),
    day: text("day").notNull(),
    productId: text("product_id").notNull().references(() => products.id),
    code: text("code").notNull(),
    recipeId: text("recipe_id").references(() => recipes.id),
    /** JSON tömb: a felhasznált al-receptváltozatok azonosítói. */
    preparationVersionIds: text("preparation_version_ids").notNull().default("[]"),
    ordered: integer("ordered").notNull().default(0),
    planned: integer("planned").notNull().default(0),
    actual: integer("actual"),
    /** A lezáráskor a rendelésenként már korábban kiadott adagok (ezekre nem fogy újra anyag). */
    issuedBefore: integer("issued_before").notNull().default(0),
    status: text("status").notNull().default("open"),
    revision: integer("revision").notNull().default(0),
    consumptionId: text("consumption_id"),
    useBy: text("use_by"),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    closedBy: text("closed_by"),
    closedAt: text("closed_at"),
  },
  (t) => [
    uniqueIndex("production_batch_day_product").on(t.day, t.productId),
    check("production_batch_status", sql`${t.status} IN ('open','closed')`),
    check("production_batch_quantities", sql`${t.planned}>=0 AND ${t.ordered}>=0 AND (${t.actual} IS NULL OR ${t.actual}>=0)`),
  ],
);

/**
 * Bon de consum (v73): a gyártási tétel anyagkiadásának sorszámozott bizonylata (document_series: consumption).
 * Pillanatkép (étel, adag, alapanyagok, raktári tételek, érték). Végleges, csak sztornó-BC-vel érvényteleníthető.
 */
export const consumptionDocuments = sqliteTable(
  "consumption_documents",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull().references(() => productionBatches.id),
    year: integer("year").notNull(),
    number: integer("number").notNull(),
    kind: text("kind").notNull().default("consumption"),
    status: text("status").notNull().default("issued"),
    reversalOf: text("reversal_of"),
    reversedBy: text("reversed_by"),
    issueDate: text("issue_date").notNull(),
    content: text("content").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("consumption_number").on(t.year, t.number),
    index("consumption_batch").on(t.batchId),
    check("consumption_kind", sql`${t.kind} IN ('consumption','reversal')`),
    check("consumption_status", sql`${t.status} IN ('issued','reversed')`),
  ],
);

/** Gyártási beállítás (egyetlen sor, v73): a javasolt adagszám ráhagyása bázispontban (1000 = 10%). */
export const productionSettings = sqliteTable(
  "production_settings",
  {
    id: integer("id").primaryKey(),
    marginBps: integer("margin_bps").notNull().default(1000),
    revision: integer("revision").notNull().default(0),
    /** v74: a selejt-PV aláírói (soronként egy név). */
    writeOffCommittee: text("write_off_committee").notNull().default(""),
    /** v74: bon de predare készüljön-e a tétel lezárásakor. [ELLENŐRIZENDŐ] a könyvelővel – alapból ki. */
    handoverEnabled: integer("handover_enabled").notNull().default(0),
  },
  (t) => [check("production_settings_singleton", sql`${t.id}=1`), check("production_settings_margin", sql`${t.marginBps}>=0 AND ${t.marginBps}<=10000`)],
);

/**
 * Készétel-mozgás (v74): a napi záráskor rögzített kiadás egy gyártási tételből – eladás, dolgozói étkezés, selejt, adomány.
 * A tétel készlete = tényleges adag − a mozgások összege. A nap visszanyitása törli a nap mozgásait (a napló és a PV megmarad).
 */
export const finishedMoves = sqliteTable(
  "finished_moves",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull().references(() => productionBatches.id),
    day: text("day").notNull(),
    kind: text("kind").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("finished_moves_batch").on(t.batchId),
    index("finished_moves_day").on(t.day),
    check("finished_moves_kind", sql`${t.kind} IN ('sold','staff','waste','donation')`),
    check("finished_moves_quantity", sql`${t.quantity}>0`),
  ],
);

/** Napi zárás (v74): naponta egy sor; a konyha zárja le, az admin nyithatja vissza. A lezárt nap egyenlege pillanatképként. */
export const productionDayCloses = sqliteTable(
  "production_day_closes",
  {
    day: text("day").primaryKey(),
    status: text("status").notNull().default("open"),
    revision: integer("revision").notNull().default(0),
    content: text("content").notNull().default("{}"),
    writeOffId: text("write_off_id"),
    closedBy: text("closed_by"),
    closedAt: text("closed_at"),
  },
  (t) => [check("production_day_close_status", sql`${t.status} IN ('open','closed')`)],
);

/**
 * Gyártási bizonylatok (v74): selejt-PV (proces-verbal de casare, sorozat write_off) és bon de predare (sorozat handover).
 * Végleges, csak sztornóval érvényteleníthető.
 */
export const productionDocuments = sqliteTable(
  "production_documents",
  {
    id: text("id").primaryKey(),
    docType: text("doc_type").notNull(),
    year: integer("year").notNull(),
    number: integer("number").notNull(),
    kind: text("kind").notNull().default("issue"),
    status: text("status").notNull().default("issued"),
    reversalOf: text("reversal_of"),
    reversedBy: text("reversed_by"),
    issueDate: text("issue_date").notNull(),
    day: text("day").notNull(),
    batchId: text("batch_id").references(() => productionBatches.id),
    content: text("content").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("production_document_number").on(t.docType, t.year, t.number),
    index("production_document_day").on(t.day),
    check("production_document_type", sql`${t.docType} IN ('write_off','handover')`),
    check("production_document_kind", sql`${t.kind} IN ('issue','reversal')`),
    check("production_document_status", sql`${t.status} IN ('issued','reversed')`),
  ],
);

/**
 * Aviz de însoțire a mărfii (v75): rendelésenként legfeljebb egy érvényes (kiállított, nem sztornózott) aviz, sorszámmal
 * (document_series: delivery_note). Pillanatkép: szállító, vevő, tételek gyártási tétellel, ár nélkül. Végleges: csak
 * sztornó-avizzal érvényteleníthető. Az invoice_id-t az 5. fázis (számlázás) tölti ki.
 */
export const deliveryNotes = sqliteTable(
  "delivery_notes",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id),
    year: integer("year").notNull(),
    number: integer("number").notNull(),
    kind: text("kind").notNull().default("issue"),
    status: text("status").notNull().default("issued"),
    reversalOf: text("reversal_of"),
    reversedBy: text("reversed_by"),
    issueDate: text("issue_date").notNull(),
    day: text("day").notNull(),
    content: text("content").notNull(),
    invoiceId: text("invoice_id"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("delivery_note_number").on(t.year, t.number),
    uniqueIndex("delivery_note_one_active").on(t.orderId).where(sql`${t.kind}='issue' AND ${t.status}='issued'`),
    index("delivery_note_day").on(t.day),
    check("delivery_note_kind", sql`${t.kind} IN ('issue','reversal')`),
    check("delivery_note_status", sql`${t.status} IN ('issued','reversed')`),
  ],
);

/** Aviz-beállítás (egyetlen sor, v75): minden kiszállításhoz készüljön-e aviz. [ELLENŐRIZENDŐ] a könyvelővel – alapból ki. */
export const deliveryNoteSettings = sqliteTable(
  "delivery_note_settings",
  {
    id: integer("id").primaryKey(),
    allDeliveries: integer("all_deliveries").notNull().default(0),
    revision: integer("revision").notNull().default(0),
  },
  (t) => [check("delivery_note_settings_singleton", sql`${t.id}=1`)],
);

/**
 * Pénztártétel (v76, registru de casă): egy pénztár, előjeles összeg baniban (+ bevétel, − kiadás). Mindig a rögzítés
 * (Europe/Bucharest) napjára kerül; végleges, javítás sztornó-tétellel. A záró egyenleg nem lehet negatív.
 */
export const cashEntries = sqliteTable(
  "cash_entries",
  {
    id: text("id").primaryKey(),
    day: text("day").notNull(),
    kind: text("kind").notNull(),
    amount: integer("amount").notNull(),
    document: text("document").notNull().default(""),
    note: text("note").notNull().default(""),
    refId: text("ref_id"),
    reversalOf: text("reversal_of"),
    actor: text("actor").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("cash_entries_day").on(t.day),
    check("cash_entries_kind", sql`${t.kind} IN ('counter_sale','courier_handover','supplier_payment','deposit','bank_deposit','other_in','other_out','reversal')`),
    check("cash_entries_amount", sql`${t.amount}<>0`),
  ],
);

/** Pénztárnap (v76): lezáráskor a nyitó és záró egyenleg pillanatképe; lezárt napra nem kerülhet tétel. */
export const cashDays = sqliteTable(
  "cash_days",
  {
    day: text("day").primaryKey(),
    status: text("status").notNull().default("open"),
    opening: integer("opening").notNull().default(0),
    closing: integer("closing").notNull().default(0),
    revision: integer("revision").notNull().default(0),
    closedBy: text("closed_by"),
    closedAt: text("closed_at"),
  },
  (t) => [check("cash_days_status", sql`${t.status} IN ('open','closed')`)],
);

/** Futár készpénz-leadása (v76): elvárt (a le nem adott készpénzes befizetései) és átadott összeg, eltéréssel. */
export const courierHandovers = sqliteTable(
  "courier_handovers",
  {
    id: text("id").primaryKey(),
    courierUserId: text("courier_user_id").notNull(),
    courierName: text("courier_name").notNull(),
    day: text("day").notNull(),
    expected: integer("expected").notNull(),
    counted: integer("counted").notNull(),
    note: text("note").notNull().default(""),
    cashEntryId: text("cash_entry_id"),
    actor: text("actor").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("courier_handovers_day").on(t.day), check("courier_handovers_counted", sql`${t.counted}>=0`)],
);

/**
 * Befizetés egy rendelésre (v76): készpénz vagy kártya, ki vette át (futár / iroda). Előjeles: a sztornó negatív tétel
 * (reversal_of). A futár készpénze a leadásig (handover_id) nála van; az iroda készpénze azonnal pénztártétel lesz.
 */
export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id),
    day: text("day").notNull(),
    method: text("method").notNull(),
    amount: integer("amount").notNull(),
    collectedBy: text("collected_by").notNull(),
    collectorId: text("collector_id").notNull(),
    collectorName: text("collector_name").notNull().default(""),
    reversalOf: text("reversal_of"),
    reversedBy: text("reversed_by"),
    handoverId: text("handover_id").references(() => courierHandovers.id),
    cashEntryId: text("cash_entry_id"),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("payments_order").on(t.orderId),
    index("payments_day").on(t.day),
    check("payments_method", sql`${t.method} IN ('cash','card')`),
    check("payments_collected_by", sql`${t.collectedBy} IN ('courier','office')`),
    check("payments_amount", sql`${t.amount}<>0`),
  ],
);

/** Z-jelentés (v76): naponta egy, kézi rögzítés; az eltérés a rögzített fizetésekhez képest látszik. */
export const zReports = sqliteTable("z_reports", {
  day: text("day").primaryKey(),
  zNumber: text("z_number").notNull(),
  total: integer("total").notNull(),
  cash: integer("cash").notNull(),
  card: integer("card").notNull(),
  note: text("note").notNull().default(""),
  revision: integer("revision").notNull().default(0),
  actor: text("actor").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Beszállítói kifizetés (v76): pénztárból vagy bankból, részletben is; sztornó negatív tétellel. */
export const supplierPayments = sqliteTable(
  "supplier_payments",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull().references(() => supplierInvoices.id),
    day: text("day").notNull(),
    method: text("method").notNull(),
    amount: integer("amount").notNull(),
    reversalOf: text("reversal_of"),
    reversedBy: text("reversed_by"),
    cashEntryId: text("cash_entry_id"),
    note: text("note").notNull().default(""),
    actor: text("actor").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("supplier_payments_invoice").on(t.invoiceId),
    check("supplier_payments_method", sql`${t.method} IN ('cash','bank')`),
    check("supplier_payments_amount", sql`${t.amount}<>0`),
  ],
);

/**
 * Ügyfél számlázási adatai (v77): mód (bon fiscal / számla minden rendelésnél / havi gyűjtőszámla) és a számlán szereplő
 * vevőadatok. Hiányzó sor = bon fiscal (magánszemély), mint eddig.
 */
export const customerBilling = sqliteTable(
  "customer_billing",
  {
    customerId: text("customer_id").primaryKey().references(() => customers.id),
    kind: text("kind").notNull().default("person"),
    mode: text("mode").notNull().default("receipt"),
    name: text("name").notNull().default(""),
    cif: text("cif").notNull().default(""),
    regCom: text("reg_com").notNull().default(""),
    address: text("address").notNull().default(""),
    city: text("city").notNull().default(""),
    county: text("county").notNull().default(""),
    country: text("country").notNull().default("România"),
    email: text("email").notNull().default(""),
    paymentDays: integer("payment_days").notNull().default(15),
    revision: integer("revision").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check("customer_billing_kind", sql`${t.kind} IN ('person','company')`),
    check("customer_billing_mode", sql`${t.mode} IN ('receipt','per_order','monthly')`),
    check("customer_billing_days", sql`${t.paymentDays}>=0 AND ${t.paymentDays}<=120`),
  ],
);

/** Számlázási beállítás (egyetlen sor, v77): Oblio-mód, cég CIF, sorozat, TVA-kulcsok, befizetéstípusok. */
export const billingSettings = sqliteTable(
  "billing_settings",
  {
    id: integer("id").primaryKey(),
    mode: text("mode").notNull().default("simulated"),
    companyCif: text("company_cif").notNull().default(""),
    seriesName: text("series_name").notNull().default(""),
    stornoSeriesName: text("storno_series_name").notNull().default(""),
    vatFoodBps: integer("vat_food_bps").notNull().default(1100),
    vatDeliveryBps: integer("vat_delivery_bps").notNull().default(2100),
    cashCollectType: text("cash_collect_type").notNull().default("Alta incasare numerar"),
    receiptSeries: text("receipt_series").notNull().default(""),
    autoSpv: integer("auto_spv").notNull().default(1),
    revision: integer("revision").notNull().default(0),
  },
  (t) => [
    check("billing_settings_singleton", sql`${t.id}=1`),
    check("billing_settings_mode", sql`${t.mode} IN ('simulated','live')`),
  ],
);

/**
 * Kimenő számla (v77). A számlát az Oblio állítja ki és számozza; itt a kérés pillanatképe, az egyedi kulcs (idempotencyKey)
 * és az eredmény (sorozat, szám, link, SPV-állapot). Állapot: pending (küldésre vár) → issued → stornoed; failed = hiba, újrapróbálható.
 */
export const salesInvoices = sqliteTable(
  "sales_invoices",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    period: text("period").notNull().default(""),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"),
    content: text("content").notNull(),
    total: integer("total").notNull(),
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date").notNull().default(""),
    oblioSeries: text("oblio_series").notNull().default(""),
    oblioNumber: text("oblio_number").notNull().default(""),
    oblioLink: text("oblio_link").notNull().default(""),
    spvCode: integer("spv_code"),
    spvText: text("spv_text").notNull().default(""),
    spvCheckedAt: text("spv_checked_at"),
    lastError: text("last_error").notNull().default(""),
    attempts: integer("attempts").notNull().default(0),
    stornoOf: text("storno_of"),
    stornoedBy: text("stornoed_by"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    issuedAt: text("issued_at"),
    revision: integer("revision").notNull().default(0),
  },
  (t) => [
    uniqueIndex("sales_invoice_key").on(t.idempotencyKey),
    index("sales_invoice_customer").on(t.customerId),
    check("sales_invoice_kind", sql`${t.kind} IN ('order','monthly','storno')`),
    check("sales_invoice_status", sql`${t.status} IN ('pending','failed','issued','stornoed')`),
  ],
);

/** Rendelés ↔ számla (v77): egy rendelés legfeljebb egy érvényes számlán (részleges egyedi index). */
export const salesInvoiceOrders = sqliteTable(
  "sales_invoice_orders",
  {
    invoiceId: text("invoice_id").notNull().references(() => salesInvoices.id),
    orderId: text("order_id").notNull().references(() => orders.id),
    active: integer("active").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.invoiceId, t.orderId] }),
    uniqueIndex("sales_invoice_order_active").on(t.orderId).where(sql`${t.active}=1`),
  ],
);

/** Számlára érkező utólagos befizetés (v77): jellemzően utalás a havi számlára; sztornó negatív tétellel. */
export const salesInvoicePayments = sqliteTable(
  "sales_invoice_payments",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull().references(() => salesInvoices.id),
    day: text("day").notNull(),
    amount: integer("amount").notNull(),
    reference: text("reference").notNull().default(""),
    reversalOf: text("reversal_of"),
    actor: text("actor").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("sales_invoice_payments_invoice").on(t.invoiceId), check("sales_invoice_payments_amount", sql`${t.amount}<>0`)],
);

/** Befizetés átadása az Obliónak (v77): forrásonként (rendelés-befizetés vagy számla-befizetés) egyszer; újrapróbálható. */
export const salesInvoiceCollects = sqliteTable(
  "sales_invoice_collects",
  {
    sourceId: text("source_id").primaryKey(),
    invoiceId: text("invoice_id").notNull().references(() => salesInvoices.id),
    source: text("source").notNull(),
    amount: integer("amount").notNull(),
    collectType: text("collect_type").notNull(),
    status: text("status").notNull().default("pending"),
    lastError: text("last_error").notNull().default(""),
    createdAt: text("created_at").notNull(),
    sentAt: text("sent_at"),
  },
  (t) => [index("sales_invoice_collects_invoice").on(t.invoiceId), check("sales_invoice_collects_status", sql`${t.status} IN ('pending','sent','failed','skipped')`)],
);

/** Szimulált Oblio (v77): a szimulált számlák az egyedi kulccsal, hogy az ismételt kérés ugyanazt adja vissza. */
export const oblioSimulated = sqliteTable("oblio_simulated", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  seriesName: text("series_name").notNull(),
  number: integer("number").notNull(),
  payload: text("payload").notNull(),
  spvCode: integer("spv_code"),
  collected: integer("collected").notNull().default(0),
  cancelled: integer("cancelled").notNull().default(0),
  createdAt: text("created_at").notNull(),
});
