/*
 * Chat UI logic that has security weight: how lines are grouped under a
 * sender header, and that translation stays on the device.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildItems } from "../client/src/components/chat/group";
import type { ChatLine } from "../client/src/lib/e2ee-client";

const T0 = new Date(2026, 10, 9, 10, 0).getTime();
const line = (seq: number, over: Partial<Extract<ChatLine, { text: string }>> = {}): ChatLine => ({
  seq, name: "Heron", text: `line ${seq}`, sentAt: T0 + seq * 1000, verified: true, from: 1, mine: false, ...over,
});
const day = () => "Today";

test("consecutive lines from one verified sender share a header", () => {
  const items = buildItems([line(1), line(2), line(3)], "Facilitator", day);
  assert.deepEqual(items.map((i) => i.kind), ["day", "group"]);
  const g = items[1] as Extract<ReturnType<typeof buildItems>[number], { kind: "group" }>;
  assert.equal(g.lines.length, 3);
});

test("an unverified line never joins a verified sender's group, even with the same name", () => {
  const items = buildItems([line(1), line(2, { verified: false, from: null }), line(3)], "Facilitator", day);
  const groups = items.filter((i) => i.kind === "group") as any[];
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((g) => g.verified), [true, false, true]);
});

test("own lines, other seats, gaps over five minutes and new days start new groups", () => {
  const items = buildItems([
    line(1),
    line(2, { mine: true, name: "Kestrel", from: 2 }),
    line(3, { from: 3, name: "Heron" }), // same name, different certified seat
    line(4, { from: 3, name: "Heron", sentAt: T0 + 10 * 60 * 1000 }),
    line(5, { from: 3, name: "Heron", sentAt: T0 + 26 * 3600 * 1000 }),
  ], "Facilitator", (ms) => new Date(ms).toDateString());
  assert.deepEqual(items.map((i) => i.kind), ["day", "group", "group", "group", "group", "day", "group"]);
});

test("unreadable lines break groups and are kept in order", () => {
  const items = buildItems([line(1), { seq: 2, unreadable: true }, line(3)], "Facilitator", day);
  assert.deepEqual(items.map((i) => i.kind), ["day", "group", "system", "group"]);
});

test("the facilitator style needs a verified facilitator line, not a claimed name", () => {
  const items = buildItems([
    line(1, { from: "facilitator", name: "Facilitator" }),
    line(2, { from: null, verified: false, name: "Facilitator" }),
  ], "Facilitator", day) as any[];
  const groups = items.filter((i) => i.kind === "group");
  assert.deepEqual(groups.map((g) => g.facilitator), [true, false]);
});

/* ── Translation ── */

const g = globalThis as any;
let fetched = 0;
beforeEach(() => {
  delete g.Translator;
  delete g.LanguageDetector;
  fetched = 0;
  g.fetch = async () => { fetched++; throw new Error("no network in translation"); };
});

async function freshTranslate() {
  // Each test gets its own module state (caches, the once-per-session note).
  return import(`../client/src/lib/translate.ts?${Math.random()}`) as Promise<typeof import("../client/src/lib/translate")>;
}

function stubApis(opts: { detect?: string; pair?: string; detector?: string } = {}) {
  const calls: string[] = [];
  g.LanguageDetector = {
    availability: async () => opts.detector ?? "available",
    create: async () => ({ detect: async () => [{ detectedLanguage: opts.detect ?? "fr", confidence: 0.95 }] }),
  };
  g.Translator = {
    availability: async (o: any) => { calls.push(`avail ${o.sourceLanguage}>${o.targetLanguage}`); return opts.pair ?? "available"; },
    create: async (o: any) => {
      calls.push(`create ${o.sourceLanguage}>${o.targetLanguage}`);
      return { translate: async (t: string) => { calls.push(`translate ${t}`); return `[en] ${t}`; } };
    },
  };
  return calls;
}

test("no browser API: unavailable, and the note is raised once per session", async () => {
  const tr = await freshTranslate();
  assert.equal(tr.translationApiPresent(), false);
  assert.deepEqual(await tr.translateIncoming("1", "Bonjour à tous", "en"), { kind: "unavailable" });
  let changes = 0;
  tr.subscribeUnavailable(() => changes++);
  tr.reportUnavailable();
  tr.reportUnavailable();
  assert.equal(changes, 1);
  assert.equal(tr.unavailableNoteVisible(), true);
  tr.dismissUnavailableNote();
  assert.equal(tr.unavailableNoteVisible(), false);
  tr.reportUnavailable();
  assert.equal(tr.unavailableNoteVisible(), false);
  assert.equal(fetched, 0);
});

test("translates into the reader's language on the device and caches per message", async () => {
  const tr = await freshTranslate();
  const calls = stubApis({ detect: "fr" });
  const a = await tr.translateIncoming("7", "Bonjour à tous", "en");
  const b = await tr.translateIncoming("7", "Bonjour à tous", "en");
  assert.deepEqual(a, { kind: "translated", text: "[en] Bonjour à tous", from: "fr" });
  assert.deepEqual(b, a);
  assert.equal(calls.filter((c) => c.startsWith("translate")).length, 1);
  assert.equal(fetched, 0);
});

test("same language, or a region variant of it, is left alone", async () => {
  const tr = await freshTranslate();
  const calls = stubApis({ detect: "en-GB" });
  assert.deepEqual(await tr.translateIncoming("8", "Good morning", "en"), { kind: "same" });
  assert.equal(calls.length, 0);
});

test("never triggers a model download: downloadable models count as unavailable", async () => {
  const tr = await freshTranslate();
  const calls = stubApis({ detect: "ar", pair: "downloadable" });
  assert.deepEqual(await tr.translateIncoming("9", "صباح الخير", "fr"), { kind: "unavailable" });
  assert.ok(!calls.some((c) => c.startsWith("create")));
  const tr2 = await freshTranslate();
  stubApis({ detector: "downloadable" });
  assert.deepEqual(await tr2.translateIncoming("10", "Hola a todos", "en"), { kind: "unavailable" });
  assert.equal(fetched, 0);
});
