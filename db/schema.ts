import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
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
