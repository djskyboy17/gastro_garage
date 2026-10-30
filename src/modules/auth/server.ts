import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  AuthError,
  DUMMY_HASH,
  FAILURE_WINDOW_MINUTES,
  MAX_FAILURES,
  PASSWORD_MAX,
  PASSWORD_MIN,
  SESSION_COOKIE,
  SESSION_DAYS,
  clearedCookie,
  hashPassword,
  newSessionToken,
  normalizeEmail,
  readCookie,
  sameText,
  sessionCookie,
  tokenDigest,
  validEmail,
  verifyPassword,
} from "./domain.ts";
export { AuthError };

export type AuthUser = { userId: string; email: string; name: string };
const json = (value: unknown, status = 200, cookie?: string) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) } });
const isSecure = (req: Request) => new URL(req.url).protocol === "https:";
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

/**
 * A kérés felhasználója a munkamenet-sütiből. Csak a helyi fejlesztői szerveren (`import.meta.env.DEV`)
 * fogadja el a próbafiókok fejléceit is (Seedy, Teszt Futár); éles buildben ez az ág nem létezik.
 */
export async function currentUser(req: Request): Promise<AuthUser | null> {
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (token && token.length <= 100) {
    const row = await env
      .DB!.prepare("SELECT u.id,u.email,u.name FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?")
      .bind(await tokenDigest(token), new Date().toISOString())
      .first<{ id: string; email: string; name: string }>();
    if (row) return { userId: row.id, email: row.email, name: row.name };
  }
  if (import.meta.env.DEV) {
    const id = req.headers.get("oai-authenticated-user-id"),
      email = req.headers.get("oai-authenticated-user-email");
    if (id && email) {
      let name = email;
      try {
        name = decodeURIComponent(req.headers.get("oai-authenticated-user-full-name") ?? "") || email;
      } catch {}
      return { userId: id, email, name };
    }
  }
  return null;
}

async function startSession(userId: string) {
  const token = newSessionToken(),
    now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  return {
    token,
    statement: env.DB!.prepare("INSERT INTO auth_sessions (id,user_id,created_at,expires_at) VALUES (?,?,?,?)").bind(
      await tokenDigest(token),
      userId,
      now.toISOString(),
      expires.toISOString(),
    ),
  };
}

const credentials = z.object({ email: z.string().max(254), password: z.string().min(1).max(PASSWORD_MAX) }).strict();
const registration = z
  .object({
    email: z.string().max(254),
    password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
    name: z.string().trim().min(1).max(200),
    setupCode: z.string().max(200).optional(),
  })
  .strict();

/** `/api/auth/*`: regisztráció, belépés, kilépés, jelszócsere. Az origin- és JSON-ellenőrzést a hívó végzi. */
export async function handleAuth(path: string, body: unknown, req: Request): Promise<Response> {
  const now = new Date().toISOString(),
    secure = isSecure(req);
  if (path === "/api/auth/register") {
    const d = registration.parse(body),
      email = normalizeEmail(d.email);
    if (!validEmail(email)) throw new AuthError("EMAIL_INVALID");
    const ownerEmail = env.KITCHEN_OWNER_EMAIL ? normalizeEmail(env.KITCHEN_OWNER_EMAIL) : "";
    // A tulajdonos e-mail-címét csak a titkos beállítókóddal lehet lefoglalni.
    if (ownerEmail && email === ownerEmail) {
      const code = env.OWNER_SETUP_CODE ?? "";
      if (!code || !sameText(d.setupCode ?? "", code)) throw new AuthError("OWNER_SETUP_CODE", 403);
    }
    const recent = await env.DB!.prepare("SELECT COUNT(*) AS n FROM auth_users WHERE created_at>?").bind(minutesAgo(60)).first<{ n: number }>();
    if ((recent?.n ?? 0) >= 200) throw new AuthError("REGISTRATION_BUSY", 429);
    const id = crypto.randomUUID(),
      session = await startSession(id);
    try {
      await env.DB!.batch([
        env.DB!.prepare("INSERT INTO auth_users (id,email,name,password_hash,created_at,password_changed_at) VALUES (?,?,?,?,?,?)").bind(
          id,
          email,
          d.name,
          await hashPassword(d.password),
          now,
          now,
        ),
        session.statement,
        env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,'account_created',?,'',?)").bind(crypto.randomUUID(), id, id, now),
      ]);
    } catch (e) {
      if (/UNIQUE|auth_users_email/i.test(String(e))) throw new AuthError("EMAIL_TAKEN", 409);
      throw e;
    }
    return json({ ok: true }, 201, sessionCookie(session.token, secure));
  }
  if (path === "/api/auth/login") {
    const d = credentials.parse(body),
      email = normalizeEmail(d.email);
    const failures = await env.DB!.prepare("SELECT COUNT(*) AS n FROM auth_failures WHERE email=? AND created_at>?")
      .bind(email, minutesAgo(FAILURE_WINDOW_MINUTES))
      .first<{ n: number }>();
    if ((failures?.n ?? 0) >= MAX_FAILURES) throw new AuthError("TOO_MANY_ATTEMPTS", 429);
    const user = await env.DB!.prepare("SELECT id,password_hash FROM auth_users WHERE email=?").bind(email).first<{ id: string; password_hash: string }>();
    const ok = await verifyPassword(d.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
      await env.DB!.batch([
        env.DB!.prepare("DELETE FROM auth_failures WHERE created_at<?").bind(minutesAgo(24 * 60)),
        env.DB!.prepare("INSERT INTO auth_failures (id,email,created_at) VALUES (?,?,?)").bind(crypto.randomUUID(), email, now),
      ]);
      throw new AuthError("INVALID_LOGIN", 401);
    }
    const session = await startSession(user.id);
    await env.DB!.batch([
      env.DB!.prepare("DELETE FROM auth_failures WHERE email=?").bind(email),
      env.DB!.prepare("DELETE FROM auth_sessions WHERE user_id=? AND expires_at<?").bind(user.id, now),
      session.statement,
    ]);
    return json({ ok: true }, 200, sessionCookie(session.token, secure));
  }
  if (path === "/api/auth/logout") {
    const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
    if (token && token.length <= 100) await env.DB!.prepare("DELETE FROM auth_sessions WHERE id=?").bind(await tokenDigest(token)).run();
    return json({ ok: true }, 200, clearedCookie(secure));
  }
  if (path === "/api/auth/password") {
    const user = await currentUser(req);
    if (!user) throw new AuthError("AUTH_REQUIRED", 401);
    const d = z.object({ current: z.string().min(1).max(PASSWORD_MAX), next: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX) }).strict().parse(body);
    const row = await env.DB!.prepare("SELECT password_hash FROM auth_users WHERE id=?").bind(user.userId).first<{ password_hash: string }>();
    if (!row || !(await verifyPassword(d.current, row.password_hash))) throw new AuthError("INVALID_LOGIN", 401);
    const session = await startSession(user.userId);
    // Jelszócsere után minden más eszközről kilépteti a fiókot.
    await env.DB!.batch([
      env.DB!.prepare("UPDATE auth_users SET password_hash=?,password_changed_at=? WHERE id=?").bind(await hashPassword(d.next), now, user.userId),
      env.DB!.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(user.userId),
      session.statement,
      env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,'password_changed',?,'',?)").bind(crypto.randomUUID(), user.userId, user.userId, now),
    ]);
    return json({ ok: true }, 200, sessionCookie(session.token, secure));
  }
  return json({ error: "NOT_FOUND" }, 404);
}
