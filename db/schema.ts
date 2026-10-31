import {
  sqliteTable,
  text,
  integer,
  check,
  uniqueIndex,
  index,
  primaryKey,
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
  courierId: text("courier_id").references(() => couriers.id),
  courierName: text("courier_name").notNull().default(""),
  courierPhone: text("courier_phone").notNull().default(""),
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
});
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
});
export const audit = sqliteTable("audit", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  detail: text("detail").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [index("audit_entity_created").on(t.entity, t.createdAt)]);
export const couriers = sqliteTable("couriers", {
  userId:text("user_id").references(()=>members.userId),
  bindingRevision:integer("binding_revision").notNull().default(0),
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  vehicle: text("vehicle").notNull(),
  note: text("note").notNull(),
  createdAt: text("created_at").notNull(),
},t=>[uniqueIndex("courier_account_unique").on(t.userId)]);
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
}, t=>[check("menu_day_active",sql`${t.active} IN (0,1)`)]);
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
/** Napi futárbeosztás (v36): ki dolgozik aznap. A csomagolásnál csak ők választhatók. */
export const courierShifts = sqliteTable(
  "courier_shifts",
  {
    date: text("date").notNull(),
    courierId: text("courier_id")
      .notNull()
      .references(() => couriers.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.courierId] })],
);
