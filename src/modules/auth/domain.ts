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
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`;
}
export function clearedCookie(secure: boolean) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
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
