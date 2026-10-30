"use client";
import { useEffect, useState, type FormEvent } from "react";
import { messages } from "@/src/modules/shared/i18n";
import { safeReturn, PASSWORD_MIN, PASSWORD_MAX } from "@/src/modules/auth/domain";
import type { Language } from "@/src/modules/shared/domain";

async function post(path: string, body: unknown) {
  const r = await fetch("/api/auth/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(d.error || "saveError");
}

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
      if (mode === "login") await post("login", { email, password });
      else
        await post("register", {
          email,
          password,
          name: String(f.get("name") ?? ""),
          ...(owner ? { setupCode: String(f.get("setupCode") ?? "") } : {}),
        });
      window.location.replace(safeReturn(new URLSearchParams(window.location.search).get("return_to")));
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
      <h1>{t("authTitle")}</h1>
      <p>{t("authIntro")}</p>
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
