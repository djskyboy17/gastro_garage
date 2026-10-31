/** Saját bejelentkezés (v28): jelszókezelés, munkamenet-azonosító, süti. Tiszta függvények, Workers és Node alatt is futnak. */
export const SESSION_COOKIE = "konyha_session";
export const SESSION_DAYS = 30;
/** A Cloudflare Workers PBKDF2 legfeljebb 100 000 iterációt enged. */
export const PBKDF2_ITERATIONS = 100_000;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
/** Ennyi sikertelen belépés után ennyi percig nem lehet próbálkozni ugyanazzal az e-maillel. */
export const MAX_FAILURES = 8;
export const FAILURE_WINDOW_MINUTES = 15;

export class AuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const enc = new TextEncoder();
const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}
export function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
export function validPassword(value: string) {
  return value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}
/** Tárolható alak: `pbkdf2$<iterációk>$<só base64>$<kivonat base64>`. */
export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iterations}$${toB64(salt)}$${toB64(await derive(password, salt, iterations))}`;
}
/** Állandó idejű összehasonlítás, hogy a válaszidő ne áruljon el részleteket. */
export function sameBytes(a: Uint8Array, b: Uint8Array) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
export async function verifyPassword(password: string, stored: string) {
  const [kind, rounds, salt, hash] = stored.split("$");
  const iterations = Number(rounds);
  if (kind !== "pbkdf2" || !salt || !hash || !Number.isSafeInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;
  return sameBytes(await derive(password, fromB64(salt), iterations), fromB64(hash));
}
/** Ismeretlen e-mailnél is ugyanannyi ideig számolunk, hogy ne derüljön ki, létezik-e a fiók. */
export const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

/** Véletlen munkamenet-azonosító a sütibe; az adatbázisba csak a SHA-256 lenyomata kerül. */
export function newSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function tokenDigest(token: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(token))));
}
export function readCookie(header: string | null, name: string) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}
export function sessionCookie(token: string, secure: boolean) {
  // Az Expires az Internet Explorer 11 miatt kell (a Max-Age-et nem ismeri, nélküle bezáráskor elveszne a süti).
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toUTCString();
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}; Expires=${expires}${secure ? "; Secure" : ""}`;
}
export function clearedCookie(secure: boolean) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}`;
}
/** Csak a saját oldalra lehet visszairányítani (nyílt átirányítás ellen). */
export function safeReturn(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  try {
    const url = new URL(value, "https://app.local");
    return url.origin === "https://app.local" ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}
/** Állandó idejű szövegösszehasonlítás (tulajdonosi beállítókód). */
export function sameText(a: string, b: string) {
  return sameBytes(enc.encode(a), enc.encode(b));
}

// ---- v30: erősebb jelszó, ideiglenes jelszó, Google-belépés ----

/** Címenként ennyi sikertelen belépés után zárol (több e-mail próbálgatása ellen). */
export const MAX_IP_FAILURES = 30;
const COMMON = new Set([
  "1234567890", "0123456789", "12345678910", "qwertyuiop", "asdfghjkl1", "password12", "password123", "jelszo1234", "jelszo12345",
  "parola1234", "parola12345", "iloveyou12", "abcdefghij", "1q2w3e4r5t", "qwerty1234", "admin12345", "konyha1234", "catering12",
  "1111111111", "aaaaaaaaaa", "q1w2e3r4t5", "zaq12wsxcde", "welcome123",
]);
/** Túl könnyen kitalálható jelszó: gyakori jelszó, egyetlen ismétlődő karakter, csak számsor, vagy benne az e-mail neve. */
export function weakPassword(password: string, email = "") {
  const p = password.toLowerCase();
  if (COMMON.has(p)) return true;
  if (/^(.)\1+$/.test(p)) return true;
  if (/^\d+$/.test(p) && p.length < 14) return true;
  const local = normalizeEmail(email).split("@")[0] ?? "";
  if (local.length >= 4 && p.includes(local)) return true;
  return new Set(p).size < 4;
}
/** Ideiglenes jelszó, amit az admin átad: jól olvasható, összetéveszthető betűk nélkül (xxxx-xxxx-xxxx). */
export function temporaryPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join("")).join("-");
}
export const toBase64Url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function randomToken(size = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}
/** PKCE: a kódcsere csak azzal a böngészővel működik, amelyik a belépést elindította. */
export async function pkceChallenge(verifier: string) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
}
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export function googleAuthUrl(o: { clientId: string; redirectUri: string; state: string; challenge: string; nonce: string }) {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: o.state,
    nonce: o.nonce,
    code_challenge: o.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return GOOGLE_AUTH_URL + "?" + q.toString();
}
export type GoogleClaims = { iss?: string; aud?: string; exp?: number; nonce?: string; sub?: string; email?: string; email_verified?: boolean | string; name?: string };
export function decodeJwtPayload(jwt: string): GoogleClaims {
  const part = jwt.split(".")[1];
  if (!part) throw new AuthError("GOOGLE_FAILED");
  const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0)))) as GoogleClaims;
}
/**
 * A Google tokenvégpontjától közvetlenül (TLS-en) kapott ID-token adatainak ellenőrzése (OIDC Core 3.1.3.7):
 * kibocsátó, címzett, lejárat, nonce, és csak megerősített e-mail-cím fogadható el.
 */
export function verifiedGoogleUser(claims: GoogleClaims, o: { clientId: string; nonce: string; nowSeconds: number }) {
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") throw new AuthError("GOOGLE_FAILED");
  if (claims.aud !== o.clientId) throw new AuthError("GOOGLE_FAILED");
  if (!claims.exp || claims.exp < o.nowSeconds) throw new AuthError("GOOGLE_FAILED");
  if (!claims.nonce || !sameText(claims.nonce, o.nonce)) throw new AuthError("GOOGLE_FAILED");
  if (!claims.sub || !claims.email) throw new AuthError("GOOGLE_FAILED");
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new AuthError("GOOGLE_EMAIL_UNVERIFIED");
  const email = normalizeEmail(claims.email);
  return { subject: claims.sub, email, name: (claims.name ?? "").trim().slice(0, 200) || email };
}

/** Csak a tulajdonos és az admin adhat ideiglenes jelszót; a tulajdonosnak és saját magának nem. */
export type ResetPolicy = { actorId: string; actorRole: string; ownerId: string | null };
export function canResetPassword(policy: ResetPolicy, targetId: string) {
  return ["owner", "admin"].includes(policy.actorRole) && targetId !== policy.actorId && targetId !== policy.ownerId;
}
