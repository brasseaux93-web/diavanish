/*
 * Ledger v2 end to end against the real routes and a throwaway SQLite file:
 * consent gating, support aggregation, the v2 seal and its verification, the
 * brief, series carry-forward, v1 seals, and that chat is never persisted.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { fingerprintFor, canonicalJson } from "../shared/ledger";

const dir = mkdtempSync(path.join(tmpdir(), "diavanish-ledger-"));
process.env.APERTURE_DB = path.join(dir, "ledger.db");
process.env.APERTURE_DEMO = "0";
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

async function call(token: string | null, method: string, url: string, body?: unknown) {
  const r = await fetch(base + url, {
    method, headers: { "content-type": "application/json", ...(token ? { "x-aperture-session": token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, body: type.includes("json") ? await r.json() : await r.text() };
}
async function ok<T = any>(token: string | null, method: string, url: string, body?: unknown): Promise<T> {
  const r = await call(token, method, url, body);
  if (r.status >= 400) throw new Error(`${method} ${url} ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as T;
}

function setup(title: string, mode: "anonymous" | "open" = "anonymous", sealThreshold = "consensus") {
  const { facilitators, rooms, seats, agendaItems } = schema;
  const fac = S.db.insert(facilitators).values({ email: `${S.uid(6)}@example.org`, name: "F", status: "active", createdAt: Date.now() }).returning().get();
  const room = S.db.insert(rooms).values({
    code: S.uid(6).toUpperCase(), title, facilitatorId: fac.id, status: "live", anonymityMode: mode, sealThreshold,
    expiresAt: Date.now() + 86400000, createdAt: Date.now(),
  }).returning().get();
  const agenda = S.db.insert(agendaItems).values({ roomId: room.id, position: 1, title: "Drainage", status: "open" }).returning().get();
  const seat = (pseudonym: string, claimedRole: string, realName?: string) => S.db.insert(seats).values({
    roomId: room.id, token: S.uid(24), pseudonym, claimedRole, realName: realName ?? null, useRealName: realName ? 1 : 0,
    status: "admitted", joinedAt: Date.now(),
  }).returning().get();
  return { fac, room, agenda, seat, F: S.createSession("facilitator", fac.id) };
}

test("structured items need every seat's support before approval, and only approved content is sealed", async () => {
  const { room, agenda, seat, F } = setup("Harbour drainage", "anonymous", "super66");
  const heron = seat("Heron", "Residents' association");
  const wren = seat("Wren", "Small business council");
  const kite = seat("Kite", "Youth climate group");
  const H = S.createSession("participant", heron.id);
  const W = S.createSession("participant", wren.id);
  const K = S.createSession("participant", kite.id);

  // Attribution: a pseudonym is a person; a delegation is not.
  const bad = await call(F, "POST", `/api/facilitator/rooms/${room.id}/record`, { kind: "position", agendaItemId: agenda.id, payload: { party: "Heron", wants: "More drains" } });
  assert.equal(bad.status, 400);
  const badUrl = await call(F, "POST", `/api/facilitator/rooms/${room.id}/record`, { kind: "evidence", payload: { summary: "x", url: "javascript:alert(1)" } });
  assert.equal(badUrl.status, 400);
  // Structured kinds cannot slip in through the plain composers.
  assert.equal((await call(F, "POST", "/api/facilitator/entries", { roomId: room.id, kind: "problem", text: "x" })).status, 400);
  assert.equal((await call(H, "POST", "/api/participant/entries", { kind: "agreement", text: "x" })).status, 400);

  const problem = await ok(F, "POST", `/api/facilitator/rooms/${room.id}/record`, {
    kind: "problem", agendaItemId: agenda.id,
    payload: { statement: "Basements on Dock Street flood in heavy storms.", scale: "community", affected: "Households, Shops" },
  });
  const option = await ok(F, "POST", `/api/facilitator/rooms/${room.id}/record`, {
    kind: "option", agendaItemId: agenda.id, payload: { title: "UNCONSENTED-OPTION tunnel", status: "dropped", reason: "Cost" },
  });
  const rejected = await ok(F, "POST", `/api/facilitator/rooms/${room.id}/record`, {
    kind: "question", payload: { question: "REJECTED-QUESTION about the moon?" },
  });
  await ok(F, "POST", `/api/facilitator/entries/${rejected.id}/reject`);

  // Not yet: nobody has answered.
  const early = await call(F, "POST", `/api/facilitator/entries/${problem.id}/approve`);
  assert.equal(early.status, 400);
  assert.match(early.body.message, /0 of 3/);

  // Participants see the proposal and answer for themselves.
  const view = await ok(H, "GET", "/api/participant/room");
  assert.deepEqual(view.proposals.map((p: any) => p.id), [problem.id, option.id]);
  await ok(H, "POST", `/api/participant/consents/${problem.id}`, { support: "full" });
  // Before every seat has answered, the facilitator learns only how many answered.
  const partial = (await ok(F, "GET", `/api/facilitator/rooms/${room.id}`)).entries.find((e: any) => e.id === problem.id);
  assert.deepEqual([partial.tally.responded, partial.tally.required, partial.tally.complete], [1, 3, false]);
  assert.equal(partial.tally.support, null);
  assert.equal(partial.tally.rewording, null);
  assert.equal(partial.tally.anyRewording, null);
  assert.deepEqual(partial.consents, []);
  await ok(K, "POST", `/api/participant/consents/${problem.id}`, { support: null }); // asks for rewording
  await ok(W, "POST", `/api/participant/consents/${problem.id}`, { support: "objection", reason: "draft" });
  const reword = await call(F, "POST", `/api/facilitator/entries/${problem.id}/approve`);
  assert.equal(reword.status, 400);
  assert.match(reword.body.message, /rewording/);
  assert.equal((await call(W, "POST", `/api/participant/consents/${problem.id}`, { support: "maybe" })).status, 400);
  await ok(W, "POST", `/api/participant/consents/${problem.id}`, { support: "objection", reason: "Shops were left out of the first draft." });
  await ok(K, "POST", `/api/participant/consents/${problem.id}`, { support: "reservations" }); // 2 of 3 consent: two thirds

  // The facilitator sees that seats answered, not which level each chose.
  const fac = await ok(F, "GET", `/api/facilitator/rooms/${room.id}`);
  const row = fac.entries.find((e: any) => e.id === problem.id);
  assert.deepEqual(row.consents, []); // never per-seat rows for record items
  // Three seats: levels only, never counts.
  assert.equal(row.tally.detail, "levels");
  assert.deepEqual(
    { level: row.tally.support.level, r: row.tally.support.withReservations, o: row.tally.support.withObjection },
    { level: "objection", r: true, o: true });
  for (const k of ["full", "reservations", "objection"]) assert.equal(k in row.tally.support, false);
  assert.equal(row.tally.consenting, null);
  assert.equal(row.tally.decision.passed, true);
  assert.equal(row.tally.support.objections[0].by, undefined); // anonymous room: no name

  await ok(F, "POST", `/api/facilitator/entries/${problem.id}/approve`);

  // Revising resets consent to the exact new version.
  await ok(H, "POST", `/api/participant/consents/${option.id}`, { support: "full" });
  await ok(F, "POST", `/api/facilitator/entries/${option.id}/revise`, { payload: { title: "UNCONSENTED-OPTION tunnel v2", status: "dropped" } });
  const afterRevise = await ok(F, "GET", `/api/facilitator/rooms/${room.id}`);
  assert.equal(afterRevise.entries.find((e: any) => e.id === option.id).tally.responded, 0);

  // Follow-through and the locked summary are folded into the seal.
  await ok(F, "POST", `/api/facilitator/rooms/${room.id}/followups`, { type: "commitment", text: "Map flood-risk shops", dueDate: "2026-04-15" });
  await ok(F, "POST", `/api/facilitator/rooms/${room.id}/summary`, { agreements: "Green drainage first." });
  const sv = (await ok(F, "GET", `/api/facilitator/rooms/${room.id}`)).summaries[0];
  await ok(F, "POST", `/api/facilitator/rooms/${room.id}/summary/${sv.id}/lock`);

  await ok(F, "POST", `/api/facilitator/rooms/${room.id}/close`);
  // Nothing half-decided can be sealed: the option still awaits the room.
  const blocked = await call(F, "POST", `/api/facilitator/rooms/${room.id}/seal`);
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.message, /awaiting the room/);
  await ok(F, "POST", `/api/facilitator/entries/${option.id}/reject`); // set aside
  const sealed = await ok(F, "POST", `/api/facilitator/rooms/${room.id}/seal`);
  assert.equal(sealed.ledgerVersion, 2);

  // Anyone can recompute the v2 fingerprint from the public document.
  const pub = await ok(null, "GET", `/api/public/ledger/${room.code}`);
  assert.equal(pub.ledgerVersion, 2);
  assert.equal(await fingerprintFor(2, { document: pub.document }), pub.room.fingerprint);
  assert.equal(pub.room.fingerprint, sealed.fingerprint);
  const docText = canonicalJson(pub.document);
  assert.deepEqual(pub.document.items.map((i: any) => i.id), [problem.id]);
  assert.ok(!docText.includes("UNCONSENTED-OPTION") && !docText.includes("REJECTED-QUESTION"));
  assert.ok(!docText.includes("Heron") && !docText.includes("Wren") && !docText.includes("Kite"));
  assert.equal(pub.document.room.threshold, "super66");
  assert.equal(pub.document.supportDetail, "levels");
  assert.ok(!/"(full|reservations|objection)":\d/.test(docText), "no counts in a small room's sealed ledger");
  const smallBrief = await fetch(`${base}/api/public/ledger/${room.code}/brief.html`).then((r) => r.text());
  assert.match(smallBrief, /Objection on record, with reservations/);
  assert.ok(!/Objection on record · \d|reservations · \d/.test(smallBrief));
  assert.equal(pub.document.items[0].support.objections[0].reason, "Shops were left out of the first draft.");
  assert.equal(pub.document.summary.agreements, "Green drainage first.");
  assert.equal(pub.document.followups[0].text, "Map flood-risk shops");
  assert.deepEqual(pub.rows.map((r: any) => r.id), [problem.id]); // v1-shaped rows for older readers

  // Tampering with any agreed field breaks the match.
  const forged = JSON.parse(JSON.stringify(pub.document));
  forged.followups[0].status = "kept";
  assert.notEqual(await fingerprintFor(2, { document: forged }), pub.room.fingerprint);

  // Follow-through can still be tracked after the seal without breaking it.
  const fu = (await ok(F, "GET", `/api/facilitator/rooms/${room.id}`)).followups[0];
  await ok(F, "POST", `/api/facilitator/followups/${fu.id}/status`, { status: "lapsed" });
  const again = await ok(null, "GET", `/api/public/ledger/${room.code}`);
  assert.equal(await fingerprintFor(2, { document: again.document }), again.room.fingerprint);

  // Per-seat choices are gone once the aggregate is sealed.
  const left = S.db.select().from(schema.consents).all().filter((c) => [problem.id, option.id].includes(c.entryId));
  assert.equal(left.length, 0);
  assert.equal((await call(H, "POST", `/api/participant/consents/${problem.id}`, { support: "full" })).status, 400);

  // The brief holds sealed content only.
  const brief = await call(null, "GET", `/api/public/ledger/${room.code}/brief.html`);
  assert.equal(brief.status, 200);
  const html = brief.body as string;
  assert.match(html, /Basements on Dock Street flood in heavy storms\./);
  assert.match(html, /Shops were left out of the first draft\./);
  assert.ok(html.includes(sealed.fingerprint.slice(0, 8)));
  assert.ok(!html.includes("UNCONSENTED-OPTION") && !html.includes("REJECTED-QUESTION"));
  assert.ok(!html.includes("Heron") && !html.includes("Wren"));
  assert.ok(!/<script\s+src|<link\s/i.test(html)); // standalone: no external loads
  const ar = await call(null, "GET", `/api/public/ledger/${room.code}/brief.html?lang=ar`);
  assert.match(ar.body as string, /dir="rtl"/);
});

test("objections carry a name only for seats that chose their real name in an open room", async () => {
  const { room, F } = setup("Open room", "open");
  const { seats } = schema;
  const amara = S.db.insert(seats).values({ roomId: room.id, token: S.uid(24), pseudonym: "Seat 7Q2F", claimedRole: "Youth", realName: "Amara Okafor", useRealName: 1, status: "admitted", joinedAt: Date.now() }).returning().get();
  const quiet = S.db.insert(seats).values({ roomId: room.id, token: S.uid(24), pseudonym: "Owl", claimedRole: "Utilities", realName: "Hidden Person", useRealName: 0, status: "admitted", joinedAt: Date.now() }).returning().get();
  // A real name the seat has not chosen to show is refused anywhere in the record.
  assert.equal((await call(F, "POST", `/api/facilitator/rooms/${room.id}/record`, { kind: "agreement", payload: { action: "x", owner: "Hidden Person" } })).status, 400);
  assert.equal((await call(F, "POST", `/api/facilitator/rooms/${room.id}/record`, { kind: "position", payload: { party: "Owl", wants: "x" } })).status, 400);
  const pos = await ok(F, "POST", `/api/facilitator/rooms/${room.id}/record`, { kind: "position", payload: { party: "Amara Okafor", wants: "Open data" } });
  await ok(S.createSession("participant", amara.id), "POST", `/api/participant/consents/${pos.id}`, { support: "objection", reason: "Needs a date" });
  await ok(S.createSession("participant", quiet.id), "POST", `/api/participant/consents/${pos.id}`, { support: "objection", reason: "Too vague" });
  const t = S.tallyFor(pos.id, S.db.select().from(schema.rooms).all().find((r) => r.id === room.id)!);
  assert.deepEqual(t.support!.objections, [{ reason: "Needs a date", by: "Amara Okafor" }, { reason: "Too vague" }]);
});

test("a consent cannot reach an entry in another room", async () => {
  const a = setup("Room A");
  const b = setup("Room B");
  const seatA = a.seat("Lark", "Youth");
  b.seat("Kite", "City");
  const item = await ok(b.F, "POST", `/api/facilitator/rooms/${b.room.id}/record`, { kind: "question", payload: { question: "Who pays?" } });
  const r = await call(S.createSession("participant", seatA.id), "POST", `/api/participant/consents/${item.id}`, { support: "full" });
  assert.equal(r.status, 404);
});

test("a new round continues from a sealed ledger with carried items as drafts needing fresh consent", async () => {
  const { room, agenda, seat, F } = setup("Round 1");
  const s1 = seat("Heron", "Residents");
  const P = S.createSession("participant", s1.id);
  const add = (kind: string, payload: object) => ok(F, "POST", `/api/facilitator/rooms/${room.id}/record`, { kind, agendaItemId: agenda.id, payload });
  const q = await add("question", { question: "What does a tree cost per degree?", research: "Ask the climate lab" });
  const c = await add("condition", { form: "conditional", accept: "phased funding", provided: "worst streets go first" });
  const p = await add("problem", { statement: "Flooding", scale: "city" });
  for (const e of [q, c, p]) {
    await ok(P, "POST", `/api/participant/consents/${e.id}`, { support: "full" });
    await ok(F, "POST", `/api/facilitator/entries/${e.id}/approve`);
  }
  await ok(F, "POST", `/api/facilitator/rooms/${room.id}/followups`, { type: "pledge", text: "Circulate supplier list" });
  await ok(F, "POST", `/api/facilitator/rooms/${room.id}/followups`, { type: "commitment", text: "Publish canopy survey" });
  await ok(F, "POST", `/api/facilitator/rooms/${room.id}/close`);
  await ok(F, "POST", `/api/facilitator/rooms/${room.id}/seal`);
  const fus = (await ok(F, "GET", `/api/facilitator/rooms/${room.id}`)).followups;
  await ok(F, "POST", `/api/facilitator/followups/${fus[0].id}/status`, { status: "lapsed" });
  await ok(F, "POST", `/api/facilitator/followups/${fus[1].id}/status`, { status: "kept" });

  // Only a sealed room you facilitate can be continued.
  const other = setup("Not mine");
  assert.equal((await call(other.F, "POST", "/api/facilitator/rooms", { title: "x", continueFrom: room.code })).status, 400);

  const next = await ok(F, "POST", "/api/facilitator/rooms", { title: "Round 2", continueFrom: room.code });
  assert.equal(next.continuesFrom, room.code);
  assert.equal(next.carried, 3);
  const data = await ok(F, "GET", `/api/facilitator/rooms/${next.id}`);
  assert.deepEqual(data.entries.map((e: any) => e.kind).sort(), ["agreement", "condition", "question"]);
  for (const e of data.entries) {
    assert.equal(e.status, "pending");
    assert.equal(e.carriedFrom, room.code);
    assert.equal(e.consents.length, 0);
  }
  const agreement = data.entries.find((e: any) => e.kind === "agreement");
  assert.match(agreement.versions[0].text, /Circulate supplier list/);
  assert.ok(!data.entries.some((e: any) => /Publish canopy survey|Flooding/.test(e.versions[0].text)));
  assert.ok(data.agenda.some((a: any) => a.title === "Drainage"));
  // Opening the room does not duplicate the carried commitments.
  await ok(F, "POST", `/api/facilitator/rooms/${next.id}/open`);
  assert.equal((await ok(F, "GET", `/api/facilitator/rooms/${next.id}`)).followups.length, 0);
});

test("v1 seals keep verifying on the v1 branch, exactly as before", async () => {
  const { room, seat, F } = setup("Legacy");
  const owl = seat("Owl", "Traders");
  const { entries, entryVersions, rooms } = schema;
  const e = S.db.insert(entries).values({ roomId: room.id, kind: "summary", visibility: "all", status: "approved", authorSeatId: owl.id, approvedAt: 1700000000000, createdAt: 1700000000000 }).returning().get();
  S.db.insert(entryVersions).values({ entryId: e.id, version: 1, text: "Crossing opens Tuesdays and Fridays.", createdAt: 1700000000000 }).run();
  // Sealed the way the shipped v1 code did: fingerprint of canonicalLedger(rows), no version column.
  const fp = S.sha256(S.canonicalLedger(S.buildLedger(room.id).rows));
  const { eq } = await import("drizzle-orm");
  S.db.update(rooms).set({ status: "sealed", fingerprint: fp, sealedAt: Date.now() }).where(eq(rooms.id, room.id)).run();
  const pub = await ok(null, "GET", `/api/public/ledger/${room.code}`);
  assert.equal(pub.ledgerVersion, 1);
  assert.equal(pub.document, undefined);
  assert.equal(await fingerprintFor(pub.ledgerVersion, { rows: pub.rows }), fp);
  assert.equal((await call(null, "GET", `/api/public/ledger/${room.code}/brief.html`)).status, 404);
  const exp = await ok(F, "GET", `/api/facilitator/rooms/${room.id}/export`);
  assert.equal(exp.ledger[0].text, "Crossing opens Tuesdays and Fridays.");
});

test("chat is never persisted: relayed ciphertext appears nowhere in the database or the seal", async () => {
  const { room, seat, F } = setup("Chat room");
  const s = seat("Kite", "City");
  const P = S.createSession("participant", s.id);
  const ct = Buffer.from("CHAT-MARKER-" + S.uid(12)).toString("base64");
  await ok(P, "POST", "/api/participant/chat", { epoch: 1, iv: Buffer.alloc(12, 1).toString("base64"), ct });
  const relayed = await ok(P, "GET", "/api/participant/chat");
  assert.equal(relayed.at(-1).ct, ct); // the relay has it, in memory
  const { default: Database } = await import("better-sqlite3");
  const raw = new Database(process.env.APERTURE_DB!, { readonly: true });
  const tables = raw.prepare("select name from sqlite_master where type='table'").all() as { name: string }[];
  for (const { name } of tables) {
    const dump = JSON.stringify(raw.prepare(`select * from "${name}"`).all());
    assert.ok(!dump.includes(ct) && !dump.includes("CHAT-MARKER"), `chat found in ${name}`);
  }
  raw.close();
  await ok(F, "POST", `/api/facilitator/rooms/${room.id}/close`);
  assert.equal((await ok(P, "GET", "/api/participant/chat")).length, 0); // wiped on close
  const sealed = await ok(F, "POST", `/api/facilitator/rooms/${room.id}/seal`);
  const pub = await ok(null, "GET", `/api/public/ledger/${room.code}`);
  assert.ok(!JSON.stringify(pub).includes(ct));
  assert.equal(pub.room.fingerprint, sealed.fingerprint);
});

test("each sealing threshold gates approval as documented", async () => {
  const cases: [string, ("full" | "reservations" | "objection" | null)[], boolean][] = [
    ["consensus", ["full", "reservations", "full", "full"], true],
    ["consensus", ["full", "full", "full", "objection"], false],
    ["consensus", ["full", "full", "full", null], false],
    ["super75", ["full", "reservations", "full", "objection"], true],   // 3 of 4 = 75%
    ["super75", ["full", "reservations", "objection", "objection"], false],
    ["super66", ["full", "reservations", "objection"], true],            // 2 of 3
    ["super66", ["full", "objection", "objection"], false],
    ["super66", ["full", "full", null], true],                           // rewording counts against, still two thirds
  ];
  for (const [threshold, answers, passes] of cases) {
    const { room, seat, F } = setup(`T ${threshold}`, "anonymous", threshold);
    const ss = answers.map((_, i) => seat(`S${i}${S.uid(3)}`, `Role ${i}`));
    const item = await ok(F, "POST", `/api/facilitator/rooms/${room.id}/record`, { kind: "question", payload: { question: "Who pays?" } });
    // Until every seat answers, nothing passes, whatever the threshold.
    assert.equal((await call(F, "POST", `/api/facilitator/entries/${item.id}/approve`)).status, 400);
    for (let i = 0; i < answers.length; i++) {
      await ok(S.createSession("participant", ss[i].id), "POST", `/api/participant/consents/${item.id}`, { support: answers[i] });
    }
    const r = await call(F, "POST", `/api/facilitator/entries/${item.id}/approve`);
    assert.equal(r.status === 200, passes, `${threshold} ${answers.join(",")}: ${JSON.stringify(r.body)}`);
  }
});

test("tiers set the seat cap and turn length, and the cap is enforced", async () => {
  const { fac } = setup("tier host");
  const F = S.createSession("facilitator", fac.id);
  const crisis = await ok(F, "POST", "/api/facilitator/rooms", { title: "Cell", tier: "bilateral", seatCap: 99, turnSeconds: 10, sealThreshold: "super75" });
  assert.deepEqual([crisis.tier, crisis.seatCap, crisis.turnSeconds, crisis.sealThreshold], ["bilateral", 6, 120, "super75"]);
  const council = await ok(F, "POST", "/api/facilitator/rooms", { title: "Council" });
  assert.deepEqual([council.tier, council.seatCap, council.turnSeconds, council.sealThreshold], ["council", 8, 120, "consensus"]);
  const plenary = await ok(F, "POST", "/api/facilitator/rooms", { title: "Plenary", tier: "plenary", seatCap: 18, turnSeconds: 95 });
  assert.deepEqual([plenary.seatCap, plenary.turnSeconds], [18, 90]);

  // Admission stops at the cap.
  const { seats, rooms } = schema;
  const { eq } = await import("drizzle-orm");
  S.db.update(rooms).set({ status: "live", seatCap: 2 }).where(eq(rooms.id, crisis.id)).run();
  const mk = () => S.db.insert(seats).values({ roomId: crisis.id, token: S.uid(24), pseudonym: S.uid(4), claimedRole: "Party", status: "waiting", joinedAt: Date.now() }).returning().get();
  const [a, b, c] = [mk(), mk(), mk()];
  await ok(F, "POST", `/api/facilitator/seats/${a.id}/admit`);
  await ok(F, "POST", `/api/facilitator/seats/${b.id}/admit`);
  const full = await call(F, "POST", `/api/facilitator/seats/${c.id}/admit`);
  assert.equal(full.status, 400);
  assert.match(full.body.message, /full/);

  // Turns use the tier length; plenary turns cannot be extended.
  await ok(F, "POST", `/api/facilitator/rooms/${crisis.id}/floor`, { action: "start", seatId: a.id });
  const live = S.db.select().from(rooms).all().find((r) => r.id === crisis.id)!;
  assert.ok(Math.abs(live.floorEndsAt! - Date.now() - 120_000) < 2000);
  S.db.update(rooms).set({ status: "live" }).where(eq(rooms.id, plenary.id)).run();
  const p1 = S.db.insert(seats).values({ roomId: plenary.id, token: S.uid(24), pseudonym: "P1", claimedRole: "Party", status: "admitted", joinedAt: Date.now() }).returning().get();
  await ok(F, "POST", `/api/facilitator/rooms/${plenary.id}/floor`, { action: "start", seatId: p1.id });
  assert.equal((await call(F, "POST", `/api/facilitator/rooms/${plenary.id}/floor`, { action: "extend" })).status, 400);
});

test("rooms of seven or more show counts, only once every seat has answered; the seal records the choice", async () => {
  const { room, seat, F } = setup("Seven seats", "anonymous", "super75");
  const ss = Array.from({ length: 7 }, (_, i) => seat(`Big${i}${S.uid(3)}`, `Delegation ${i}`));
  const item = await ok(F, "POST", `/api/facilitator/rooms/${room.id}/record`, { kind: "question", payload: { question: "Who maintains the planters?" } });
  const answers = ["full", "full", "full", "full", "reservations", "objection", null] as const;
  for (let i = 0; i < 6; i++) {
    await ok(S.createSession("participant", ss[i].id), "POST", `/api/participant/consents/${item.id}`, { support: answers[i], reason: answers[i] === "objection" ? "Too slow" : undefined });
  }
  // Six of seven answered: still nothing about what they said.
  let row = (await ok(F, "GET", `/api/facilitator/rooms/${room.id}`)).entries.find((e: any) => e.id === item.id);
  assert.deepEqual([row.tally.responded, row.tally.required, row.tally.complete, row.tally.support, row.tally.consenting], [6, 7, false, null, null]);
  await ok(S.createSession("participant", ss[6].id), "POST", `/api/participant/consents/${item.id}`, { support: null });
  row = (await ok(F, "GET", `/api/facilitator/rooms/${room.id}`)).entries.find((e: any) => e.id === item.id);
  assert.equal(row.tally.detail, "counts");
  assert.deepEqual([row.tally.support.full, row.tally.support.reservations, row.tally.support.objection, row.tally.rewording, row.tally.consenting], [4, 1, 1, 1, 5]);
  // 5 of 7 is short of 75%: the message may carry numbers in a room this size.
  const short = await call(F, "POST", `/api/facilitator/entries/${item.id}/approve`);
  assert.match(short.body.message, /5 of 7 consent, 1 asked for rewording/);
  await ok(S.createSession("participant", ss[6].id), "POST", `/api/participant/consents/${item.id}`, { support: "full" });
  await ok(F, "POST", `/api/facilitator/entries/${item.id}/approve`); // 6 of 7; the objection stays on record as dissent
  await ok(F, "POST", `/api/facilitator/rooms/${room.id}/close`);
  await ok(F, "POST", `/api/facilitator/rooms/${room.id}/seal`);
  const pub = await ok(null, "GET", `/api/public/ledger/${room.code}`);
  assert.equal(pub.document.supportDetail, "counts");
  assert.deepEqual([pub.document.items[0].support.full, pub.document.items[0].support.objection], [5, 1]);
  assert.equal(await fingerprintFor(2, { document: pub.document }), pub.room.fingerprint);
  // Flipping the flag (or stripping counts) breaks verification.
  const forged = JSON.parse(JSON.stringify(pub.document));
  forged.supportDetail = "levels";
  assert.notEqual(await fingerprintFor(2, { document: forged }), pub.room.fingerprint);
});

test("small rooms never send counts to participants, the facilitator or the approve message", async () => {
  const { room, seat, F } = setup("Four seats", "anonymous", "consensus");
  const ss = Array.from({ length: 4 }, (_, i) => seat(`Sm${i}${S.uid(3)}`, `Party ${i}`));
  const item = await ok(F, "POST", `/api/facilitator/rooms/${room.id}/record`, { kind: "question", payload: { question: "Which streets first?" } });
  const P = ss.map((x) => S.createSession("participant", x.id));
  await ok(P[0], "POST", `/api/participant/consents/${item.id}`, { support: "full" });
  await ok(P[1], "POST", `/api/participant/consents/${item.id}`, { support: "reservations" });
  await ok(P[2], "POST", `/api/participant/consents/${item.id}`, { support: null });
  await ok(P[3], "POST", `/api/participant/consents/${item.id}`, { support: "full" });
  const held = await call(F, "POST", `/api/facilitator/entries/${item.id}/approve`);
  assert.equal(held.status, 400);
  assert.ok(!/\d/.test(held.body.message), `no numbers in "${held.body.message}"`);
  await ok(P[2], "POST", `/api/participant/consents/${item.id}`, { support: "reservations" });
  await ok(F, "POST", `/api/facilitator/entries/${item.id}/approve`);
  const pv = await ok(P[0], "GET", "/api/participant/room");
  const e = pv.entries.find((x: any) => x.id === item.id);
  assert.deepEqual(e.support, { level: "reservations", withReservations: true, withObjection: false, objections: [] });
  // The audit trail says only that a seat answered, never what.
  const fac = await ok(F, "GET", `/api/facilitator/rooms/${room.id}`);
  const actions = fac.audit.map((a: any) => a.action);
  assert.ok(actions.includes("record_item_answered"));
  assert.ok(!actions.some((a: string) => /rewording|consented/.test(a)));
});

/* ── Retention: "sealed ledgers outlive retention" ── */

const LONG_AGO = Date.now() - 400 * 86400000;

async function sealedV2(title: string) {
  const { room, agenda, seat, F } = setup(title);
  const a = seat("Ibis", "Harbour board");
  const item = await ok(F, "POST", `/api/facilitator/rooms/${room.id}/record`, { kind: "question", agendaItemId: agenda.id, payload: { question: "Who dredges the canal?" } });
  await ok(S.createSession("participant", a.id), "POST", `/api/participant/consents/${item.id}`, { support: "full" });
  await ok(F, "POST", `/api/facilitator/entries/${item.id}/approve`);
  // Ephemeral room data that retention must still remove: a seat's draft and a follow-through row.
  const { entries, entryVersions, rooms } = schema;
  const draft = S.db.insert(entries).values({ roomId: room.id, agendaItemId: agenda.id, kind: "issue", visibility: "all", status: "pending", authorSeatId: a.id, createdAt: Date.now() }).returning().get();
  S.db.insert(entryVersions).values({ entryId: draft.id, version: 1, text: "DRAFT-NEVER-AGREED", createdAt: Date.now() }).run();
  await ok(F, "POST", `/api/facilitator/rooms/${room.id}/followups`, { type: "commitment", text: "Publish dredging plan", dueDate: "2026-12-01" });
  await ok(F, "POST", `/api/facilitator/rooms/${room.id}/close`);
  const sealed = await ok(F, "POST", `/api/facilitator/rooms/${room.id}/seal`);
  const { eq } = await import("drizzle-orm");
  S.db.update(rooms).set({ sealedAt: LONG_AGO, purpose: "PURPOSE-TEXT" }).where(eq(rooms.id, room.id)).run();
  return { room, F, fingerprint: sealed.fingerprint as string };
}

async function sealedV1(title: string) {
  const { room, seat, F } = setup(title);
  const owl = seat("Owl", "Traders");
  const { entries, entryVersions, rooms } = schema;
  const e = S.db.insert(entries).values({ roomId: room.id, kind: "summary", visibility: "all", status: "approved", authorSeatId: owl.id, approvedAt: 1700000000000, createdAt: 1700000000000 }).returning().get();
  S.db.insert(entryVersions).values({ entryId: e.id, version: 1, text: "Crossing opens Tuesdays and Fridays.", createdAt: 1700000000000 }).run();
  const fp = S.sha256(S.canonicalLedger(S.buildLedger(room.id).rows));
  const { eq } = await import("drizzle-orm");
  S.db.update(rooms).set({ status: "sealed", fingerprint: fp, sealedAt: LONG_AGO }).where(eq(rooms.id, room.id)).run();
  return { room, F, fingerprint: fp };
}

function closedUnsealed(title: string) {
  const { room, seat } = setup(title);
  seat("Gull", "Fishers");
  const { rooms } = schema;
  return import("drizzle-orm").then(({ eq }) => {
    S.db.update(rooms).set({ status: "closed", createdAt: LONG_AGO }).where(eq(rooms.id, room.id)).run();
    return room;
  });
}

function leftovers(roomId: number) {
  const { seats, entries, agendaItems, followups, invites, notes, summaryVersions } = schema;
  const n = (t: any) => S.db.select().from(t).all().filter((r: any) => r.roomId === roomId).length;
  return { seats: n(seats), entries: n(entries), agenda: n(agendaItems), followups: n(followups), invites: n(invites), notes: n(notes), summaries: n(summaryVersions) };
}
const NONE = { seats: 0, entries: 0, agenda: 0, followups: 0, invites: 0, notes: 0, summaries: 0 };
async function setKept(on: boolean) {
  S.db.update(schema.platformSettings).set({ sealedLedgerKept: on ? 1 : 0 }).run();
}

test("kept on: sealed ledgers (v1 and v2) outlive retention and still verify; everything else for the room is purged", async () => {
  await setKept(true);
  const v2 = await sealedV2("Kept v2");
  const v1 = await sealedV1("Kept v1");
  const closed = await closedUnsealed("Closed, never sealed (kept on)");
  const report = S.purgeExpired();
  assert.ok(report.ledgersKept >= 2);
  assert.ok(report.rooms >= 1);

  for (const r of [v2, v1]) {
    const row = S.db.select().from(schema.rooms).all().find((x) => x.id === r.room.id)!;
    assert.ok(row, "room row survives");
    assert.ok(row.purgedAt, "marked as reduced to its ledger");
    assert.equal(row.purpose, null);
    assert.deepEqual(leftovers(r.room.id), NONE, "seats, drafts, consents, agenda, follow-through and summaries are gone");
    const pub = await ok(null, "GET", `/api/public/ledger/${r.room.code}`);
    assert.equal(pub.room.fingerprint, r.fingerprint);
    assert.equal(await fingerprintFor(pub.ledgerVersion, { rows: pub.rows, document: pub.document }), r.fingerprint);
    assert.ok(!JSON.stringify(pub).includes("DRAFT-NEVER-AGREED"));
    const exp = await ok(r.F, "GET", `/api/facilitator/rooms/${r.room.id}/export`);
    assert.equal(exp.room.fingerprint, r.fingerprint);
  }
  // v2 keeps its brief, follow-through as sealed included; v1 keeps its exact rows.
  const brief = await call(null, "GET", `/api/public/ledger/${v2.room.code}/brief.html`);
  assert.equal(brief.status, 200);
  assert.match(brief.body, /Who dredges the canal\?/);
  assert.match(brief.body, /Publish dredging plan/);
  assert.equal((await ok(null, "GET", `/api/public/ledger/${v1.room.code}`)).rows[0].text, "Crossing opens Tuesdays and Fridays.");
  // Unsealed closed rooms are wiped regardless.
  assert.equal(S.db.select().from(schema.rooms).all().some((x) => x.id === closed.id), false);
  assert.deepEqual(leftovers(closed.id), NONE);
  // The security log says what was kept.
  const ev = S.db.select().from(schema.securityEvents).all().filter((e) => e.kind === "purge").pop()!;
  assert.match(ev.detail ?? "", /sealed ledgers kept/);
  assert.match(ev.detail ?? "", /outlive retention: on/);
  // A second run does not touch or re-count rooms already reduced to their ledger.
  const again = S.purgeExpired();
  assert.equal(again.ledgersKept, 0);
  assert.equal((await ok(null, "GET", `/api/public/ledger/${v2.room.code}`)).room.fingerprint, v2.fingerprint);
});

test("kept off: sealed rooms past retention are wiped entirely, like closed ones", async () => {
  await setKept(false);
  try {
    const v2 = await sealedV2("Wiped v2");
    const v1 = await sealedV1("Wiped v1");
    const closed = await closedUnsealed("Closed, never sealed (kept off)");
    const report = S.purgeExpired();
    assert.equal(report.ledgersKept, 0);
    assert.ok(report.rooms >= 3);
    for (const r of [v2.room, v1.room, closed]) {
      assert.equal(S.db.select().from(schema.rooms).all().some((x) => x.id === r.id), false);
      assert.deepEqual(leftovers(r.id), NONE);
    }
    assert.equal((await call(null, "GET", `/api/public/ledger/${v2.room.code}`)).status, 404);
    const ev = S.db.select().from(schema.securityEvents).all().filter((e) => e.kind === "purge").pop()!;
    assert.match(ev.detail ?? "", /outlive retention: off/);
  } finally {
    await setKept(true);
  }
});
