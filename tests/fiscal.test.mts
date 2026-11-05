import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
// @ts-ignore Native Node type stripping
import { receiptLines, matchesReceiptToken } from "../src/modules/fiscal/domain.ts";
// @ts-ignore Native Node type stripping
import { nextFiscalReceiptState } from "../src/modules/shared/domain.ts";

test("Fiscal lines use historical prices, include delivery once, and preserve integer bani", () => {
  const input = [{ productId: "soup", name: "Supă", unitBani: 2015, quantity: 2 }];
  const snapshot = receiptLines(input, 505);
  input[0].unitBani = 9999;
  assert.equal(snapshot.total, 4535);
  assert.equal(snapshot.lines[0].unitBani, 2015);
  assert.deepEqual(snapshot.lines[1], { productId: null, name: "Livrare", unitBani: 505, quantity: 1 });
  assert.throws(() => receiptLines([{ ...input[0], unitBani: 0 }], 0), /FISCAL_LINES/);
  assert.throws(() => receiptLines([{ ...input[0], quantity: 1.5 }], 0), /FISCAL_LINES/);
});

test("Uncertain receipts require an explicit resolution; issued receipts cannot be reopened", () => {
  assert.equal(nextFiscalReceiptState("prepared", "uncertain"), "uncertain");
  assert.equal(nextFiscalReceiptState("uncertain", "issued"), "issued");
  assert.equal(nextFiscalReceiptState("uncertain", "not_issued"), "not_issued");
  assert.throws(() => nextFiscalReceiptState("issued", "prepared"), /FISCAL_STATE/);
  assert.throws(() => nextFiscalReceiptState("not_issued", "issued"), /FISCAL_STATE/);
});

test("Result correlation rejects a token from a different print job", async () => {
  assert.equal(await matchesReceiptToken("a".repeat(64), "a".repeat(64)), true);
  assert.equal(await matchesReceiptToken("a".repeat(64), "b".repeat(64)), false);
});

test("Real migrations prevent duplicate issue, parallel device jobs and mutation of printed snapshots", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of readdirSync(new URL("../drizzle/", import.meta.url)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL("../drizzle/" + name, import.meta.url), "utf8"));
    db.exec("INSERT INTO customers VALUES('c','Demo','','',''); INSERT INTO products(id,hu,ro,description_hu,description_ro,category,price,portion,allergens) VALUES('p','Leves','Supa','','','soup',2000,300,''); INSERT INTO orders(id,customer_id,customer_name,address,phone,date,time,note,created_at) VALUES('o1','c','Demo','','','2026-11-05','12:00','','now'),('o2','c','Demo','','','2026-11-05','12:00','','now'); INSERT INTO order_items(id,order_id,product_id,hu,ro,allergens,quantity,price) VALUES('i','o1','p','Leves','Supa','',1,2000)");
    const insert = db.prepare("INSERT INTO fiscal_receipts(id,order_id,mode,state,day,method,total,content,token,device_serial,expires_at,created_by,created_at) VALUES(?,?,?,'prepared','2026-11-05','cash',2000,'[]','token','S25TEST','later','test','now')");
    insert.run("j1", "o1", "live");
    assert.throws(() => insert.run("j2", "o1", "live"), /UNIQUE/);
    assert.throws(() => insert.run("j3", "o2", "live"), /UNIQUE/);
    assert.throws(() => db.exec("UPDATE orders SET expected_payment_method='card' WHERE id='o1'"), /FISCAL_ORDER_LOCKED/);
    assert.throws(() => db.exec("UPDATE order_items SET price=1 WHERE id='i'"), /FISCAL_ORDER_LOCKED/);
    assert.throws(() => db.exec("DELETE FROM order_items WHERE id='i'"), /FISCAL_ORDER_LOCKED/);
    assert.throws(() => db.exec("UPDATE fiscal_receipts SET total=1 WHERE id='j1'"), /FISCAL_ORDER_LOCKED/);
    db.exec("UPDATE order_items SET ready=1 WHERE id='i'; UPDATE orders SET production='cooking',revision=revision+1 WHERE id='o1'; UPDATE fiscal_receipts SET state='issued',receipt_number='0011' WHERE id='j1'");
    insert.run("j3", "o2", "live");
    insert.run("simulation", "o1", "simulation");
    assert.equal(db.prepare("SELECT payment FROM orders WHERE id='o1'").get()?.payment, "unpaid");
    assert.throws(() => db.exec("UPDATE orders SET status='cancelled' WHERE id='o1'"), /FISCAL_ORDER_LOCKED/);
    db.exec("UPDATE fiscal_receipts SET state='not_issued' WHERE id='j3'; UPDATE orders SET expected_payment_method='card' WHERE id='o2'");
  } finally { db.close(); }
});
