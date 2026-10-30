"use client";
import { useEffect, useState, type FormEvent } from "react";
import { messages } from "@/src/modules/shared/i18n";
import { safeReturn, PASSWORD_MIN, PASSWORD_MAX } from "@/src/modules/auth/domain";
import type { Language } from "@/src/modules/shared/domain";

async function post(path: string, body: unknown) {
  const r = await fetch("/api/auth/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = (await r.json().catch(() => ({}))) as { error?: string; mustChangePassword?: boolean; password?: string };
  if (!r.ok) throw new Error(d.error || "saveError");
  return d;
}
const returnParam = () => safeReturn(new URLSearchParams(window.location.search).get("return_to"));

function useLanguage() {
  const [lang, setLang] = useState<Language>("hu");
  useEffect(() => {
    try {
      const l = localStorage.getItem("konyha-language");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a mentett nyelv csak a böngészőben olvasható
      if (l === "hu" || l === "ro") setLang(l);
    } catch {}
  }, []);
  function choose(l: Language) {
    setLang(l);
    try {
      localStorage.setItem("konyha-language", l);
    } catch {}
  }
  return [lang, choose] as const;
}

/** Belépés és regisztráció saját fiókkal (v28). */
export function SignInPage() {
  const [lang, setLang] = useLanguage();
  const t = (k: string) => messages[lang][k] ?? k;
  const [mode, setMode] = useState<"login" | "register">("login");
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [google, setGoogle] = useState(false);
  useEffect(() => {
    // A Google-belépés hibakódja a címben jön vissza.
    const code = new URLSearchParams(window.location.search).get("error");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a cím csak a böngészőben olvasható
    if (code && /^[A-Z_]{3,40}$/.test(code)) setError(code);
    void fetch("/api/auth/providers", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ google?: boolean }>)
      .then((d) => setGoogle(Boolean(d.google)))
      .catch(() => {});
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? ""),
      password = String(f.get("password") ?? "");
    if (mode === "register" && password !== String(f.get("repeat") ?? "")) {
      setError("authPasswordMismatch");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result =
        mode === "login"
          ? await post("login", { email, password })
          : await post("register", {
              email,
              password,
              name: String(f.get("name") ?? ""),
              ...(owner ? { setupCode: String(f.get("setupCode") ?? "") } : {}),
            });
      // Ideiglenes jelszóval belépve előbb új jelszót kell adni.
      window.location.replace(result.mustChangePassword ? "/password?forced=1&return_to=" + encodeURIComponent(returnParam()) : returnParam());
    } catch (err) {
      setError(err instanceof Error ? err.message : "saveError");
      setBusy(false);
    }
  }
  const dev = process.env.NODE_ENV === "development";
  return (
    <main className="panel access-gate auth-page">
      <div className="language-switch" aria-label={t("language")}>
        {(["hu", "ro"] as const).map((l) => (
          <button key={l} type="button" className={lang === l ? "selected" : ""} onClick={() => setLang(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <img className="auth-logo" src="/logo.png" alt="Gastro-Garage" width={170} height={170} />
      <h1>{t("authTitle")}</h1>
      <p>{t("authIntro")}</p>
      {google && (
        <>
          <a className="button secondary auth-google" href={"/api/auth/google/start?return_to=" + encodeURIComponent(typeof window === "undefined" ? "/" : returnParam())}>
            <GoogleMark />
            {t("authGoogle")}
          </a>
          <p className="auth-or">{t("authOr")}</p>
        </>
      )}
      <div className="auth-tabs" role="tablist">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? "selected" : ""}
            onClick={() => {
              setMode(m);
              setError("");
            }}
          >
            {t(m === "login" ? "authLogin" : "authRegister")}
          </button>
        ))}
      </div>
      <form className="auth-form" onSubmit={submit}>
        {mode === "register" && (
          <label className="field">
            <span>{t("authName")}</span>
            <input name="name" required maxLength={200} autoComplete="name" />
          </label>
        )}
        <label className="field">
          <span>{t("authEmail")}</span>
          <input name="email" type="email" required maxLength={254} autoComplete="email" />
        </label>
        <label className="field">
          <span>{t("authPassword")}</span>
          <input
            name="password"
            type="password"
            required
            minLength={mode === "register" ? PASSWORD_MIN : 1}
            maxLength={PASSWORD_MAX}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          {mode === "register" && <small>{t("authPasswordHint")}</small>}
        </label>
        {mode === "register" && (
          <>
            <label className="field">
              <span>{t("authPasswordRepeat")}</span>
              <input name="repeat" type="password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoComplete="new-password" />
            </label>
            <label className="auth-owner">
              <input type="checkbox" checked={owner} onChange={(e) => setOwner(e.target.checked)} />
              {t("authOwnerToggle")}
            </label>
            {owner && (
              <label className="field">
                <span>{t("authSetupCode")}</span>
                <input name="setupCode" type="password" required maxLength={200} autoComplete="off" />
                <small>{t("authSetupCodeHint")}</small>
              </label>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="error-banner">
            {t(error)}
          </p>
        )}
        <button className="button" disabled={busy}>
          {t(busy ? "authWorking" : mode === "login" ? "authSubmitLogin" : "authSubmitRegister")}
        </button>
      </form>
      {dev && (
        <p className="auth-dev">
          {t("authDevAccounts")} <a href="/signin-with-chatgpt?return_to=/">Seedy</a> ·{" "}
          <a href="/signin-with-chatgpt?as=courier&return_to=/courier">Teszt Futár</a>
        </p>
      )}
      <a href="/portal">{t("portalOpen")}</a>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.2-3.9 7.2-9.6 7.2-16.9z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.2-8.8 2.2-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** Jelszó módosítása; ideiglenes jelszó után kötelező (v30). */
export function PasswordPage() {
  const [lang, setLang] = useLanguage();
  const t = (k: string) => messages[lang][k] ?? k;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [forced, setForced] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a cím csak a böngészőben olvasható
    setForced(new URLSearchParams(window.location.search).get("forced") === "1");
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const next = String(f.get("next") ?? "");
    if (next !== String(f.get("repeat") ?? "")) {
      setError("authPasswordMismatch");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await post("password", { current: String(f.get("current") ?? ""), next });
      setDone(true);
      window.setTimeout(() => window.location.replace(returnParam()), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "saveError");
      setBusy(false);
    }
  }
  return (
    <main className="panel access-gate auth-page">
      <div className="language-switch" aria-label={t("language")}>
        {(["hu", "ro"] as const).map((l) => (
          <button key={l} type="button" className={lang === l ? "selected" : ""} onClick={() => setLang(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <img className="auth-logo" src="/logo.png" alt="Gastro-Garage" width={170} height={170} />
      <h1>{t("passwordTitle")}</h1>
      <p>{t(forced ? "passwordForced" : "passwordIntro")}</p>
      {done ? (
        <p role="status" className="ops-success">
          {t("passwordSaved")}
        </p>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>{t(forced ? "passwordTemporary" : "passwordCurrent")}</span>
            <input name="current" type="password" maxLength={PASSWORD_MAX} autoComplete="current-password" />
            {!forced && <small>{t("passwordCurrentHint")}</small>}
          </label>
          <label className="field">
            <span>{t("passwordNew")}</span>
            <input name="next" type="password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoComplete="new-password" />
            <small>{t("authPasswordHint")}</small>
          </label>
          <label className="field">
            <span>{t("authPasswordRepeat")}</span>
            <input name="repeat" type="password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoComplete="new-password" />
          </label>
          {error && (
            <p role="alert" className="error-banner">
              {t(error)}
            </p>
          )}
          <button className="button" disabled={busy}>
            {t(busy ? "authWorking" : "passwordSave")}
          </button>
        </form>
      )}
      {!forced && <a href={typeof window === "undefined" ? "/" : returnParam()}>{t("authBack")}</a>}
      {forced && <a href="/signout">{t("signOut")}</a>}
    </main>
  );
}

/** Ideiglenes jelszó adása egy fióknak (tulajdonos, admin). A jelszó csak egyszer, itt látszik. */
export function TemporaryPasswordButton({ userId, name, lang, disabled }: { userId: string; name: string; lang: Language; disabled?: boolean }) {
  const t = (k: string) => messages[lang][k] ?? k;
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function reset() {
    if (!window.confirm(t("tempPasswordConfirm").replace("{name}", name))) return;
    setBusy(true);
    setError("");
    try {
      const d = await post("admin-reset", { userId });
      setPassword(d.password ?? "");
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "saveError");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="temp-password">
      <button type="button" className="button secondary" disabled={disabled || busy} onClick={() => void reset()}>
        {t("tempPasswordButton")}
      </button>
      {error && <small role="alert">{t(error)}</small>}
      {password && (
        <div className="temp-password-box" role="status">
          <strong>{password}</strong>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              void navigator.clipboard?.writeText(password).then(() => setCopied(true));
            }}
          >
            {t(copied ? "tempPasswordCopied" : "tempPasswordCopy")}
          </button>
          <small>{t("tempPasswordHint")}</small>
        </div>
      )}
    </div>
  );
}

/** Kilépés: törli a munkamenetet, majd visszavisz. */
export function SignOutPage() {
  const [lang] = useLanguage();
  useEffect(() => {
    const target = safeReturn(new URLSearchParams(window.location.search).get("return_to"));
    void (async () => {
      try {
        await post("logout", {});
      } catch {}
      // A helyi próbafiókok sütijét is törölni kell (csak fejlesztéskor van ilyen).
      if (process.env.NODE_ENV === "development") window.location.replace("/signout-with-chatgpt?return_to=" + encodeURIComponent(target));
      else window.location.replace(target);
    })();
  }, []);
  return (
    <main className="panel access-gate">
      <p role="status">{messages[lang].authSignOutWorking}</p>
    </main>
  );
}
