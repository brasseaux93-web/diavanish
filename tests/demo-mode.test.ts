/*
 * Demo mode is off by default, needs a second flag in production, and demo
 * sessions are confined to demo data server-side.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { demoEnabled, demoStartupMessages, isDemoEmail } from "../server/demo-mode";

/* ── The switch itself ───────────────────────────────────── */

test("demos are off unless APERTURE_DEMO=1 is set explicitly", () => {
  assert.equal(demoEnabled({}), false);
  assert.equal(demoEnabled({ NODE_ENV: "development" }), false);
  for (const v of ["0", "", "true", "yes", "on", "TRUE", " 1"]) {
    assert.equal(demoEnabled({ NODE_ENV: "development", APERTURE_DEMO: v }), false, `APERTURE_DEMO=${JSON.stringify(v)}`);
  }
  assert.equal(demoEnabled({ NODE_ENV: "development", APERTURE_DEMO: "1" }), true);
  assert.equal(demoEnabled({ NODE_ENV: "test", APERTURE_DEMO: "1" }), true);
});

test("production needs APERTURE_DEMO_IN_PRODUCTION=1 as well, and then warns loudly", () => {
  assert.equal(demoEnabled({ NODE_ENV: "production" }), false);
  assert.equal(demoEnabled({ NODE_ENV: "production", APERTURE_DEMO: "1" }), false);
  assert.equal(demoEnabled({ NODE_ENV: "production", APERTURE_DEMO_IN_PRODUCTION: "1" }), false);
  assert.equal(demoEnabled({ NODE_ENV: "production", APERTURE_DEMO: "1", APERTURE_DEMO_IN_PRODUCTION: "1" }), true);

  const loud = demoStartupMessages({ NODE_ENV: "production", APERTURE_DEMO: "1", APERTURE_DEMO_IN_PRODUCTION: "1" });
  assert.equal(loud.length, 1);
  assert.equal(loud[0].level, "warn");
  assert.match(loud[0].text, /DEMOS ARE ON IN PRODUCTION/);
  const ignored = demoStartupMessages({ NODE_ENV: "production", APERTURE_DEMO: "1" });
  assert.match(ignored[0].text, /ignored in production/);
  assert.deepEqual(demoStartupMessages({ NODE_ENV: "production" }), []);
  assert.deepEqual(demoStartupMessages({ NODE_ENV: "development", APERTURE_DEMO: "1" }), []);
});

test("only the reserved demo addresses count as demo accounts", () => {
  assert.equal(isDemoEmail("demo.admin@diavanish.org"), true);
  assert.equal(isDemoEmail("DEMO.facilitator@diavanish.org"), true);
  assert.equal(isDemoEmail("demo.admin@agency.gov"), false);
  assert.equal(isDemoEmail("admin@diavanish.org"), false);
  assert.equal(isDemoEmail(null), false);
});

/* ── Against the real routes ─────────────────────────────── */

const dir = mkdtempSync(path.join(tmpdir(), "aperture-demo-"));
process.env.APERTURE_DB = path.join(dir, "demo.db");
process.env.APERTURE_DEMO = "1";
process.env.NODE_ENV = "test";
execSync("npx drizzle-kit push --force", { env: process.env, stdio: "ignore" });

let base = "";
let server: Server;
let S: typeof import("../server/storage");
let schema: typeof import("../shared/schema");

async function call(token: string | null, method: string, url: string, body?: unknown) {
  const r = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json", ...(token ? { "x-aperture-session": token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

let realAdmin = "";
let realFac = "";
let realFacId = 0;
let realRoomId = 0;

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

  // Real platform data next to the demo.
  const a = S.db.insert(schema.admins).values({ email: "ops@agency.example", createdAt: Date.now() }).returning().get();
  realAdmin = S.createSession("admin", a.id);
  const f = S.db.insert(schema.facilitators).values({ email: "mediator@agency.example", name: "Real Mediator", status: "active", createdAt: Date.now() }).returning().get();
  realFacId = f.id;
  realFac = S.createSession("facilitator", f.id);
  const r = await call(realFac, "POST", "/api/facilitator/rooms", { title: "Real room" });
  assert.equal(r.status, 200);
  realRoomId = r.body.id;
});

after(() => {
  server?.closeAllConnections();
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

test("public config tells the client whether demos exist", async () => {
  const r = await call(null, "GET", "/api/public/config");
  assert.deepEqual(r.body, { demo: true });
});

test("the demo administrator sees demo data only and cannot change the platform", async () => {
  const start = await call(null, "POST", "/api/demo/start", { role: "admin" });
  assert.equal(start.status, 200);
  const t = start.body.token as string;

  const me = await call(t, "GET", "/api/auth/session");
  assert.equal(me.body.role, "admin");
  assert.equal(me.body.demo, true);

  const facs = await call(t, "GET", "/api/admin/facilitators");
  assert.equal(facs.status, 200);
  assert.ok(facs.body.length >= 1);
  assert.ok(facs.body.every((f: any) => isDemoEmail(f.email)), "only demo facilitators");
  assert.ok(!facs.body.some((f: any) => f.id === realFacId));

  for (const url of ["/api/admin/applications", "/api/admin/blocked-countries", "/api/admin/data-requests", "/api/admin/security-events"]) {
    const r = await call(t, "GET", url);
    assert.equal(r.status, 200, url);
    assert.deepEqual(r.body, [], `${url} is empty for the demo`);
  }

  const stats = await call(t, "GET", "/api/admin/analytics");
  const realStats = await call(realAdmin, "GET", "/api/admin/analytics");
  assert.equal(stats.body.rooms.total, 2, "demo counts cover the two demo rooms only");
  assert.equal(realStats.body.rooms.total, 1, "real counts never include demo rooms");

  const trail = await call(t, "GET", "/api/admin/audit");
  const realIds = new Set([realRoomId]);
  assert.ok(trail.body.entries.every((e: any) => e.roomId !== null && !realIds.has(e.roomId)));

  // Every write is refused, whatever it targets.
  const writes: [string, string, unknown?][] = [
    ["PATCH", "/api/platform/settings", { orgName: "pwned" }],
    ["POST", `/api/admin/facilitators/${realFacId}/withdraw`],
    ["POST", `/api/admin/facilitators/${realFacId}/restore`],
    ["POST", "/api/admin/blocked-countries", { code: "XX", name: "Nowhere" }],
    ["DELETE", "/api/admin/blocked-countries/1"],
    ["POST", "/api/admin/applications/1/decide", { approve: true }],
    ["POST", "/api/admin/data-requests/1/decide", { decision: "completed" }],
    ["POST", "/api/admin/purge"],
  ];
  for (const [m, url, body] of writes) {
    const r = await call(t, m, url, body);
    assert.equal(r.status, 403, `${m} ${url}`);
  }
  const settings = await call(null, "GET", "/api/platform/settings");
  assert.notEqual(settings.body.orgName, "pwned");
  const fac = S.db.select().from(schema.facilitators).all().find((f) => f.id === realFacId)!;
  assert.equal(fac.status, "active");

  // The real administrator still has every power.
  const ok = await call(realAdmin, "GET", "/api/admin/security-events");
  assert.equal(ok.status, 200);
});

test("the demo facilitator cannot reach real rooms, and real facilitators cannot reach demo rooms", async () => {
  const start = await call(null, "POST", "/api/demo/start", { role: "facilitator" });
  const t = start.body.token as string;

  assert.equal((await call(t, "GET", `/api/facilitator/rooms/${realRoomId}`)).status, 404);
  const mine = await call(t, "GET", "/api/facilitator/rooms");
  assert.ok(mine.body.every((r: any) => r.seriesKey?.startsWith("demo:")));

  // A room the demo creates is a demo room, whatever the client asks for.
  const made = await call(t, "POST", "/api/facilitator/rooms", { title: "Sandbox", seriesKey: "series:REAL" });
  assert.equal(made.status, 200);
  assert.equal(made.body.seriesKey, "demo:sandbox");

  // Colleagues and hand-offs stay on the demo side.
  const colleagues = await call(t, "GET", "/api/facilitator/colleagues");
  assert.ok(!colleagues.body.some((c: any) => c.id === realFacId));
  const handoff = await call(t, "POST", `/api/facilitator/rooms/${made.body.id}/handoff`, { facilitatorId: realFacId });
  assert.equal(handoff.status, 404);

  // A real facilitator cannot claim the demo prefix or open a demo room.
  const sneaky = await call(realFac, "POST", "/api/facilitator/rooms", { title: "x", seriesKey: "demo:live" });
  assert.notEqual(sneaky.body.seriesKey, "demo:live");
  const demoRoomId = mine.body[0].id;
  assert.equal((await call(realFac, "GET", `/api/facilitator/rooms/${demoRoomId}`)).status, 404);

  // Agenda items cannot be changed across rooms.
  const realAgenda = S.db.insert(schema.agendaItems).values({ roomId: realRoomId, position: 1, title: "Real item", status: "open" }).returning().get();
  assert.equal((await call(t, "POST", `/api/facilitator/agenda/${realAgenda.id}/status`, { status: "covered" })).status, 404);
});

test("demo accounts can never sign in with an email code", async () => {
  const r = await call(null, "POST", "/api/auth/verify-code", { email: "demo.admin@diavanish.org", code: "123456", role: "admin" });
  assert.equal(r.status, 401);
});

test("turning demos off strands existing demo sessions", async () => {
  const start = await call(null, "POST", "/api/demo/start", { role: "facilitator" });
  const t = start.body.token as string;
  process.env.APERTURE_DEMO = "0";
  try {
    assert.equal((await call(t, "GET", "/api/facilitator/rooms")).status, 403);
    assert.equal((await call(t, "GET", "/api/auth/session")).body, null);
  } finally {
    process.env.APERTURE_DEMO = "1";
  }
});
