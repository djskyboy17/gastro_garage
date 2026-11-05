import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node native type stripping
import { slug, partnerKey, archiveKey, extFor, sha256Hex, OWN_PARTNER } from "../src/modules/archive/domain.ts";

test("Keys follow archive/{YYYY}/{MM}/{PARTNER}/{TYPE}_{NUMBER}_{ID}.{ext} with safe characters", () => {
  assert.equal(
    archiveKey({ type: "NIR", number: "NIR-2026-0001", issueDate: "2026-11-05", partner: partnerKey("RO 18547290", "Metro"), id: "a8f92b1c-1111-4222-8333-444455556666", mime: "text/html; charset=utf-8" }),
    "archive/2026/11/RO18547290/NIR_NIR-2026-0001_a8f92b1c.html",
  );
  assert.equal(
    archiveKey({ type: "SUPPLIER_INVOICE", number: "MCC 000/123", issueDate: "2026-10-31", partner: partnerKey("", "Ștefan & Fiii S.R.L."), id: "ffff0000-aaaa", mime: "application/pdf" }),
    "archive/2026/10/STEFAN-FIII-S-R-L/SUPPLIER_INVOICE_MCC-000-123_ffff0000.pdf",
  );
  assert.equal(archiveKey({ type: "REGISTRU_CASA", number: "2026-11-05", issueDate: "2026-11-05", partner: OWN_PARTNER, id: "abc", mime: "text/html", version: 2 }), "archive/2026/11/GASTRO-GARAGE/REGISTRU_CASA_2026-11-05-V2_abc.html");
  assert.throws(() => archiveKey({ type: "NIR", number: "x", issueDate: "05.11.2026", partner: "x", id: "a", mime: "text/html" }), /ARCHIVE_DATE/);
});

test("Partner and number simplification never produces path separators or empty parts", () => {
  assert.equal(partnerKey("18547290", "x"), "18547290");
  assert.equal(partnerKey("", ""), OWN_PARTNER);
  assert.equal(slug("../../etc/passwd"), "ETC-PASSWD");
  assert.equal(slug("   "), "NA");
  assert.equal(slug("a".repeat(80)).length, 40);
  assert.equal(extFor("image/jpeg"), "jpg");
  assert.equal(extFor("application/x-unknown"), "bin");
});

test("SHA-256 hex", async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
