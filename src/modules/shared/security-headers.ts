/** Biztonsági fejlécek minden válaszra (v30). Amit a válasz már beállított (pl. a képek CSP-je), azt nem írja felül. */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  // Más oldal nem ágyazhatja be (kattintáseltérítés ellen), és űrlap csak a saját oldalra küldhető.
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
};
export function withSecurityHeaders(res: Response, https: boolean) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  // Csak erre a címre, aldomainekre nem (a veres.no többi része nem tartozik ide).
  if (https && !out.headers.has("Strict-Transport-Security")) out.headers.set("Strict-Transport-Security", "max-age=15552000");
  return out;
}
