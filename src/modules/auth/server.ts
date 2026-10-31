import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  AuthError,
  DUMMY_HASH,
  canResetPassword,
  FAILURE_WINDOW_MINUTES,
  GOOGLE_TOKEN_URL,
  MAX_FAILURES,
  MAX_IP_FAILURES,
  PASSWORD_MAX,
  PASSWORD_MIN,
  SESSION_COOKIE,
  SESSION_DAYS,
  clearedCookie,
  decodeJwtPayload,
  googleAuthUrl,
  hashPassword,
  newSessionToken,
  normalizeEmail,
  pkceChallenge,
  randomToken,
  readCookie,
  safeReturn,
  sameText,
  sessionCookie,
  temporaryPassword,
  tokenDigest,
  validEmail,
  verifiedGoogleUser,
  verifyPassword,
  weakPassword,
} from "./domain.ts";
export { AuthError };

export type AuthUser = { userId: string; email: string; name: string; mustChangePassword?: boolean };
const OAUTH_COOKIE = "konyha_oauth";
const json = (value: unknown, status = 200, cookies: string[] = []) => {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return Response.json(value, { status, headers });
};
const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
};
const isSecure = (req: Request) => new URL(req.url).protocol === "https:";
const clientIp = (req: Request) => (req.headers.get("cf-connecting-ip") ?? "").slice(0, 64);
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const audit = (actor: string, action: string, entity: string, detail: string, now: string) =>
  env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), actor, action, entity, detail, now);

/**
 * A kérés felhasználója a munkamenet-sütiből. Csak a helyi fejlesztői szerveren (`import.meta.env.DEV`)
 * fogadja el a próbafiókok fejléceit is (Seedy, Teszt Futár); éles buildben ez az ág nem létezik.
 */
export async function currentUser(req: Request): Promise<AuthUser | null> {
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (token && token.length <= 100) {
    const row = await env
      .DB!.prepare(
        "SELECT u.id,u.email,u.name,u.must_change_password AS must FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?",
      )
      .bind(await tokenDigest(token), new Date().toISOString())
      .first<{ id: string; email: string; name: string; must: number }>();
    if (row) return { userId: row.id, email: row.email, name: row.name, mustChangePassword: row.must === 1 };
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


/**
 * `/api/auth/*`: regisztráció, belépés (jelszóval vagy Google-lel), kilépés, jelszócsere, ideiglenes jelszó.
 * POST csak azonos eredetű JSON lehet (a hívó ellenőrzi); GET csak a Google-folyamathoz és a szolgáltatók listájához.
 */
export async function handleAuth(
  path: string,
  body: unknown,
  req: Request,
  write: boolean,
  roleOf: (user: AuthUser) => Promise<{ role: string; ownerId: string | null }>,
): Promise<Response> {
  const now = new Date().toISOString(),
    secure = isSecure(req),
    url = new URL(req.url);
  if (!write) {
    if (path === "/api/auth/providers") return json({ google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) });
    if (path === "/api/auth/google/start") return googleStart(req, url, now, secure);
    if (path === "/api/auth/google/callback") return googleCallback(req, url, now, secure);
    return json({ error: "NOT_FOUND" }, 404);
  }
  if (path === "/api/auth/register") {
    const d = registration.parse(body),
      email = normalizeEmail(d.email);
    if (!validEmail(email)) throw new AuthError("EMAIL_INVALID");
    if (weakPassword(d.password, email)) throw new AuthError("PASSWORD_WEAK");
    const ownerEmail = env.KITCHEN_OWNER_EMAIL ? normalizeEmail(env.KITCHEN_OWNER_EMAIL) : "";
    // A tulajdonos e-mail-címét jelszavas regisztrációval csak a titkos beállítókóddal lehet lefoglalni.
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
        audit(id, "account_created", id, "password", now),
      ]);
    } catch (e) {
      if (/UNIQUE|auth_users_email/i.test(String(e))) throw new AuthError("EMAIL_TAKEN", 409);
      throw e;
    }
    return json({ ok: true }, 201, [sessionCookie(session.token, secure)]);
  }
  if (path === "/api/auth/login") {
    const d = credentials.parse(body);
    const login = await passwordLogin(d.email, d.password, req);
    return json({ ok: true, mustChangePassword: login.mustChangePassword }, 200, [sessionCookie(login.token, secure)]);
  }
  if (path === "/api/auth/logout") {
    const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
    if (token && token.length <= 100) await env.DB!.prepare("DELETE FROM auth_sessions WHERE id=?").bind(await tokenDigest(token)).run();
    return json({ ok: true }, 200, [clearedCookie(secure)]);
  }
  if (path === "/api/auth/password") {
    const user = await currentUser(req);
    if (!user) throw new AuthError("AUTH_REQUIRED", 401);
    const d = z.object({ current: z.string().max(PASSWORD_MAX).default(""), next: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX) }).strict().parse(body);
    const row = await env.DB!.prepare("SELECT password_hash FROM auth_users WHERE id=?").bind(user.userId).first<{ password_hash: string }>();
    if (!row) throw new AuthError("AUTH_REQUIRED", 401);
    // Csak Google-lel belépő fiók első jelszavához nem kell a régi jelszó.
    if (row.password_hash && !(await verifyPassword(d.current, row.password_hash))) throw new AuthError("INVALID_LOGIN", 401);
    if (weakPassword(d.next, user.email)) throw new AuthError("PASSWORD_WEAK");
    if (row.password_hash && (await verifyPassword(d.next, row.password_hash))) throw new AuthError("PASSWORD_SAME");
    const session = await startSession(user.userId);
    // Jelszócsere után minden más eszközről kilépteti a fiókot.
    await env.DB!.batch([
      env.DB!.prepare("UPDATE auth_users SET password_hash=?,password_changed_at=?,must_change_password=0 WHERE id=?").bind(await hashPassword(d.next), now, user.userId),
      env.DB!.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(user.userId),
      session.statement,
      audit(user.userId, "password_changed", user.userId, "", now),
    ]);
    return json({ ok: true }, 200, [sessionCookie(session.token, secure)]);
  }
  if (path === "/api/auth/admin-reset") {
    const actor = await currentUser(req);
    if (!actor) throw new AuthError("AUTH_REQUIRED", 401);
    const d = z.object({ userId: z.string().min(1).max(200) }).strict().parse(body);
    const { role, ownerId } = await roleOf(actor);
    if (!canResetPassword({ actorId: actor.userId, actorRole: role, ownerId }, d.userId)) throw new AuthError("FORBIDDEN", 403);
    const target = await env.DB!.prepare("SELECT id FROM auth_users WHERE id=?").bind(d.userId).first<{ id: string }>();
    if (!target) throw new AuthError("NOT_FOUND", 404);
    const password = temporaryPassword();
    await env.DB!.batch([
      env.DB!.prepare("UPDATE auth_users SET password_hash=?,password_changed_at=?,must_change_password=1 WHERE id=?").bind(await hashPassword(password), now, d.userId),
      env.DB!.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(d.userId),
      env.DB!.prepare("DELETE FROM auth_failures WHERE email=(SELECT email FROM auth_users WHERE id=?)").bind(d.userId),
      audit(actor.userId, "password_reset", d.userId, "temporary", now),
    ]);
    // Az ideiglenes jelszó csak ebben a válaszban látszik; az adatbázisba csak a kivonata kerül.
    return json({ ok: true, password });
  }
  return json({ error: "NOT_FOUND" }, 404);
}

/**
 * Jelszavas belépés, a korlátozással és a naplóval együtt. A JSON-os `/api/auth/login` és a konyhai kijelző
 * űrlapos belépése (`/kijelzo`) is ezt használja, így a kettő ugyanazokat a szabályokat követi.
 */
export async function passwordLogin(rawEmail: string, password: string, req: Request) {
  const email = normalizeEmail(rawEmail.slice(0, 254)),
    ip = clientIp(req),
    now = new Date().toISOString();
  if (!password || password.length > PASSWORD_MAX) throw new AuthError("INVALID_LOGIN", 401);
  const failures = await env.DB!.prepare(
    "SELECT (SELECT COUNT(*) FROM auth_failures WHERE email=? AND created_at>?) AS byEmail, (SELECT COUNT(*) FROM auth_failures WHERE ip<>'' AND ip=? AND created_at>?) AS byIp",
  )
    .bind(email, minutesAgo(FAILURE_WINDOW_MINUTES), ip, minutesAgo(FAILURE_WINDOW_MINUTES))
    .first<{ byEmail: number; byIp: number }>();
  if ((failures?.byEmail ?? 0) >= MAX_FAILURES || (failures?.byIp ?? 0) >= MAX_IP_FAILURES) throw new AuthError("TOO_MANY_ATTEMPTS", 429);
  const user = await env.DB!.prepare("SELECT id,password_hash,must_change_password AS must FROM auth_users WHERE email=?")
    .bind(email)
    .first<{ id: string; password_hash: string; must: number }>();
  // Csak Google-lel belépő fióknál nincs jelszó: ugyanúgy elutasítjuk, mint a rossz jelszót.
  const ok = await verifyPassword(password, user?.password_hash || DUMMY_HASH);
  if (!user || !user.password_hash || !ok) {
    await env.DB!.batch([
      env.DB!.prepare("DELETE FROM auth_failures WHERE created_at<?").bind(minutesAgo(24 * 60)),
      env.DB!.prepare("INSERT INTO auth_failures (id,email,ip,created_at) VALUES (?,?,?,?)").bind(crypto.randomUUID(), email, ip, now),
    ]);
    throw new AuthError("INVALID_LOGIN", 401);
  }
  const session = await startSession(user.id);
  await env.DB!.batch([
    env.DB!.prepare("DELETE FROM auth_failures WHERE email=?").bind(email),
    env.DB!.prepare("DELETE FROM auth_sessions WHERE user_id=? AND expires_at<?").bind(user.id, now),
    session.statement,
    audit(user.id, "login", user.id, "password", now),
  ]);
  return { token: session.token, userId: user.id, mustChangePassword: user.must === 1 };
}

/** Kilépés: a munkamenet törlése az adatbázisból és a süti törlése. */
export async function endSession(req: Request) {
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (token && token.length <= 100) await env.DB!.prepare("DELETE FROM auth_sessions WHERE id=?").bind(await tokenDigest(token)).run();
  return clearedCookie(isSecure(req));
}

/**
 * Folyamatosan használt eszköz (konyhai kijelző) munkamenetének megújítása: ha a süti 20 napon belül lejárna,
 * új munkamenet indul (újabb 30 nap), a régi törlődik. Érvénytelen sütinél nem csinál semmit.
 */
export async function renewSession(req: Request): Promise<string | null> {
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const digest = await tokenDigest(token);
  const row = await env.DB!.prepare("SELECT user_id,expires_at FROM auth_sessions WHERE id=? AND expires_at>?")
    .bind(digest, new Date().toISOString())
    .first<{ user_id: string; expires_at: string }>();
  if (!row || row.expires_at > new Date(Date.now() + 20 * 86400_000).toISOString()) return null;
  const session = await startSession(row.user_id);
  await env.DB!.batch([session.statement, env.DB!.prepare("DELETE FROM auth_sessions WHERE id=?").bind(digest)]);
  return sessionCookie(session.token, isSecure(req));
}

function signinError(code: string, returnTo: string) {
  return "/signin?error=" + encodeURIComponent(code) + "&return_to=" + encodeURIComponent(returnTo);
}
const oauthCookie = (state: string, secure: boolean) =>
  `${OAUTH_COOKIE}=${state}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`;
const clearOauthCookie = (secure: boolean) => `${OAUTH_COOKIE}=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

async function googleStart(req: Request, url: URL, now: string, secure: boolean) {
  const returnTo = safeReturn(url.searchParams.get("return_to"));
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return redirect(signinError("GOOGLE_DISABLED", returnTo));
  const state = randomToken(),
    verifier = randomToken(48),
    nonce = randomToken();
  await env.DB!.batch([
    env.DB!.prepare("DELETE FROM oauth_states WHERE created_at<?").bind(minutesAgo(10)),
    env.DB!.prepare("INSERT INTO oauth_states (id,verifier,nonce,return_to,created_at) VALUES (?,?,?,?,?)").bind(await tokenDigest(state), verifier, nonce, returnTo, now),
  ]);
  const target = googleAuthUrl({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri: url.origin + "/api/auth/google/callback",
    state,
    challenge: await pkceChallenge(verifier),
    nonce,
  });
  return redirect(target, [oauthCookie(state, secure)]);
}

async function googleCallback(req: Request, url: URL, now: string, secure: boolean) {
  const state = url.searchParams.get("state") ?? "",
    code = url.searchParams.get("code") ?? "";
  const cookieState = readCookie(req.headers.get("cookie"), OAUTH_COOKIE) ?? "";
  const clear = clearOauthCookie(secure);
  // Az állapotnak a sütiben és a címben is egyeznie kell: így más nem tudja ráerőltetni a saját belépését a böngészőre.
  if (!state || state.length > 100 || !cookieState || !sameText(state, cookieState)) return redirect(signinError("GOOGLE_FAILED", "/"), [clear]);
  const pending = await env.DB!.prepare("DELETE FROM oauth_states WHERE id=? RETURNING verifier,nonce,return_to,created_at")
    .bind(await tokenDigest(state))
    .first<{ verifier: string; nonce: string; return_to: string; created_at: string }>();
  if (!pending || pending.created_at < minutesAgo(10)) return redirect(signinError("GOOGLE_FAILED", "/"), [clear]);
  const returnTo = safeReturn(pending.return_to);
  if (url.searchParams.get("error") || !code) return redirect(signinError("GOOGLE_CANCELLED", returnTo), [clear]);
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: url.origin + "/api/auth/google/callback",
        grant_type: "authorization_code",
        code_verifier: pending.verifier,
      }),
    });
    const tokens = (await res.json()) as { id_token?: string };
    if (!res.ok || !tokens.id_token) throw new AuthError("GOOGLE_FAILED");
    const google = verifiedGoogleUser(decodeJwtPayload(tokens.id_token), {
      clientId: env.GOOGLE_CLIENT_ID!,
      nonce: pending.nonce,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    const identityId = "google:" + google.subject;
    const linked = await env.DB!.prepare("SELECT user_id FROM auth_identities WHERE id=?").bind(identityId).first<{ user_id: string }>();
    let userId = linked?.user_id ?? null;
    const statements: D1PreparedStatement[] = [];
    if (!userId) {
      // A Google által megerősített e-mail-cím egy meglévő fiókhoz köthető; ha nincs ilyen, új fiók jön létre jelszó nélkül.
      const existing = await env.DB!.prepare("SELECT id FROM auth_users WHERE email=?").bind(google.email).first<{ id: string }>();
      userId = existing?.id ?? crypto.randomUUID();
      if (!existing) {
        statements.push(
          env.DB!.prepare("INSERT INTO auth_users (id,email,name,password_hash,created_at,password_changed_at) VALUES (?,?,?,'',?,?)").bind(userId, google.email, google.name, now, now),
          audit(userId, "account_created", userId, "google", now),
        );
      }
      statements.push(
        env.DB!.prepare("INSERT INTO auth_identities (id,provider,subject,user_id,email,created_at) VALUES (?,'google',?,?,?,?)").bind(identityId, google.subject, userId, google.email, now),
      );
    }
    const session = await startSession(userId);
    statements.push(session.statement, audit(userId, "login", userId, "google", now));
    await env.DB!.batch(statements);
    return redirect(returnTo, [clear, sessionCookie(session.token, secure)]);
  } catch (e) {
    const code = e instanceof AuthError ? e.code : "GOOGLE_FAILED";
    return redirect(signinError(code, returnTo), [clear]);
  }
}
