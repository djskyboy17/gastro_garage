/** Aldomainenkénti kezdőoldal (v29): a rendelési, a konyhai és a futár-cím ugyanazt az alkalmazást szolgálja ki. */
export type HostConfig = { portal?: string; kitchen?: string; courier?: string };

/** Ha a kérés a rendelési vagy a futár-címre jön és a gyökeret kéri, ide kell továbbirányítani; egyébként null. */
export function startRedirect(host: string, pathname: string, hosts: HostConfig): string | null {
  if (pathname !== "/") return null;
  const name = host.toLowerCase().replace(/:\d+$/, "");
  if (hosts.portal && name === hosts.portal.toLowerCase()) return "/portal";
  if (hosts.courier && name === hosts.courier.toLowerCase()) return "/courier";
  return null;
}
