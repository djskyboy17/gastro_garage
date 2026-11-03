import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node native type stripping
import { DOCUMENT_TYPES, isDocumentType, documentYear, seriesKey, formatDocumentNumber, validPrefix } from "../src/modules/documents/domain.ts";

test("Document numbers are per type and year, zero-padded, and restart every year", () => {
  assert.equal(DOCUMENT_TYPES.nir, "NIR");
  assert.equal(isDocumentType("nir"), true);
  assert.equal(isDocumentType("toString"), false);
  assert.equal(documentYear("2026-12-31"), 2026);
  assert.throws(() => documentYear("31.12.2026"), /DOCUMENT_DATE/);
  assert.equal(seriesKey("nir", 2026), "nir:2026");
  assert.notEqual(seriesKey("nir", 2026), seriesKey("nir", 2027));
  assert.equal(formatDocumentNumber("NIR", 2026, 1), "NIR-2026-0001");
  assert.equal(formatDocumentNumber("AVZ", 2027, 12345), "AVZ-2027-12345");
  assert.throws(() => formatDocumentNumber("NIR", 2026, 0), /DOCUMENT_NUMBER/);
  assert.equal(validPrefix("NIR"), true);
  assert.equal(validPrefix("nir"), false);
  assert.equal(validPrefix("NIR-KONYHA-1"), false);
});
