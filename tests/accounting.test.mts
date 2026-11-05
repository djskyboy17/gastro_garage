import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
// @ts-ignore Node native type stripping
import { courierOrderVisible } from "../src/modules/courier/domain.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(name, directory), "utf8"));
  }
  return db;
}

test("Accounting profile protects gross NIR and mandatory handover through real migrations (v84: aviz only for company deliveries)", () => {
  const db = database();
  try {
    db.exec("INSERT INTO purchase_settings(id,cost_basis,nir_committee) VALUES(1,'net','Existing committee'); INSERT INTO production_settings(id,margin_bps,write_off_committee) VALUES(1,500,'Existing signer'); INSERT INTO delivery_note_settings(id) VALUES(1)");
    db.exec("UPDATE purchase_settings SET cost_basis='gross'; UPDATE production_settings SET handover_enabled=1; UPDATE delivery_note_settings SET all_deliveries=1; INSERT INTO accounting_profile VALUES(1,'non_vat_payer','','2026-11-05',1,'test','2026-11-05T10:00:00Z')");
    assert.throws(() => db.exec("UPDATE purchase_settings SET cost_basis='net'"), /ACCOUNTING_GROSS_REQUIRED/);
    assert.throws(() => db.exec("UPDATE production_settings SET handover_enabled=0"), /ACCOUNTING_HANDOVER_REQUIRED/);
    // v84: az aviz-szabály (minden kiszállítás) már nem kötött a profilhoz – aviz a céges kiszállításokhoz kell.
    db.exec("UPDATE delivery_note_settings SET all_deliveries=0");
    assert.throws(() => db.exec("INSERT INTO purchase_settings(id,cost_basis) VALUES(1,'net') ON CONFLICT(id) DO UPDATE SET cost_basis='net'"), /ACCOUNTING_GROSS_REQUIRED/);
    assert.equal(db.prepare("SELECT nir_committee FROM purchase_settings").get()?.nir_committee, "Existing committee");
    assert.equal(db.prepare("SELECT write_off_committee FROM production_settings").get()?.write_off_committee, "Existing signer");
    assert.equal(db.prepare("SELECT margin_bps FROM production_settings").get()?.margin_bps, 500);
    assert.equal(db.prepare("SELECT cost_basis FROM purchase_settings").get()?.cost_basis, "gross");
  } finally { db.close(); }
});

test("v84: a company delivery cannot leave without an issued aviz; private customers and pickups are not blocked", () => {
  const db = database();
  try {
    db.exec("INSERT INTO customers(id,name,address,phone,note) VALUES('co','Firma SRL','Str. 1','07','' ),('pf','Ana','Str. 2','07','')");
    db.exec("INSERT INTO customer_billing(customer_id,kind,name,cif,updated_at) VALUES('co','company','Firma SRL','RO18547290','2026-11-05')");
    const order = db.prepare("INSERT INTO orders(id,customer_id,customer_name,address,phone,date,time,note,fulfillment_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
    order.run("o-co", "co", "Firma SRL", "Str. 1", "07", "2026-11-05", "12:00", "", "delivery", "2026-11-05");
    order.run("o-pf", "pf", "Ana", "Str. 2", "07", "2026-11-05", "12:00", "", "delivery", "2026-11-05");
    order.run("o-pick", "co", "Firma SRL", "Str. 1", "07", "2026-11-05", "12:00", "", "pickup", "2026-11-05");
    assert.throws(() => db.exec("UPDATE orders SET delivery='transit' WHERE id='o-co'"), /AVIZ_REQUIRED/);
    db.exec("UPDATE orders SET delivery='transit' WHERE id='o-pf'");
    db.exec("UPDATE orders SET delivery='transit' WHERE id='o-pick'");
    db.exec("INSERT INTO delivery_notes(id,order_id,year,number,kind,status,issue_date,day,content,created_by,created_at) VALUES('n1','o-co',2026,1,'issue','issued','2026-11-05','2026-11-05','{}','t','2026-11-05')");
    db.exec("UPDATE orders SET delivery='transit' WHERE id='o-co'");
    assert.equal(db.prepare("SELECT delivery FROM orders WHERE id='o-co'").get()?.delivery, "transit");
  } finally { db.close(); }
});

test("Courier aviz visibility matches current tasks, including overdue and transit orders", () => {
  const order = { status: "confirmed", fulfillmentMode: "delivery", date: "2026-11-04", delivery: "pending" };
  assert.equal(courierOrderVisible(order, "2026-11-05", "2026-11-05"), true);
  assert.equal(courierOrderVisible({ ...order, delivery: "delivered" }, "2026-11-05", "2026-11-05"), false);
  assert.equal(courierOrderVisible({ ...order, delivery: "delivered" }, "2026-11-04", "2026-11-05"), true);
  assert.equal(courierOrderVisible({ ...order, date: "2026-11-06" }, "2026-11-05", "2026-11-05"), false);
  assert.equal(courierOrderVisible({ ...order, date: "2026-11-06", delivery: "transit" }, "2026-11-05", "2026-11-05"), true);
  assert.equal(courierOrderVisible({ ...order, fulfillmentMode: "pickup" }, order.date, order.date), false);
  assert.equal(courierOrderVisible({ ...order, status: "cancelled" }, order.date, order.date), false);
});

test("Expense posting history permits one active record and one reversal, independently of stock", () => {
  const db = database();
  try {
    db.exec("INSERT INTO supplier_invoices(id,kind,purpose,source,created_by,created_at) VALUES('expense','factura','expense','manual','test','2026-11-05')");
    const record = db.prepare("INSERT INTO expense_documents(id,invoice_id,kind,posting_day,amount,content,created_by,created_at) VALUES(?,'expense','expense','2026-11-05',12100,'{}','test','2026-11-05')");
    record.run("record-1");
    assert.throws(() => record.run("duplicate"), /UNIQUE/);
    db.exec("UPDATE expense_documents SET reversed_by='reversal-1' WHERE id='record-1'; INSERT INTO expense_documents(id,invoice_id,kind,posting_day,amount,content,reversal_of,created_by,created_at) VALUES('reversal-1','expense','reversal','2026-11-06',-12100,'{}','record-1','test','2026-11-06')");
    assert.equal(db.prepare("SELECT SUM(amount) AS total FROM expense_documents").get()?.total, 0);
    record.run("record-2");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stock_lots").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM nir_documents").get()?.n, 0);
    assert.equal(db.prepare("SELECT SUM(amount) AS total FROM expense_documents").get()?.total, 12100);
  } finally { db.close(); }
});
