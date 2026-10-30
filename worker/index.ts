import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { startRedirect } from "../src/modules/shared/hosts";
import { withSecurityHeaders } from "../src/modules/shared/security-headers";

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    // gastrogarage.… → ügyfélrendelés, courier.… → futár; a többi cím a konyhai munkatér.
    const url = new URL(request.url);
    const target = startRedirect(url.host, url.pathname, { portal: env.PORTAL_HOST, courier: env.COURIER_HOST });
    if (target) return withSecurityHeaders(Response.redirect(new URL(target, url).toString(), 302), url.protocol === "https:");
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return Promise.resolve(runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx))).then((res: Response) =>
      withSecurityHeaders(res, url.protocol === "https:"),
    );
  },
};

export default worker;
