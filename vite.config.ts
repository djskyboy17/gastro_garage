import { existsSync, readFileSync } from "node:fs";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { configureToolEnvironment } from "./scripts/tool-environment.mjs";
import { sites } from "./scripts/vite/sites-vite-plugin";
import { connectorPreview } from "./scripts/vite/connector-preview-plugin.mjs";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;
// Saját Cloudflare-fiókra telepítés (v28): a worker neve és a D1 azonosítója a cloudflare.json-ból jön.
// Az azonosító nem titok; amíg üres, a helyi helyőrző marad.
const cloudflareDeploy = existsSync("./cloudflare.json")
  ? (JSON.parse(readFileSync("./cloudflare.json", "utf8")) as {
      workerName?: string;
      databaseName?: string;
      databaseId?: string;
      domains?: { portal?: string; kitchen?: string; courier?: string };
      /** v81: régi / másodlagos cím → végleges cím (a Worker átirányít). */
      redirects?: Record<string, string>;
      googleClientId?: string;
    })
  : {};

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

// Fejlesztéskor a helyi adatbázis (helyőrző azonosító) marad; csak az éles build kapja a valódi D1-azonosítót.
const bindingConfig = (build: boolean) => ({
  ...(cloudflareDeploy.workerName ? { name: cloudflareDeploy.workerName } : {}),
  vars: {
    PORTAL_HOST: cloudflareDeploy.domains?.portal ?? "",
    COURIER_HOST: cloudflareDeploy.domains?.courier ?? "",
    HOST_REDIRECTS: JSON.stringify(cloudflareDeploy.redirects ?? {}),
    GOOGLE_CLIENT_ID: cloudflareDeploy.googleClientId ?? "",
  },
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: build ? cloudflareDeploy.databaseName || "site-creator-d1" : "site-creator-d1",
          database_id: (build && cloudflareDeploy.databaseId) || SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: [
    ...(r2 ? [{ binding: r2, bucket_name: "site-creator-r2" }] : []),
    // v82: bizonylat-archívum – privát R2-tároló (helyben a miniflare tárolja).
    { binding: "ARCHIVE", bucket_name: "gastro-garage-archive" },
  ],
  // v82: a hiányzó archívum-tételek pótlása félóránként.
  triggers: { crons: ["*/30 * * * *"] },
});

export default defineConfig(async ({ command }) => {
  configureToolEnvironment(process.cwd());

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    // The local test machine has a constrained memory budget; avoid a second
    // minification pass and compression-size scan during the prototype build.
    build: { minify: false, cssMinify: false, reportCompressedSize: false },
    server: {
      ...(managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : {}),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux }),
      connectorPreview(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          ...bindingConfig(command === "build"),
          // Saját aldomainek csak az éles buildbe kerülnek: a feltöltés létrehozza a DNS-t és a tanúsítványt.
          ...(command === "build" && cloudflareDeploy.domains
            ? {
                // v81: a régi és a www címek is a Workerre mutatnak, hogy át tudjon irányítani.
                routes: [...new Set([...Object.values(cloudflareDeploy.domains), ...Object.keys(cloudflareDeploy.redirects ?? {})])]
                  .filter(Boolean)
                  .map((pattern) => ({ pattern, custom_domain: true })),
              }
            : {}),
          ...(command === "serve"
            ? {
                services: [
                  {
                    binding: "CONNECTORS",
                    service: "sites-connector-preview",
                    entrypoint: "ConnectorPreview",
                  },
                ],
              }
            : {}),
        },
        ...(command === "serve"
          ? {
              auxiliaryWorkers: [
                {
                  config: {
                    name: "sites-connector-preview",
                    main: "./scripts/connector-preview/worker.mjs",
                    compatibility_date: "2026-05-15",
                  },
                },
              ],
            }
          : {}),
      }),
    ],
  };
});
