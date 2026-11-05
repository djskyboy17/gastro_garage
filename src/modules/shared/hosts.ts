/** Aldomainenkénti kezdőoldal (v29): a rendelési, a konyhai és a futár-cím ugyanazt az alkalmazást szolgálja ki. */
export type HostConfig = { portal?: string; kitchen?: string; courier?: string };

/**
 * v81: régi vagy másodlagos cím (pl. www.gastrogarage.ro, gastrogarage.veres.no) → a végleges címre irányít, az útvonal és
 * a lekérdezés megmarad. GET/HEAD: 301 (végleges), más kérés: 308 (a metódus és a törzs megmarad). Nincs találat: null.
 */
export function hostRedirect(url: URL, method: string, redirects: Record<string, string>): { location: string; status: 301 | 308 } | null {
  const target = redirects[url.hostname.toLowerCase()];
  if (!target || target.toLowerCase() === url.hostname.toLowerCase()) return null;
  return { location: `https://${target}${url.pathname}${url.search}`, status: method === "GET" || method === "HEAD" ? 301 : 308 };
}
/** A HOST_REDIRECTS beállítás (JSON: régi cím → új cím) biztonságos beolvasása; hibás érték esetén nincs átirányítás. */
export function parseRedirects(value: string | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(value || "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string" && /^[a-z0-9.-]+$/i.test(e[1])).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
  } catch {
    return {};
  }
}

/** Ha a kérés a rendelési vagy a futár-címre jön és a gyökeret kéri, ide kell továbbirányítani; egyébként null. */
export function startRedirect(host: string, pathname: string, hosts: HostConfig): string | null {
  if (pathname !== "/") return null;
  const name = host.toLowerCase().replace(/:\d+$/, "");
  if (hosts.portal && name === hosts.portal.toLowerCase()) return "/portal";
  if (hosts.courier && name === hosts.courier.toLowerCase()) return "/courier";
  return null;
}
