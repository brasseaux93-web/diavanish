/* With APERTURE_DEMO unset, /api/demo/* does not exist and nothing demo is seeded. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const dir = mkdtempSync(path.join(tmpdir(), "aperture-demo-off-"));
process.env.APERTURE_DB = path.join(dir, "off.db");
delete process.env.APERTURE_DEMO;
delete process.env.APERTURE_DEMO_IN_PRODUCTION;
process.env.NODE_ENV = "production";
execSync("npx drizzle-kit push --force", { env: process.env, stdio: "ignore" });

let base = "";
let server: Server;
let S: typeof import("../server/storage");
let schema: typeof import("../shared/schema");

before(async () => {
  const express = (await import("express")).default;
  S = await import("../server/storage");
  schema = await import("../shared/schema");
  const { registerRoutes } = await import("../server/routes");
  const app = express();
  app.use(express.json());
  await registerRoutes(null, app);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ message: err.message }));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.closeAllConnections();
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

test("production without the flag: POST /api/demo/start {role:admin} is a 404", async () => {
  const r = await fetch(`${base}/api/demo/start`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "admin" }),
  });
  assert.equal(r.status, 404);
  const body = await r.json();
  assert.equal(body.token, undefined);
});

test("every /api/demo/* path is a 404", async () => {
  for (const p of ["/api/demo/reset", "/api/demo/anything"]) {
    const r = await fetch(base + p, { method: "POST" });
    assert.equal(r.status, 404, p);
  }
});

test("public config says demos are off, and no demo data was seeded", async () => {
  const r = await fetch(`${base}/api/public/config`);
  assert.deepEqual(await r.json(), { demo: false });
  assert.equal(S.db.select().from(schema.rooms).all().length, 0);
  assert.equal(S.db.select().from(schema.admins).all().filter((a) => a.email.startsWith("demo.")).length, 0);
});
