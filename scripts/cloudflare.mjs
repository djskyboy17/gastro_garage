// Telepítés saját Cloudflare-fiókra (v28). Lépések: setup → migrate → secrets → deploy.
// Előtte egyszer: npx wrangler login (böngészőben jóváhagyod a saját fiókodat).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const configFile = resolve(root, "cloudflare.json");
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const config = existsSync(configFile)
  ? JSON.parse(readFileSync(configFile, "utf8"))
  : { workerName: "konyha", databaseName: "konyha-db", databaseId: "" };

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [wrangler, ...args], { cwd: root, stdio: options.capture ? "pipe" : "inherit", encoding: "utf8" });
  if (options.capture) process.stdout.write(result.stdout ?? "");
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}
function requireDatabase() {
  if (!config.databaseId) {
    console.error("Még nincs adatbázis. Futtasd előbb: npm run cf:setup");
    process.exit(1);
  }
}
/** Ideiglenes wrangler-beállítás a migrációkhoz (a build által generált fájlban nincs migrations_dir). */
function migrationConfig() {
  mkdirSync(resolve(root, ".wrangler"), { recursive: true });
  const file = resolve(root, ".wrangler/cloudflare-migrations.json");
  writeFileSync(
    file,
    JSON.stringify(
      {
        name: config.workerName,
        main: resolve(root, "worker/index.ts"),
        compatibility_date: "2026-05-15",
        d1_databases: [{ binding: "DB", database_name: config.databaseName, database_id: config.databaseId, migrations_dir: resolve(root, "drizzle") }],
      },
      null,
      2,
    ),
  );
  return file;
}

const command = process.argv[2];
if (command === "setup") {
  if (config.databaseId) {
    console.log(`Az adatbázis már megvan: ${config.databaseName} (${config.databaseId}).`);
    process.exit(0);
  }
  const out = run(["d1", "create", config.databaseName], { capture: true });
  const id = /"database_id"\s*:\s*"([0-9a-f-]{36})"/i.exec(out)?.[1] ?? /database_id\s*=\s*"([0-9a-f-]{36})"/i.exec(out)?.[1];
  if (!id) {
    console.error("Nem találtam az adatbázis azonosítóját a kimenetben. Írd be kézzel a cloudflare.json databaseId mezőjébe.");
    process.exit(1);
  }
  writeFileSync(configFile, JSON.stringify({ ...config, databaseId: id }, null, 2) + "\n");
  console.log(`Kész: cloudflare.json frissítve (${config.databaseName}: ${id}). Következő: npm run cf:migrate`);
} else if (command === "migrate") {
  requireDatabase();
  run(["d1", "migrations", "apply", config.databaseName, "--remote", "--config", migrationConfig()]);
} else if (command === "secrets") {
  requireDatabase();
  const file = migrationConfig();
  console.log("A tulajdonos e-mail-címe (ezzel regisztrálsz majd tulajdonosként):");
  run(["secret", "put", "KITCHEN_OWNER_EMAIL", "--config", file]);
  console.log("Titkos tulajdonosi beállítókód (hosszú, véletlen szöveg; a regisztrációnál kell majd):");
  run(["secret", "put", "OWNER_SETUP_CODE", "--config", file]);
} else if (command === "deploy") {
  requireDatabase();
  const build = spawnSync(process.execPath, [resolve(root, "scripts/run-framework.mjs"), "build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
  run(["deploy", "--config", resolve(root, "dist/server/wrangler.json")]);
} else {
  console.log("Használat: node scripts/cloudflare.mjs setup | migrate | secrets | deploy");
  process.exit(command ? 1 : 0);
}
