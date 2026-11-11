/*
 * Ledger v2 canonical form: deterministic bytes, stable fingerprints, and
 * v1 seals that still verify exactly as before.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  canonicalJson, canonicalLedgerV1, buildDocV2, fingerprintFor, normText, normDate, safeUrl,
  validateRecord, aggregateSupport, type LedgerItemV2, type LedgerRowV1,
} from "../shared/ledger";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// The v1 canonical form exactly as it shipped (server/storage.ts before ledger v2).
function canonicalV1AsShipped(rows: LedgerRowV1[]): string {
  return JSON.stringify(rows.slice().sort((a, b) => a.id - b.id).map((r) => ({
    agenda: r.agenda ?? null, approvedAt: r.approvedAt, author: r.author, id: r.id, kind: r.kind, text: r.text,
  })));
}

test("same content gives the same bytes and hash, whatever the key order", () => {
  const a = { b: 1, a: { d: "two  spaces\r\nand CRLF ", c: [1, "x"] }, z: null, u: undefined };
  const b = { z: null, a: { c: [1, "x"], d: "two spaces\nand CRLF" }, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(sha(canonicalJson(a)), sha(canonicalJson(b)));
  assert.equal(canonicalJson(a), '{"a":{"c":[1,"x"],"d":"two spaces\\nand CRLF"},"b":1,"z":null}');
});

test("string and date normalisation is stable and idempotent", () => {
  const messy = "  Caf\u0065\u0301 \t terrace \n\n\n\n next  ";
  assert.equal(normText(messy), "Café terrace\n\nnext");
  assert.equal(normText(normText(messy)), normText(messy));
  assert.equal(normDate("2026-02-29"), null);
  assert.equal(normDate("2028-02-29"), "2028-02-29");
  assert.equal(normDate("2026-06-01T10:00:00Z"), "2026-06-01");
  assert.equal(normDate("June 1"), null);
});

const item = (id: number, over: Partial<LedgerItemV2> = {}): LedgerItemV2 => ({
  id, kind: "agreement", agenda: "Drainage", author: "Facilitator", approvedAt: 1_760_000_000_000 + id, text: `item ${id}`,
  payload: { action: `Act ${id}`, owner: "City utilities", deadline: "2026-09-30", resources: "", measure: "" },
  support: { level: "full", full: 3, reservations: 0, objection: 0, objections: [] }, carriedFrom: null, ...over,
});

test("the v2 document is independent of input order and fingerprints identically", async () => {
  const base = { room: { code: "ROOM42", title: "Heat & flood" }, sealedAt: 1_760_100_000_000, summary: null };
  const f = [{ id: 2, type: "pledge", text: "Publish gauges", owner: "Kestrel", dueDate: "2026-07-01", status: "open", outcome: null },
    { id: 1, type: "commitment", text: "Map shops", owner: "Wren", dueDate: null, status: "kept", outcome: "Done" }];
  const d1 = buildDocV2({ ...base, items: [item(1), item(2), item(3)], followups: f });
  const d2 = buildDocV2({ ...base, items: [item(3), item(1), item(2)], followups: f.slice().reverse() });
  assert.equal(canonicalJson(d1), canonicalJson(d2));
  assert.equal(await fingerprintFor(2, { document: d1 }), sha(canonicalJson(d2)));
  assert.equal(d1.ledgerVersion, 2);
  assert.equal(d1.sealedAt, "2025-10-10T12:40:00.000Z");
  // Re-canonicalising a parsed, key-shuffled copy (what a browser does) gives the same bytes.
  const parsed = JSON.parse(canonicalJson(d1));
  const shuffled = Object.fromEntries(Object.entries(parsed).reverse());
  assert.equal(canonicalJson(shuffled), canonicalJson(d1));
  // Any change to agreed content changes the fingerprint.
  const d3 = buildDocV2({ ...base, items: [item(1), item(2, { text: "item 2!" }), item(3)], followups: f });
  assert.notEqual(canonicalJson(d3), canonicalJson(d1));
});

test("v1 canonical form is byte-for-byte unchanged, and v1 fingerprints verify on the v1 branch", async () => {
  const rows: LedgerRowV1[] = [
    { id: 7, kind: "summary", text: "Crossing opens Tuesdays.", author: "Facilitator", agenda: "Crossing days", approvedAt: 1700000000000 },
    { id: 3, kind: "issue", text: "  untrimmed  text  ", author: "Owl", agenda: null, approvedAt: 1699999999999 },
  ];
  assert.equal(canonicalLedgerV1(rows), canonicalV1AsShipped(rows));
  const fp = sha(canonicalV1AsShipped(rows));
  assert.equal(await fingerprintFor(1, { rows }), fp);
  assert.equal(await fingerprintFor(null, { rows }), fp);
  // v1 never normalised text: the v2 rules must not leak into the v1 branch.
  assert.notEqual(await fingerprintFor(2, { document: rows }), fp);
});

test("links must be full http(s) addresses without credentials", () => {
  assert.equal(safeUrl("https://example.org/report?id=3"), "https://example.org/report?id=3");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("ftp://example.org/x"), null);
  assert.equal(safeUrl("https://user:pw@example.org"), null);
  assert.equal(safeUrl("example.org"), null);
  assert.equal(safeUrl("https://intranet"), null);
  const ctx = { anonymityMode: "anonymous", personLabels: [], hiddenNames: [] };
  assert.equal(validateRecord("evidence", { summary: "x", url: "javascript:alert(1)" }, ctx).ok, false);
  const ok = validateRecord("evidence", { summary: "Gauge data", url: " https://example.org/g " }, ctx);
  assert.ok(ok.ok && (ok.payload as any).url === "https://example.org/g");
});

test("positions are attributed to roles, never to people the room keeps anonymous", () => {
  const anon = { anonymityMode: "anonymous", personLabels: ["Heron", "Kestrel"], hiddenNames: [] };
  assert.equal(validateRecord("position", { party: "heron", wants: "x" }, anon).ok, false);
  assert.equal(validateRecord("position", { party: "Residents' association", wants: "x" }, anon).ok, true);
  const open = { anonymityMode: "open", personLabels: ["Seat 1A"], hiddenNames: ["Nadia Haddad"] };
  assert.equal(validateRecord("position", { party: "Nadia Haddad", wants: "x" }, open).ok, false);
  assert.equal(validateRecord("position", { party: "Amara Okafor", wants: "x" }, open).ok, true); // chose her real name
  assert.equal(validateRecord("agreement", { action: "x", owner: "Nadia Haddad" }, open).ok, false);
  assert.equal(validateRecord("agreement", { action: "x", owner: "Kestrel", deadline: "2026-13-01" }, anon).ok, false);
  assert.equal(validateRecord("problem", { statement: "x", scale: "planet" }, anon).ok, false);
  assert.equal(validateRecord("bogus", {}, anon).ok, false);
});

test("support aggregates without naming objectors unless they chose real names", () => {
  const s = aggregateSupport([
    { support: "full" }, { support: "reservations" }, { support: "objection", reason: "Too slow" },
    { support: "objection", reason: "", name: "Amara Okafor" }, { support: null },
  ])!;
  assert.deepEqual({ ...s, objections: undefined }, { level: "objection", full: 1, reservations: 1, objection: 2, objections: undefined });
  assert.deepEqual(s.objections, [{ reason: "", by: "Amara Okafor" }, { reason: "Too slow" }]);
  assert.equal(aggregateSupport([{ support: "full" }, { support: "full" }])!.level, "full");
  assert.equal(aggregateSupport([]), null);
});

import { decide, tierSettings, cycleSeconds, formatMinutes } from "../shared/tiers";

test("thresholds: consensus needs zero objections; supermajorities count full + reservations", () => {
  const t = (full: number, reservations: number, objection: number, rewording: number, required = full + reservations + objection + rewording) =>
    ({ full, reservations, objection, rewording, required });
  assert.equal(decide("consensus", t(3, 1, 0, 0)).passed, true);
  assert.equal(decide("consensus", t(3, 0, 1, 0)).blocker, "objection");
  assert.equal(decide("consensus", t(3, 0, 0, 1)).blocker, "rewording");
  assert.equal(decide("consensus", t(2, 0, 0, 0, 3)).blocker, "waiting");
  assert.equal(decide("super75", t(2, 1, 1, 0)).passed, true);   // 75%
  assert.equal(decide("super75", t(5, 0, 2, 0)).passed, false);  // 71%
  assert.equal(decide("super66", t(1, 1, 1, 0)).passed, true);   // 66.7%
  assert.equal(decide("super66", t(3, 0, 2, 0)).passed, false);  // 60%
  assert.equal(decide("super66", t(13, 0, 7, 0)).passed, false); // 65% is short of two thirds
  assert.equal(decide("nonsense", t(1, 0, 1, 0)).passed, false); // unknown falls back to consensus
});

test("tier settings clamp to each tier's ranges and the cycle estimate is seats × turn", () => {
  assert.deepEqual(tierSettings("bilateral"), { seatCap: 2, turnSeconds: 150 });
  assert.deepEqual(tierSettings("bilateral", 9, 600), { seatCap: 6, turnSeconds: 180 });
  assert.deepEqual(tierSettings("council", 3, 150), { seatCap: 7, turnSeconds: 150 });
  assert.deepEqual(tierSettings("plenary", 25), { seatCap: 20, turnSeconds: 90 });
  assert.equal(formatMinutes(cycleSeconds(12, 150)), "30 min");
  assert.equal(formatMinutes(150), "2.5 min");
});

import { buildDocV2 as build2, canonicalJson as cj, supportDetailFor, levelsOnly } from "../shared/ledger";

test("levels only below seven seats, and the flag is part of the canonical ledger", () => {
  assert.equal(supportDetailFor(6), "levels");
  assert.equal(supportDetailFor(7), "counts");
  const counts = { level: "objection" as const, full: 2, reservations: 1, objection: 2, objections: [{ reason: "Too slow" }, { reason: "Too slow" }] };
  assert.deepEqual(levelsOnly(counts), { level: "objection", withReservations: true, withObjection: true, objections: [{ reason: "Too slow" }] });
  const item = { id: 1, kind: "question", agenda: null, author: "Facilitator", approvedAt: 0, text: "Q", payload: { question: "Q", research: "" }, support: counts, carriedFrom: null };
  const base = { room: { code: "ABC123", title: "T" }, sealedAt: 0, items: [item], summary: null, followups: [] };
  const lv = build2({ ...base, supportDetail: "levels" });
  // Even if a caller passes counts, a levels ledger carries none.
  assert.ok(!/"(full|reservations|objection)":\d/.test(cj(lv)));
  assert.equal(lv.supportDetail, "levels");
  assert.equal(cj(lv), cj(build2({ ...base, supportDetail: "levels" })));
  assert.notEqual(cj(lv), cj(build2({ ...base, supportDetail: "counts" })));
});
