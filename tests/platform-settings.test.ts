/*
 * Platform settings: every field the admin console shows must actually
 * persist, and retention values must be validated server-side — a bad
 * value must never shorten (or crash) the nightly purge.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const dir = mkdtempSync(path.join(tmpdir(), "aperture-settings-"));
process.env.APERTURE_DB = path.join(dir, "settings.db");
process.env.NODE_ENV = "test";
execSync("npx drizzle-kit push --force", { env: process.env, stdio: "ignore" });

let base = "";
let server: Server;
let S: typeof import("../server/storage");
let schema: typeof import("../shared/schema");
let admin = "";

async function call(method: string, url: string, body?: unknown) {
  const r = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json", "x-aperture-session": admin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

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

  const a = S.db.insert(schema.admins).values({ email: "ops@agency.example", createdAt: Date.now() }).returning().get();
  admin = S.createSession("admin", a.id);
});

after(() => {
  server?.closeAllConnections();
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

test("every retention field the console shows persists", async () => {
  const r = await call("PATCH", "/api/platform/settings", {
    orgName: "Harbour Mediation",
    defaultTurnMinutes: 9,
    requireRoleProofsDefault: true,
    closedRoomRetentionDays: 45,
    guestSessionRetentionDays: 5,
    applicationRetentionDays: 120,
    sealedLedgerKept: true,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.orgName, "Harbour Mediation");
  assert.equal(r.body.defaultTurnMinutes, 9);
  assert.equal(r.body.requireRoleProofsDefault, 1);
  assert.equal(r.body.closedRoomRetentionDays, 45);
  assert.equal(r.body.guestSessionRetentionDays, 5);
  assert.equal(r.body.applicationRetentionDays, 120);
  assert.equal(r.body.sealedLedgerKept, 1);
  // and it survives a reload, not just the response
  const again = await call("GET", "/api/platform/settings");
  assert.equal(again.body.applicationRetentionDays, 120, "applicationRetentionDays must be written to the database");
});

test("retention values are clamped, never trusted", async () => {
  const before = (await call("GET", "/api/platform/settings")).body;
  // zero, negative, absurd, and non-numeric values must not shorten retention
  const r = await call("PATCH", "/api/platform/settings", {
    closedRoomRetentionDays: 0,
    guestSessionRetentionDays: -30,
    applicationRetentionDays: 999999999,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.closedRoomRetentionDays, before.closedRoomRetentionDays, "0 falls back, not purge-everything");
  assert.equal(r.body.guestSessionRetentionDays, before.guestSessionRetentionDays, "negative falls back");
  assert.equal(r.body.applicationRetentionDays, 3650, "absurd values clamp to 3650");
  // null (JSON from an empty input) must not write NULL into a NOT NULL column
  const n = await call("PATCH", "/api/platform/settings", { closedRoomRetentionDays: null, guestSessionRetentionDays: null, applicationRetentionDays: null });
  assert.equal(n.status, 200);
  assert.equal(n.body.closedRoomRetentionDays, before.closedRoomRetentionDays);
});

test("turn length is clamped to the supported range", async () => {
  const r = await call("PATCH", "/api/platform/settings", { defaultTurnMinutes: 99 });
  assert.equal(r.status, 200);
  assert.equal(r.body.defaultTurnMinutes, 15);
  const s = await call("PATCH", "/api/platform/settings", { defaultTurnMinutes: 1 });
  assert.equal(s.body.defaultTurnMinutes, 5);
});

test("a partial save leaves the other settings alone", async () => {
  await call("PATCH", "/api/platform/settings", { sealedLedgerKept: true, requireRoleProofsDefault: true });
  // The sign-in policy form sends only its own two fields.
  const r = await call("PATCH", "/api/platform/settings", { requirePasskey: false, emailCodeEnabled: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.sealedLedgerKept, 1, "saving the sign-in policy must not switch off sealed-ledger retention");
  assert.equal(r.body.requireRoleProofsDefault, 1, "saving the sign-in policy must not switch off role proofs");
  // and an explicit false still turns them off
  const off = await call("PATCH", "/api/platform/settings", { sealedLedgerKept: false, requireRoleProofsDefault: false });
  assert.equal(off.body.sealedLedgerKept, 0);
  assert.equal(off.body.requireRoleProofsDefault, 0);
  await call("PATCH", "/api/platform/settings", { sealedLedgerKept: true });
});

/* ── Erasure requests: never delete the wrong person's seat ── */

function seedSeat(roomCode: string, pseudonym: string) {
  const room = S.db.select().from(schema.rooms).all().find((r) => r.code === roomCode)
    ?? S.db.insert(schema.rooms).values({
      code: roomCode, title: `Room ${roomCode}`, facilitatorId: 1, expiresAt: Date.now() + 86400000, createdAt: Date.now(),
    } as any).returning().get();
  return S.db.insert(schema.seats).values({
    roomId: room.id, token: `tok-${roomCode}-${pseudonym}-${Math.random()}`, pseudonym, claimedRole: "Party",
    status: "admitted", joinedAt: Date.now(),
  }).returning().get();
}
const seatExists = (id: number) => !!S.db.select().from(schema.seats).all().find((s) => s.id === id);
const request = (requester: string, detail: string | null) =>
  S.db.insert(schema.dataRequests).values({ kind: "erasure", requester, detail, status: "open", createdAt: Date.now() }).returning().get();

test("completing an erasure request erases the seat that asked, not a namesake in another room", async () => {
  const mine = seedSeat("ERASE1", "Alex");
  const namesake = seedSeat("ERASE2", "Alex");
  const req = request("Alex", `seat:${mine.id}`);
  const r = await call("POST", `/api/admin/data-requests/${req.id}/decide`, { decision: "completed" });
  assert.equal(r.status, 200);
  assert.equal(seatExists(mine.id), false, "the requesting seat is erased");
  assert.equal(seatExists(namesake.id), true, "a seat with the same pseudonym in another room is untouched");
  // a decided request cannot be decided again
  const again = await call("POST", `/api/admin/data-requests/${req.id}/decide`, { decision: "rejected" });
  assert.equal(again.status, 409);
});

test("an erasure request that matches more than one seat is refused and erases nothing", async () => {
  const a = seedSeat("ERASE3", "Sam");
  const b = seedSeat("ERASE4", "Sam");
  const legacy = request("Sam", null); // requests made before seat ids were recorded
  const r = await call("POST", `/api/admin/data-requests/${legacy.id}/decide`, { decision: "completed" });
  assert.equal(r.status, 409);
  assert.equal(seatExists(a.id), true);
  assert.equal(seatExists(b.id), true);
  const row = S.db.select().from(schema.dataRequests).all().find((x) => x.id === legacy.id)!;
  assert.equal(row.status, "open", "the request stays open so it is not reported as completed");
  // rejecting it is still possible, and an unknown decision is not
  const bad = await call("POST", `/api/admin/data-requests/${legacy.id}/decide`, { decision: "maybe" });
  assert.equal(bad.status, 400);
  const rej = await call("POST", `/api/admin/data-requests/${legacy.id}/decide`, { decision: "rejected" });
  assert.equal(rej.status, 200);
});
