import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node native type stripping
import { hashPassword, verifyPassword, DUMMY_HASH, newSessionToken, tokenDigest, readCookie, sessionCookie, clearedCookie, safeReturn, sameText, normalizeEmail, validEmail, validPassword, SESSION_COOKIE } from "../src/modules/auth/domain.ts";

test("Passwords are stored salted and verified only with the right password", async () => {
  const a = await hashPassword("helyes-jelszo-123"), b = await hashPassword("helyes-jelszo-123");
  assert.match(a, /^pbkdf2\$100000\$[^$]+\$[^$]+$/);
  assert.notEqual(a, b); // eltérő só
  assert.equal(a.includes("helyes-jelszo-123"), false);
  assert.equal(await verifyPassword("helyes-jelszo-123", a), true);
  assert.equal(await verifyPassword("rossz-jelszo-123", a), false);
  assert.equal(await verifyPassword("akarmi", DUMMY_HASH), false);
  // Sérült vagy túl drága tárolt érték: elutasítva, nem dob hibát.
  assert.equal(await verifyPassword("x", "plain$x"), false);
  assert.equal(await verifyPassword("x", "pbkdf2$999999999$AAAA$AAAA"), false);
});
test("Session tokens are random and only their digest is stored", async () => {
  const t1 = newSessionToken(), t2 = newSessionToken();
  assert.notEqual(t1, t2);
  assert.match(t1, /^[A-Za-z0-9_-]{43}$/);
  const d = await tokenDigest(t1);
  assert.match(d, /^[0-9a-f]{64}$/);
  assert.equal(d, await tokenDigest(t1));
  assert.notEqual(d, t1);
});
test("Session cookie is HttpOnly, SameSite=Lax and Secure on https", () => {
  const c = sessionCookie("abc", true);
  assert.ok(c.startsWith(SESSION_COOKIE + "=abc;"));
  for (const part of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/"]) assert.ok(c.includes(part), part);
  assert.equal(sessionCookie("abc", false).includes("Secure"), false);
  assert.ok(clearedCookie(true).includes("Max-Age=0"));
  assert.equal(readCookie("a=1; " + SESSION_COOKIE + "=tok; b=2", SESSION_COOKIE), "tok");
  assert.equal(readCookie(null, SESSION_COOKIE), null);
});
test("Return addresses stay on this site", () => {
  assert.equal(safeReturn("/portal?x=1#a"), "/portal?x=1#a");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", null, ""]) assert.equal(safeReturn(bad), "/");
});
test("Email and password rules", () => {
  assert.equal(normalizeEmail("  Ana@Pelda.RO "), "ana@pelda.ro");
  assert.equal(validEmail("ana@pelda.ro"), true);
  assert.equal(validEmail("ana@pelda"), false);
  assert.equal(validPassword("123456789"), false);
  assert.equal(validPassword("1234567890"), true);
  assert.equal(sameText("kod-123", "kod-123"), true);
  assert.equal(sameText("kod-123", "kod-124"), false);
  assert.equal(sameText("", "kod"), false);
});
