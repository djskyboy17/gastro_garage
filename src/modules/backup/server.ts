import { env } from "cloudflare:workers";
import type { Session } from "../access/domain";
import { isAdmin } from "../access/domain";

/**
 * Heti biztonsági mentés (v96): a teljes adatbázis SQL-fájlként a privát R2-tárolóba (`backups/`), letölthetően.
 * A fájl visszatölthető (`wrangler d1 execute <db> --remote --file=…`): törli a táblák tartalmát, a triggereket a
 * betöltés idejére eltávolítja, majd visszaállítja. Az utolsó 12 mentés marad meg.
 */
export class BackupError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const KEEP = 12;
const PAGE = 2000;

function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return "X'" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") + "'";
  }
  if (Array.isArray(v)) return sqlValue(new Uint8Array(v as number[]));
  return "'" + String(v).replace(/'/g, "''") + "'";
}
const ident = (name: string) => '"' + name.replace(/"/g, '""') + '"';

/** A teljes adatbázis SQL-szövegként. */
export async function dumpDatabase(): Promise<{ sql: string; tables: number; rows: number }> {
  const DB = env.DB!;
  const objects = (await DB.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY name").all<{ type: string; name: string; sql: string | null }>()).results;
  const tables = objects.filter((o) => o.type === "table");
  const triggers = objects.filter((o) => o.type === "trigger" && o.sql);
  const migration = await DB.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1").first<{ name: string }>().catch(() => null);
  const out: string[] = [
    `-- Gastro-Garage biztonsági mentés · ${new Date().toISOString()} · utolsó migráció: ${migration?.name ?? "?"}`,
    "-- Visszatöltés: wrangler d1 execute <adatbázis> --remote --file=<ez a fájl> (ugyanezen a migráción álló adatbázisba).",
    "PRAGMA defer_foreign_keys = true;",
    ...triggers.map((t) => `DROP TRIGGER IF EXISTS ${ident(t.name)};`),
  ];
  let rows = 0;
  for (const t of tables) {
    out.push(`DELETE FROM ${ident(t.name)};`);
    for (let offset = 0; ; offset += PAGE) {
      const page = (await DB.prepare(`SELECT * FROM ${ident(t.name)} LIMIT ${PAGE} OFFSET ${offset}`).all<Record<string, unknown>>()).results;
      for (const r of page) {
        const cols = Object.keys(r);
        out.push(`INSERT INTO ${ident(t.name)} (${cols.map(ident).join(",")}) VALUES (${cols.map((c) => sqlValue(r[c])).join(",")});`);
      }
      rows += page.length;
      if (page.length < PAGE) break;
    }
  }
  out.push(...triggers.map((t) => t.sql + ";"));
  return { sql: out.join("\n") + "\n", tables: tables.length, rows };
}

/** Mentés készítése az R2-be; a 12-nél régebbiek törlődnek. */
export async function createBackup(actor: string) {
  const r2 = env.ARCHIVE;
  if (!r2) throw new BackupError("ARCHIVE_NOT_CONFIGURED", 503);
  const { sql, tables, rows } = await dumpDatabase();
  const now = new Date().toISOString();
  const key = `backups/${now.slice(0, 4)}/backup-${now.slice(0, 19).replace(/[:T]/g, "-")}.sql`;
  await r2.put(key, sql, { httpMetadata: { contentType: "application/sql; charset=utf-8" }, customMetadata: { tables: String(tables), rows: String(rows), actor } });
  await env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,'backup_created','backup',?,?)").bind(crypto.randomUUID(), actor, JSON.stringify({ key, tables, rows, bytes: sql.length }), now).run();
  const all = await listBackups();
  for (const old of all.slice(KEEP)) await r2.delete(old.key);
  return { key, tables, rows, bytes: sql.length };
}

export async function listBackups() {
  const r2 = env.ARCHIVE;
  if (!r2) return [];
  const items: { key: string; size: number; uploaded: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await r2.list({ prefix: "backups/", cursor });
    items.push(...page.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString() })));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return items.sort((a, b) => b.uploaded.localeCompare(a.uploaded));
}

export async function handleBackups(path: string, session: Session, write: boolean, req: Request): Promise<Response> {
  if (!isAdmin(session.role)) throw new BackupError("FORBIDDEN", 403);
  if (!write && path === "/api/backups") return json({ configured: !!env.ARCHIVE, backups: await listBackups() });
  if (!write && path === "/api/backups/file") {
    const key = new URL(req.url).searchParams.get("key") ?? "";
    if (!/^backups\/\d{4}\/backup-[\d-]+\.sql$/.test(key)) throw new BackupError("VALIDATION");
    const obj = await env.ARCHIVE?.get(key);
    if (!obj) throw new BackupError("NOT_FOUND", 404);
    await env.DB!.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,?,'backup_downloaded','backup',?,?)").bind(crypto.randomUUID(), session.userId, JSON.stringify({ key }), new Date().toISOString()).run();
    return new Response(obj.body, {
      headers: { "Content-Type": "application/sql; charset=utf-8", "Content-Disposition": `attachment; filename="${key.split("/").pop()}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  if (write && path === "/api/backups/run") return json({ ok: true, ...(await createBackup(session.userId)) });
  return json({ error: "NOT_FOUND" }, 404);
}
