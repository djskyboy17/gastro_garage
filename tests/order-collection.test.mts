import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
// @ts-ignore Native Node type stripping
import { orderCollectionAllowedSql } from "../src/modules/billing/order-collection.ts";
function fixture() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter((f) => /^\d+.*\.sql$/.test(f)).sort()) db.exec(readFileSync(new URL("../drizzle/" + file, import.meta.url), "utf8"));
  db.exec("INSERT INTO customers VALUES('c','DEMO','','',''); INSERT INTO orders(id,customer_id,customer_name,address,phone,date,time,note,created_at) VALUES('o','c','DEMO','','','2026-11-05','12:00','','now')");
  return db;
}
test("Order collection follows billing mode, independent of an expected cash/card method", () => {
  const db = fixture();
  try {
    const allowed = () => db.prepare(`SELECT ${orderCollectionAllowedSql} AS allowed`).get('o')?.allowed;
    assert.equal(allowed(), 1, 'no profile retains normal collection');
    db.exec("INSERT INTO customer_billing(customer_id,mode,updated_at) VALUES('c','receipt','now')");
    assert.equal(allowed(), 1);
    db.exec("UPDATE customer_billing SET mode='per_order'"); assert.equal(allowed(), 1);
    db.exec("UPDATE customer_billing SET mode='monthly'; UPDATE orders SET expected_payment_method='cash'"); assert.equal(allowed(), 0);
    db.exec("UPDATE orders SET expected_payment_method='card'"); assert.equal(allowed(), 0);
    db.exec("UPDATE customer_billing SET mode='receipt'"); assert.equal(allowed(), 1);
  } finally { db.close(); }
});
test("A profile changed after preview rejects a payment batch without money, audit or revision changes", () => {
  const db = fixture();
  try {
    db.exec("INSERT INTO customer_billing(customer_id,mode,updated_at) VALUES('c','receipt','now')");
    assert.equal(db.prepare(`SELECT ${orderCollectionAllowedSql} AS allowed`).get('o')?.allowed, 1);
    db.exec("UPDATE customer_billing SET mode='monthly'");
    db.exec('BEGIN');
    assert.throws(() => {
      db.prepare(`INSERT INTO audit(id,actor,action,entity,detail,created_at) VALUES('a',CASE WHEN ${orderCollectionAllowedSql} THEN 'test' ELSE NULL END,'payment_recorded','o','','now')`).run('o');
      db.exec("INSERT INTO payments(id,order_id,day,method,amount,collected_by,collector_id,collector_name,note,created_at) VALUES('p','o','2026-11-05','cash',100,'office','test','DEMO','','now'); UPDATE orders SET revision=revision+1 WHERE id='o'");
    }, /NOT NULL/);
    db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments').get()?.n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cash_entries').get()?.n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit').get()?.n, 0);
    assert.equal(db.prepare("SELECT revision,payment FROM orders WHERE id='o'").get()?.revision, 0);
    assert.equal(db.prepare("SELECT payment FROM orders WHERE id='o'").get()?.payment, 'unpaid');
  } finally { db.close(); }
});
