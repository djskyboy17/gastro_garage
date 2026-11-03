import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  // Queries pass tables explicitly; do not rebuild unused relational metadata.
  // Keep the adapter request-local, without caching sessions or query results.
  return drizzle(env.DB);
}
