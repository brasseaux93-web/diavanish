/*
 * Apply versioned SQL in migrations/ with drizzle-orm's migrator.
 * Safe to run more than once. Databases created with `drizzle-kit push`
 * (no __drizzle_migrations journal) are recognised by their tables and
 * columns, journaled, and then only newer files run.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

type Journal = { entries: { tag: string; when: number }[] };

export function findMigrationsFolder(explicit?: string): string {
  if (explicit) {
    if (!fs.existsSync(path.join(explicit, "meta/_journal.json"))) {
      throw new Error(`No migrations journal in ${explicit}`);
    }
    return explicit;
  }
  // Avoid import.meta.url: the production bundle is CommonJS, where it is empty.
  const script = process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : "";
  const candidates = [
    script && path.resolve(script, "../migrations"),
    script && path.resolve(script, "migrations"),
    path.resolve(process.cwd(), "migrations"),
  ].filter((p): p is string => !!p);
  const found = candidates.find((p) => fs.existsSync(path.join(p, "meta/_journal.json")));
  if (!found) throw new Error(`Cannot find migrations/ (looked in ${candidates.join(", ")})`);
  return found;
}

function tableExists(sqlite: Database.Database, name: string): boolean {
  return !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function columnExists(sqlite: Database.Database, table: string, column: string): boolean {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
}

/** Which of the known shipped migrations this database has already absorbed. */
export function detectedAppliedTags(sqlite: Database.Database): string[] {
  if (!tableExists(sqlite, "admins") && !tableExists(sqlite, "rooms")) return [];
  const tags = ["0000_baseline"];
  if (tableExists(sqlite, "rooms") && columnExists(sqlite, "rooms", "seal_threshold")) {
    tags.push("0001_ledger_v2");
  }
  if (tableExists(sqlite, "rooms") && columnExists(sqlite, "rooms", "purged_at")) {
    tags.push("0002_purged_at");
  }
  if (tableExists(sqlite, "passkeys")) {
    tags.push("0003_passkeys");
  }
  return tags;
}

function readJournal(folder: string): Journal {
  return JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8"));
}

function sqlHash(folder: string, tag: string): string {
  return createHash("sha256").update(fs.readFileSync(path.join(folder, `${tag}.sql`))).digest("hex");
}

function journalExisting(sqlite: Database.Database, folder: string, tags: string[]) {
  // Same shape the drizzle migrator creates, so a later migrate() is a no-op
  // for these rows (it compares created_at / folderMillis).
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);
  const insert = sqlite.prepare(
    `INSERT INTO "__drizzle_migrations" (hash, created_at)
     SELECT ?, ? WHERE NOT EXISTS (
       SELECT 1 FROM "__drizzle_migrations" WHERE created_at = ?
     )`,
  );
  for (const entry of readJournal(folder).entries) {
    if (!tags.includes(entry.tag)) continue;
    const hash = sqlHash(folder, entry.tag);
    insert.run(hash, entry.when, entry.when);
  }
}

export function applyMigrations(dbPath: string, migrationsFolder?: string): { folder: string; applied: string[] } {
  const folder = findMigrationsFolder(migrationsFolder);
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const sqlite = new Database(resolved);
  sqlite.pragma("journal_mode = WAL");
  try {
    const already = detectedAppliedTags(sqlite);
    if (already.length && !tableExists(sqlite, "__drizzle_migrations")) {
      journalExisting(sqlite, folder, already);
    }
    migrate(drizzle(sqlite), { migrationsFolder: folder });
    return { folder, applied: detectedAppliedTags(sqlite) };
  } finally {
    sqlite.close();
  }
}
