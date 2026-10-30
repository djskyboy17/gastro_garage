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

test("Weak passwords are rejected, normal ones accepted", async () => {
  // @ts-ignore Node native type stripping
  const { weakPassword } = await import("../src/modules/auth/domain.ts");
  for (const p of ["1234567890", "aaaaaaaaaa", "Password123", "ana.popescu99", "1212121212"]) assert.equal(weakPassword(p, "ana.popescu@pelda.ro"), true, p);
  for (const p of ["zold-alma-tavasz", "Ciorba de burta 7"]) assert.equal(weakPassword(p, "ana@pelda.ro"), false, p);
});
test("Temporary passwords are readable and random", async () => {
  // @ts-ignore Node native type stripping
  const { temporaryPassword } = await import("../src/modules/auth/domain.ts");
  const a = temporaryPassword(), b = temporaryPassword();
  assert.match(a, /^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/);
  assert.notEqual(a, b);
});
test("Only owner and admin can hand out a temporary password, never to the owner or themselves", async () => {
  // @ts-ignore Node native type stripping
  const { canResetPassword } = await import("../src/modules/auth/domain.ts");
  const owner = { actorId: "o", actorRole: "owner", ownerId: "o" };
  assert.equal(canResetPassword(owner, "staff"), true);
  assert.equal(canResetPassword(owner, "o"), false);
  assert.equal(canResetPassword({ actorId: "a", actorRole: "admin", ownerId: "o" }, "staff"), true);
  assert.equal(canResetPassword({ actorId: "a", actorRole: "admin", ownerId: "o" }, "o"), false);
  assert.equal(canResetPassword({ actorId: "a", actorRole: "admin", ownerId: "o" }, "a"), false);
  for (const role of ["dispatcher", "kitchen", "warehouse", "courier", "pending", "disabled"]) assert.equal(canResetPassword({ actorId: "x", actorRole: role, ownerId: "o" }, "staff"), false, role);
});
test("Google sign-in: PKCE, authorization URL and token checks", async () => {
  // @ts-ignore Node native type stripping
  const { pkceChallenge, googleAuthUrl, decodeJwtPayload, verifiedGoogleUser } = await import("../src/modules/auth/domain.ts");
  // S256: base64url(SHA-256(verifier)), összevetve a Node saját kriptográfiájával.
  const { createHash } = await import("node:crypto");
  const verifier = "dBjftJeZ4CVP-mJ92ZTN5ZVc2XEk5QEtoJ0Ns9QkdGI";
  assert.equal(await pkceChallenge(verifier), createHash("sha256").update(verifier).digest("base64url"));
  const u = new URL(googleAuthUrl({ clientId: "cid", redirectUri: "https://konyha.veres.no/api/auth/google/callback", state: "st", challenge: "ch", nonce: "no" }));
  assert.equal(u.origin, "https://accounts.google.com");
  for (const [k, v] of [["client_id", "cid"], ["state", "st"], ["code_challenge", "ch"], ["code_challenge_method", "S256"], ["nonce", "no"], ["response_type", "code"], ["scope", "openid email profile"]]) assert.equal(u.searchParams.get(k), v, k);
  const jwt = (claims: object) => "h." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".s";
  const now = 1_800_000_000;
  const good = { iss: "https://accounts.google.com", aud: "cid", exp: now + 60, nonce: "no", sub: "123", email: "Ana@Gmail.com", email_verified: true, name: "Ána Ș." };
  assert.deepEqual(verifiedGoogleUser(decodeJwtPayload(jwt(good)), { clientId: "cid", nonce: "no", nowSeconds: now }), { subject: "123", email: "ana@gmail.com", name: "Ána Ș." });
  const bad: [object, RegExp][] = [
    [{ ...good, aud: "other" }, /GOOGLE_FAILED/],
    [{ ...good, iss: "https://evil.example" }, /GOOGLE_FAILED/],
    [{ ...good, exp: now - 1 }, /GOOGLE_FAILED/],
    [{ ...good, nonce: "replayed" }, /GOOGLE_FAILED/],
    [{ ...good, email_verified: false }, /GOOGLE_EMAIL_UNVERIFIED/],
  ];
  for (const [claims, err] of bad) assert.throws(() => verifiedGoogleUser(decodeJwtPayload(jwt(claims)), { clientId: "cid", nonce: "no", nowSeconds: now }), err);
});
test("Security headers are added without overriding a response's own", async () => {
  // @ts-ignore Node native type stripping
  const { withSecurityHeaders } = await import("../src/modules/shared/security-headers.ts");
  const res = withSecurityHeaders(new Response("x", { headers: { "Content-Security-Policy": "default-src 'none'" } }), true);
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("Content-Security-Policy"), "default-src 'none'");
  assert.equal(res.headers.get("Strict-Transport-Security"), "max-age=15552000");
  assert.equal(withSecurityHeaders(new Response("x"), false).headers.get("Strict-Transport-Security"), null);
  assert.ok(withSecurityHeaders(Response.redirect("https://konyha.veres.no/portal", 302), true).headers.get("X-Frame-Options"));
});
