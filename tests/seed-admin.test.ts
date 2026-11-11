/*
 * First-boot seeding: a host that names its administrator must not also get
 * an administrator account at the project's own address.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "aperture-seed-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function adminsAfterFirstBoot(name: string, ownerEmail?: string): string[] {
  const env: NodeJS.ProcessEnv = { ...process.env, APERTURE_DB: path.join(dir, name), NODE_ENV: "test" };
  delete env.APERTURE_ADMIN_EMAIL;
  if (ownerEmail) env.APERTURE_ADMIN_EMAIL = ownerEmail;
  execSync("npx drizzle-kit push --force", { env, stdio: "ignore" });
  const script = `
    const S = await import("./server/storage.ts");
    const { admins } = await import("./shared/schema.ts");
    console.log(JSON.stringify(S.db.select().from(admins).all().map((a) => a.email).sort()));
  `;
  const out = execSync(`npx tsx --input-type=module -e '${script.replace(/\n/g, " ")}'`, { env, encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").pop()!);
}

test("with APERTURE_ADMIN_EMAIL set, only that address becomes an administrator", () => {
  assert.deepEqual(adminsAfterFirstBoot("owner.db", "Owner@Example.org"), ["owner@example.org"]);
});

test("without APERTURE_ADMIN_EMAIL, the built-in local administrator is seeded", () => {
  assert.deepEqual(adminsAfterFirstBoot("local.db"), ["admin@diavanish.org"]);
});
