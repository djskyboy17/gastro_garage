import {
  sqliteTable,
  text,
  integer,
  check,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const products = sqliteTable("products", {
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
});
export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  phone: text("phone").notNull(),
  note: text("note").notNull(),
});
export const orders = sqliteTable("orders", {
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
});
export const audit = sqliteTable("audit", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  detail: text("detail").notNull(),
  createdAt: text("created_at").notNull(),
});
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
});
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
      sql`${t.remaining} >= 0 AND ${t.remaining} <= ${t.quantity}`,
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
