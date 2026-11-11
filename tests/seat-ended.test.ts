/*
 * What a seat can still reach once it is no longer in the room.
 *
 * A waiting seat has no key yet and must get nothing from the chat relay. A
 * seat the facilitator removed or banned is refused everywhere in the room,
 * but can still export and ask to erase its own data. A seat that no longer
 * exists gets a clean refusal, never a crash.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const dir = mkdtempSync(path.join(tmpdir(), "aperture-seat-"));
process.env.APERTURE_DB = path.join(dir, "seat.db");
process.env.NODE_ENV = "test";
execSync("npx drizzle-kit push --force", { env: process.env, stdio: "ignore" });

let base = "";
let server: Server;
let S: typeof import("../server/storage");
let schema: typeof import("../shared/schema");
let roomId = 0;

async function call(token: string, method: string, url: string, body?: unknown) {
  const r = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json", "x-aperture-session": token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body: json, text };
}

function seat(pseudonym: string, status: string) {
  const row = S.db.insert(schema.seats).values({
    roomId, token: `tok-${pseudonym}-${Math.random()}`, pseudonym, claimedRole: "Party", status, joinedAt: Date.now(),
  }).returning().get();
  return { id: row.id, token: S.createSession("participant", row.id) };
}

before(async () => {
  const express = (await import("express")).default;
  S = await import("../server/storage");
  schema = await import("../shared/schema");
  const { registerRoutes } = await import("../server/routes");
  const app = express();
  app.use(express.json());
  await registerRoutes(null as any, app);
  // Same shape as the handler in server/index.ts.
  app.use((err: any, _req: any, res: any, _next: any) =>
    res.status(err.status || 500).json(err.code ? { message: err.message, code: err.code, reason: err.reason } : { message: err.message }));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  roomId = S.db.insert(schema.rooms).values({
    code: "SEAT01", title: "Seat test", facilitatorId: 1, status: "live", expiresAt: Date.now() + 86400000, createdAt: Date.now(),
  } as any).returning().get().id;
  S.chatPush(roomId, { epoch: 1, iv: "aXY=", ct: "Y2lwaGVy", channel: "floor" });
});

after(() => {
  server?.closeAllConnections();
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

test("an admitted seat reads the relay; a waiting seat gets nothing from it", async () => {
  const admitted = seat("Heron", "admitted");
  const waiting = seat("Wren", "waiting");
  const ok = await call(admitted.token, "GET", "/api/participant/chat");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.length, 1);
  const no = await call(waiting.token, "GET", "/api/participant/chat");
  assert.equal(no.status, 403);
  assert.ok(!no.text.includes("Y2lwaGVy"), "ciphertext must not reach a seat that was never admitted");
  // …but the waiting seat still sees its own room page, where it waits.
  assert.equal((await call(waiting.token, "GET", "/api/participant/room")).status, 200);
});

for (const status of ["removed", "banned"]) {
  test(`a ${status} seat is refused across the room and told why`, async () => {
    const s = seat(`Gone-${status}`, status);
    const room = await call(s.token, "GET", "/api/participant/room");
    assert.equal(room.status, 403);
    assert.equal(room.body.code, "seat_ended");
    assert.equal(room.body.reason, status);
    for (const [method, url, body] of [
      ["GET", "/api/participant/chat"],
      ["GET", "/api/participant/e2ee"],
      ["POST", "/api/participant/e2ee/pubkey", { pub: "AAAA", signPub: "AAAA" }],
      ["POST", "/api/participant/chat", { epoch: 1, iv: "aXY=", ct: "Y2lwaGVy" }],
      ["POST", "/api/participant/entries", { kind: "issue", text: "x" }],
      ["POST", "/api/participant/reveal-name", {}],
      ["GET", "/api/participant/summary.md"],
    ] as const) {
      const r = await call(s.token, method, url, body);
      assert.equal(r.status, 403, `${method} ${url} answered ${r.status}`);
      assert.equal(r.body.code, "seat_ended", `${method} ${url}`);
    }
    assert.equal(S.cryptoFor(roomId).seatPubs.has(s.id), false, "an ended seat must not be able to register a key");
  });
}

test("a removed seat can still export its data and ask for erasure", async () => {
  const s = seat("Leaver", "removed");
  const exp = await call(s.token, "GET", "/api/participant/export");
  assert.equal(exp.status, 200);
  const era = await call(s.token, "POST", "/api/participant/erasure-request");
  assert.equal(era.status, 200);
  const open = S.db.select().from(schema.dataRequests).all().filter((r) => r.kind === "erasure" && r.status === "open");
  assert.ok(open.some((r) => String(r.detail ?? "").includes(String(s.id)) || r.requester.includes("Leaver")), "the request is on file for the administrator");
});

test("a seat that no longer exists gets the same clean refusal everywhere, never a crash", async () => {
  const { eq } = await import("drizzle-orm");
  const s = seat("Erased", "admitted");
  S.db.delete(schema.seats).where(eq(schema.seats.id, s.id)).run();
  for (const [method, url] of [
    ["GET", "/api/participant/e2ee"], // used to throw a TypeError and answer 500
    ["GET", "/api/participant/room"], ["GET", "/api/participant/chat"], ["GET", "/api/participant/export"],
    ["POST", "/api/participant/erasure-request"], ["POST", "/api/participant/leave"],
    ["GET", "/api/participant/room"], // and again: the answer does not change between calls
  ] as const) {
    const r = await call(s.token, method, url);
    assert.equal(r.status, 403, `${method} ${url} answered ${r.status}`);
    assert.equal(r.body.code, "seat_ended", `${method} ${url}`);
    assert.equal(r.body.reason, "gone", `${method} ${url}`);
  }
  const session = await call(s.token, "GET", "/api/auth/session");
  assert.equal(session.status, 200);
  assert.equal(session.body, null, "an erased seat is not reported as signed in");
});
