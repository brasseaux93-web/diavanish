/*
 * Versioned migrations replace `drizzle-kit push --force` at boot.
 * They must apply cleanly to a fresh file and to a database that was
 * created with push (no journal), without destroying existing rows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { applyMigrations, detectedAppliedTags } from "../server/migrate";

const folder = path.resolve("migrations");

function columns(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function applySqlFiles(sqlite: Database.Database, files: string[]) {
  for (const name of files) {
    const sql = readFileSync(path.join(folder, name), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      if (stmt.trim()) sqlite.exec(stmt);
    }
  }
}

test("a fresh database receives 0000 through 0003, and a second run is a no-op", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aperture-mig-fresh-"));
  const db = path.join(dir, "fresh.db");
  try {
    const first = applyMigrations(db, folder);
    assert.deepEqual(first.applied, ["0000_baseline", "0001_ledger_v2", "0002_purged_at", "0003_passkeys"]);
    const sqlite = new Database(db);
    try {
      assert.ok(columns(sqlite, "admins").includes("email"));
      const roomCols = columns(sqlite, "rooms");
      assert.ok(roomCols.includes("seal_threshold"), "0001 adds seal_threshold");
      assert.ok(roomCols.includes("continues_from"), "0001 adds continues_from");
      assert.ok(roomCols.includes("purged_at"), "0002 adds purged_at");
      assert.ok(columns(sqlite, "consents").includes("support"));
      assert.ok(columns(sqlite, "entry_versions").includes("payload"));
      assert.ok(columns(sqlite, "passkeys").includes("credential_id"), "0003 adds passkeys");
      const journal = sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number };
      assert.equal(journal.n, 4);
    } finally {
      sqlite.close();
    }
    applyMigrations(db, folder);
    const again = new Database(db);
    try {
      assert.equal((again.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n, 4);
    } finally {
      again.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a database created with drizzle-kit push keeps its rows and is journaled", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aperture-mig-push-"));
  const db = path.join(dir, "pushed.db");
  try {
    execSync("npx drizzle-kit push --force", { env: { ...process.env, APERTURE_DB: db }, stdio: "ignore" });
    const before = new Database(db);
    before.prepare("INSERT INTO admins (email, created_at) VALUES (?, ?)").run("kept@example.org", 1);
    assert.equal(detectedAppliedTags(before).length, 4, "push already has the current schema");
    assert.equal(
      before.prepare("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'").all().length,
      0,
      "push does not write the drizzle journal",
    );
    before.close();

    applyMigrations(db, folder);

    const after = new Database(db);
    try {
      const emails = after.prepare("SELECT email FROM admins").all() as { email: string }[];
      assert.ok(emails.some((r) => r.email === "kept@example.org"));
      assert.equal((after.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n, 4);
      assert.ok(columns(after, "rooms").includes("purged_at"));
    } finally {
      after.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a pre-ledger-v2 database (0000 only) receives 0001, 0002 and 0003", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aperture-mig-v1-"));
  const db = path.join(dir, "v1.db");
  try {
    const sqlite = new Database(db);
    applySqlFiles(sqlite, ["0000_baseline.sql"]);
    sqlite.prepare("INSERT INTO admins (email, created_at) VALUES (?, ?)").run("legacy@example.org", 1);
    assert.deepEqual(detectedAppliedTags(sqlite), ["0000_baseline"]);
    assert.ok(!columns(sqlite, "rooms").includes("seal_threshold"));
    assert.ok(!columns(sqlite, "rooms").includes("purged_at"));
    sqlite.close();

    applyMigrations(db, folder);

    const after = new Database(db);
    try {
      assert.deepEqual(detectedAppliedTags(after), ["0000_baseline", "0001_ledger_v2", "0002_purged_at", "0003_passkeys"]);
      assert.ok(columns(after, "rooms").includes("seal_threshold"));
      assert.ok(columns(after, "rooms").includes("purged_at"));
      assert.ok(columns(after, "consents").includes("reason"));
      assert.ok(columns(after, "passkeys").includes("credential_id"));
      const emails = after.prepare("SELECT email FROM admins").all() as { email: string }[];
      assert.ok(emails.some((r) => r.email === "legacy@example.org"));
    } finally {
      after.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dist/migrate.cjs applies a fresh database when the production bundle exists", { skip: !existsSync(path.resolve("dist/migrate.cjs")) }, () => {
  const bundled = path.resolve("dist/migrate.cjs");
  const dir = mkdtempSync(path.join(tmpdir(), "aperture-mig-bundle-"));
  const db = path.join(dir, "bundled.db");
  try {
    execSync(`${process.execPath} ${bundled}`, {
      env: { ...process.env, APERTURE_DB: db },
      stdio: "ignore",
    });
    const sqlite = new Database(db);
    try {
      assert.equal((sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n, 4);
    } finally {
      sqlite.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
