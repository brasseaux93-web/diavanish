/*
 * End-to-end protocol run against the real Express routes and a throwaway
 * SQLite file. The browser hooks are mirrored here with the same shared
 * crypto, so what the server relays is exactly what browsers would see.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as E from "../shared/e2ee";

const dir = mkdtempSync(path.join(tmpdir(), "aperture-flow-"));
process.env.APERTURE_DB = path.join(dir, "flow.db");
process.env.APERTURE_DEMO = "1"; // the demo-room test below needs demos on (they are off by default)
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

async function api<T = any>(token: string, method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(base + url, {
    method, headers: { "content-type": "application/json", "x-aperture-session": token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`${method} ${url} ${r.status} ${json.message}`);
  return json;
}

const ctxFor = (roomId: number, seatId: number, epoch: number) => `room:${roomId}|seat:${seatId}|epoch:${epoch}`;

/* Mirrors useFacilitatorCrypto. */
class Facilitator {
  sec!: { epoch: number; createdAt: number; roomKey: string; attestPriv: JsonWebKey; attestPub: string; caucus: Record<number, string> };
  keys = new Map<string, string>();
  constructor(public token: string, public roomId: number, public labels: Record<number, string>) {}
  async tick() {
    const d = await api(this.token, "GET", `/api/facilitator/rooms/${this.roomId}/e2ee`);
    const stale = this.sec && Date.now() - this.sec.createdAt > E.EPOCH_MAX_AGE_MS;
    if (!this.sec || this.sec.epoch !== d.epoch || d.rekeyNeeded || stale) {
      const attest = this.sec ? { priv: this.sec.attestPriv, pub: this.sec.attestPub } : await E.newAttestKeyPair();
      this.sec = { epoch: d.epoch + 1, createdAt: Date.now(), roomKey: await E.newRoomKey(), attestPriv: attest.priv, attestPub: attest.pub, caucus: {} };
      await api(this.token, "POST", `/api/facilitator/rooms/${this.roomId}/e2ee/epoch`, { epoch: this.sec.epoch, attestPub: attest.pub });
      d.seats.forEach((s: any) => (s.wrapped = false));
    }
    const sec = this.sec;
    for (const s of d.seats) {
      if (!s.pub || s.wrapped) continue;
      sec.caucus[s.seatId] ??= await E.newRoomKey();
      const ctx = ctxFor(this.roomId, s.seatId, sec.epoch);
      const w = await E.wrapFor(s.pub, { epoch: sec.epoch, roomKey: sec.roomKey, caucusKey: sec.caucus[s.seatId], attestPub: sec.attestPub }, ctx);
      const sig = await E.signAttestation(sec.attestPriv, E.wrapSigMessage(ctx, await E.pubHash(s.pub), w));
      await api(this.token, "POST", `/api/facilitator/rooms/${this.roomId}/e2ee/wrap`, { seatId: s.seatId, epoch: sec.epoch, pubHash: s.pubHash, ...w, sig });
    }
    this.roster = new Map();
    for (const s of d.seats) {
      const label = this.labels[s.seatId];
      if (!s.signPub || !label) continue;
      let cert = s.cert;
      if (!cert || cert.label !== label || !(await E.verifySenderCert(sec.attestPub, d.roomCode, cert))) {
        cert = await E.issueSenderCert(sec.attestPriv, d.roomCode, s.seatId, label, s.signPub);
        await api(this.token, "POST", `/api/facilitator/rooms/${this.roomId}/e2ee/cert`, cert);
      }
      this.roster.set(s.seatId, [cert]);
    }
    this.keys.set(`${sec.epoch}|floor`, sec.roomKey);
    this.roomCode = d.roomCode;
  }
  roster = new Map<number, E.SenderCert[]>();
  roomCode = "";
  async read(channel: string) {
    const lines = await api<any[]>(this.token, "GET", `/api/facilitator/rooms/${this.roomId}/chat`);
    return Promise.all(lines.map(async (m) => {
      const p = await E.openMessage(this.keys.get(`${m.epoch}|${channel}`)!, channel, m);
      return { p, v: await E.verifyChat(p, channel, m.epoch, { attestPub: this.sec.attestPub, roster: this.roster, facilitatorName: "Facilitator" }) };
    }));
  }
}

/* Mirrors useSeatCrypto + useEncryptedChat. */
class Seat {
  keys = new Map<string, string>();
  attests = new Map<number, string>();
  roster = new Map<number, E.SenderCert[]>();
  ecdh!: E.SeatKeyPair;
  sign!: E.AttestKeyPair;
  epoch = 0;
  safety = "";
  roomCode = "";
  constructor(public token: string, public seatId: number) {}
  async tick() {
    if (!this.ecdh) {
      this.ecdh = await E.newSeatKeyPair();
      this.sign = await E.newSigningKeyPair();
      await api(this.token, "POST", "/api/participant/e2ee/pubkey", { pub: this.ecdh.pub, signPub: this.sign.pub });
    }
    const d = await api(this.token, "GET", "/api/participant/e2ee");
    this.roomCode = d.roomCode;
    if (d.wrap && !this.keys.has(`${d.wrap.epoch}|floor`)) {
      const ctx = ctxFor(d.roomId, this.seatId, d.wrap.epoch);
      const b = await E.unwrap(this.ecdh.priv, d.wrap, ctx);
      assert.ok(await E.verifyAttestation(b.attestPub, E.wrapSigMessage(ctx, await E.pubHash(this.ecdh.pub), d.wrap), d.wrap.sig));
      this.keys.set(`${b.epoch}|floor`, b.roomKey);
      this.attests.set(b.epoch, b.attestPub);
      this.epoch = Math.max(this.epoch, b.epoch);
      this.safety = await E.safetyCode(d.roomCode, b.attestPub);
    }
    const attest = this.attests.get(this.epoch);
    for (const c of d.roster) {
      if (attest && await E.verifySenderCert(attest, d.roomCode, c)) {
        const list = this.roster.get(c.seatId) ?? [];
        if (!list.some((x) => x.sig === c.sig)) this.roster.set(c.seatId, [...list, c]);
      }
    }
    return d;
  }
  async send(text: string, as?: Partial<E.ChatBody>) {
    const own = (this.roster.get(this.seatId) ?? [])[0];
    const body: E.ChatBody = { from: this.seatId, label: own?.label ?? "?", text, sentAt: Date.now(), ...as };
    const signed = await E.signChat(this.sign.priv, "floor", this.epoch, body);
    const sealed = await E.sealMessage(this.keys.get(`${this.epoch}|floor`)!, this.epoch, "floor", signed);
    await api(this.token, "POST", "/api/participant/chat", sealed);
  }
  async read() {
    const lines = await api<any[]>(this.token, "GET", "/api/participant/chat");
    return Promise.all(lines.map(async (m) => {
      const key = this.keys.get(`${m.epoch}|floor`);
      if (!key) return { unreadable: true as const, v: { ok: false } as E.ChatVerdict, epoch: m.epoch };
      const p = await E.openMessage(key, "floor", m);
      const v = await E.verifyChat(p, "floor", m.epoch, { attestPub: this.attests.get(m.epoch) ?? null, roster: this.roster, facilitatorName: "Facilitator" });
      return { p, v, epoch: m.epoch };
    }));
  }
}

test("signed floor chat end to end: certify, send, verify, forge, rotate", async () => {
  const { facilitators, rooms, seats } = schema;
  const fac = S.db.insert(facilitators).values({ email: "f@example.org", name: "F", status: "active", createdAt: Date.now() }).returning().get();
  const room = S.db.insert(rooms).values({
    code: "FLOW42", title: "Flow", facilitatorId: fac.id, status: "live", expiresAt: Date.now() + 86400000, createdAt: Date.now(),
  }).returning().get();
  const mk = (pseudonym: string) => S.db.insert(seats).values({
    roomId: room.id, token: S.uid(24), pseudonym, claimedRole: "Party", status: "admitted", joinedAt: Date.now(),
  }).returning().get();
  const [a, b, c] = [mk("Heron"), mk("Kestrel"), mk("Owl")];
  const F = new Facilitator(S.createSession("facilitator", fac.id), room.id, { [a.id]: "Heron", [b.id]: "Kestrel", [c.id]: "Owl" });
  const A = new Seat(S.createSession("participant", a.id), a.id);
  const B = new Seat(S.createSession("participant", b.id), b.id);
  const C = new Seat(S.createSession("participant", c.id), c.id);

  await F.tick();                                     // epoch 1
  for (const s of [A, B, C]) await s.tick();          // upload ECDH + signing keys
  await F.tick();                                     // wrap + certify
  for (const s of [A, B, C]) await s.tick();          // unwrap + verify roster
  assert.equal(A.epoch, 1);
  assert.equal(A.roster.size, 3);
  assert.equal(A.safety, await E.safetyCode("FLOW42", F.sec.attestPub));
  assert.equal(A.safety, B.safety);

  await A.send("Growers accept the 60/40 split.");
  await C.send("Growers withdraw from the talks.", { from: a.id, label: "Heron" }); // C forges A
  await C.send("Signed by me, labelled as Heron.", { label: "Heron" });             // C relabels itself

  const fromB = await B.read();
  assert.deepEqual(fromB.map((l) => l.v.ok), [true, false, false]);
  assert.deepEqual(fromB[0].v, { ok: true, from: a.id, name: "Heron" });
  const fromF = await F.read("floor");
  assert.deepEqual(fromF.map((l) => l.v.ok), [true, false, false]);

  // Time-based rotation: the facilitator's epoch ages past the limit.
  const safetyBefore = A.safety;
  F.sec.createdAt -= E.EPOCH_MAX_AGE_MS + 1;
  await F.tick();
  assert.equal(F.sec.epoch, 2);
  for (const s of [A, B, C]) await s.tick();
  assert.equal(B.epoch, 2);
  assert.equal(A.safety, safetyBefore); // rotation does not raise the safety alarm
  await A.send("Second epoch line.");

  const after = await B.read();
  assert.equal(after.length, 4);
  assert.deepEqual(after.map((l) => l.epoch), [1, 1, 1, 2]);
  assert.deepEqual(after.map((l) => l.v.ok), [true, false, false, true]); // old epoch still readable

  // A seat admitted after rotation cannot read the earlier epoch.
  const d = mk("Lark");
  const D = new Seat(S.createSession("participant", d.id), d.id);
  F.labels[d.id] = "Lark";
  await D.tick(); await F.tick(); await D.tick();
  const late = await D.read();
  assert.deepEqual(late.map((l) => "unreadable" in l), [true, true, true, false]);
});

test("demo room: server-held key certifies seats so signed lines verify", async () => {
  const { startDemo } = await import("../server/demo");
  const p = startDemo("participant");
  const seat = S.db.select().from(schema.seats).all().find((s) => s.pseudonym === p.pseudonym)!;
  const P = new Seat(p.token!, seat.id);
  await P.tick();
  const d = await P.tick();
  assert.equal(d.demo, true);
  assert.ok(P.roster.get(seat.id)?.[0]);
  await P.send("Hello from the demo.");
  const lines = await P.read();
  const mine = lines.at(-1)!;
  assert.equal(mine.v.ok, true);
});

test("facilitators can list active colleagues for handoff, and only id and name", async () => {
  const { facilitators } = schema;
  const now = Date.now();
  const me = S.db.insert(facilitators).values({ email: "me@example.org", name: "Me", status: "active", createdAt: now }).returning().get();
  const peer = S.db.insert(facilitators).values({ email: "peer@example.org", name: "Peer", status: "active", createdAt: now }).returning().get();
  const gone = S.db.insert(facilitators).values({ email: "gone@example.org", name: "Gone", status: "withdrawn", createdAt: now }).returning().get();
  const list = await api<any[]>(S.createSession("facilitator", me.id), "GET", "/api/facilitator/colleagues");
  const ids = list.map((f) => f.id);
  assert.ok(ids.includes(peer.id));
  assert.ok(!ids.includes(me.id) && !ids.includes(gone.id));
  for (const f of list) assert.deepEqual(Object.keys(f).sort(), ["id", "name"]);
  const r = await fetch(base + "/api/facilitator/colleagues");
  assert.ok(r.status === 401 || r.status === 403);
});
