import { createHash, randomBytes } from "node:crypto";
import {
  platformSettings, admins, facilitators, facilitatorApplications, enrolmentLinks,
  blockedCountries, securityEvents, rooms, seats, entries, entryVersions,
  invites, agendaItems, followups, notes, auditLog, consents, dataRequests,
  loginCodes, summaryVersions, summaryConfirmations,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, lt, gt, isNull, inArray, desc } from "drizzle-orm";
import {
  canonicalLedgerV1, canonicalJson, buildDocV2, aggregateSupport, isRecordKind, parsePayload, recordText,
  type LedgerDocV2, type LedgerItemV2, type RecordContext, type Support, type SupportLevel, type SupportDetail, type SupportView, supportDetailFor, viewSupport,
  type ConditionPayload, type QuestionPayload, type AgreementPayload,
} from "@shared/ledger";
import { decide, type Decision } from "@shared/tiers";

const sqlite = new Database(process.env.APERTURE_DB || "data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

/* ── Sessions (in-memory, like anonymous sessions in the spec) ── */

export type Session = {
  role: "admin" | "facilitator" | "participant";
  id: number; // adminId | facilitatorId | seatId
  token: string;
  lastSeen: number;
  /** Opened by /api/demo/start: confined to demo data, refused when demos are off. */
  demo?: boolean;
};
const IDLE_MS = { admin: 12 * 3600_000, facilitator: 12 * 3600_000, participant: 4 * 3600_000 };

const sessions = new Map<string, Session>();

export function createSession(role: Session["role"], id: number, opts: { demo?: boolean } = {}): string {
  const token = randomBytes(24).toString("hex");
  sessions.set(token, { role, id, token, lastSeen: Date.now(), ...(opts.demo ? { demo: true } : {}) });
  return token;
}

export function getSession(token?: string): Session | undefined {
  if (!token) return undefined;
  const s = sessions.get(token);
  if (!s) return undefined;
  if (Date.now() - s.lastSeen > IDLE_MS[s.role]) {
    sessions.delete(token);
    return undefined;
  }
  s.lastSeen = Date.now();
  return s;
}

export function destroySession(token: string) {
  sessions.delete(token);
}

export function uid(len = 8): string {
  return randomBytes(len).toString("hex").slice(0, len);
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function now(): number {
  return Date.now();
}

export const DAY = 86400000;

/* ── Canonical ledger serialization + fingerprint ── */

export type LedgerRow = {
  id: number;
  kind: string;
  text: string;
  author: string;
  agenda: string | null;
  approvedAt: number;
};

/** v1 canonical form. Unchanged since the first seal: old fingerprints depend on it. */
export function canonicalLedger(rows: LedgerRow[]): string {
  return canonicalLedgerV1(rows);
}

/* ── Seat display label ── */

export function seatLabel(seat: typeof seats.$inferSelect): string {
  if (seat.useRealName && seat.realName) return seat.realName;
  return seat.pseudonym;
}

/* ── Audit + security ── */

// The audit log carries no content — but it is hash-chained, so anyone can
// confirm the trail was not edited after the fact. The chain is the evidence.
export function audit(roomId: number | null, actor: string, action: string) {
  const prev = db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1).get();
  const prevHash = prev?.hash ?? null;
  const createdAt = now();
  const hash = sha256(`${prevHash ?? "genesis"}|${roomId ?? ""}|${actor}|${action}|${createdAt}`);
  db.insert(auditLog).values({ roomId, actor, action, prevHash, hash, createdAt }).run();
  return hash;
}

export function auditHead(): string | null {
  const prev = db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1).get();
  return prev?.hash ?? null;
}

export function auditVerify(): { total: number; intact: boolean } {
  const rows = db.select().from(auditLog).orderBy(auditLog.id).all();
  let prev: string | null = null;
  for (const r of rows) {
    // Rows written before the chain columns existed carry no hash — the
    // verifiable chain starts at the first hashed row (genesis link).
    if (!r.hash) continue;
    const expect = sha256(`${prev ?? "genesis"}|${r.roomId ?? ""}|${r.actor}|${r.action}|${r.createdAt}`);
    if (r.hash !== expect) return { total: rows.length, intact: false };
    prev = r.hash;
  }
  return { total: rows.length, intact: true };
}

export function security(kind: string, detail: string) {
  // Coarsened to the hour: enough for incident review, too blunt to
  // reconstruct who was online when.
  const hour = 3600_000;
  db.insert(securityEvents).values({ kind, detail, createdAt: Math.floor(now() / hour) * hour }).run();
}

/* ── Ephemeral, end-to-end encrypted chat relay ──
   The server holds only ciphertext. No sender, no label, no timestamp is
   stored — just a sequence number, the key epoch, and padded bytes. It all
   lives in process memory and dies with the room. */

export type ChatCipherMsg = { seq: number; channel: string; epoch: number; iv: string; ct: string };
const chatRooms = new Map<number, ChatCipherMsg[]>();
let chatSeq = 0;

export function chatPush(roomId: number, msg: Omit<ChatCipherMsg, "seq">) {
  const list = chatRooms.get(roomId) ?? [];
  list.push({ ...msg, seq: ++chatSeq });
  if (list.length > 200) list.splice(0, list.length - 200); // memory only
  chatRooms.set(roomId, list);
}

export function chatRecent(roomId: number, channel: string): ChatCipherMsg[] {
  return (chatRooms.get(roomId) ?? []).filter((m) => m.channel === channel).slice(-50);
}

export function chatWipe(roomId: number) {
  chatRooms.delete(roomId);
  roomCrypto.delete(roomId);
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
export function isB64(s: unknown, max: number): s is string {
  return typeof s === "string" && s.length > 0 && s.length <= max && B64.test(s);
}

/* ── Key directory (public keys + wrapped room keys, memory only) ── */

export type Wrap = { epoch: number; pubHash: string; eph: string; iv: string; ct: string; sig: string };
/** Signed on the facilitator's device; the server only relays it. */
export type SenderCert = { seatId: number; label: string; signPub: string; sig: string };
export type RoomCrypto = {
  epoch: number;
  seatPubs: Map<number, string>;
  signPubs: Map<number, string>;
  certs: Map<number, SenderCert>;
  wraps: Map<number, Wrap>;
  rekeyNeeded: boolean;
};
const roomCrypto = new Map<number, RoomCrypto>();

export function cryptoFor(roomId: number): RoomCrypto {
  let c = roomCrypto.get(roomId);
  if (!c) {
    c = { epoch: 0, seatPubs: new Map(), signPubs: new Map(), certs: new Map(), wraps: new Map(), rekeyNeeded: false };
    roomCrypto.set(roomId, c);
  }
  return c;
}

/** Current certificates only: the cert must match the seat's uploaded signing key. */
export function rosterFor(roomId: number, seatIds: number[]): SenderCert[] {
  const c = cryptoFor(roomId);
  return seatIds.flatMap((id) => {
    const cert = c.certs.get(id);
    return cert && cert.signPub === c.signPubs.get(id) ? [cert] : [];
  });
}

export function serverPubHash(pub: string) {
  return createHash("sha256").update(Buffer.from(pub, "base64")).digest("base64").slice(0, 16);
}

export function tokenHash(token: string) {
  return createHash("sha256").update(normInvite(token)).digest("base64");
}
export function normInvite(token: string) {
  return String(token).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/* ── Redaction check (pattern + heuristic AI pass) ── */

const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/g, label: "email" },
  { re: /(?:\+?\d[\d\s().-]{7,}\d)/g, label: "phone" },
  { re: /@[\w.]{3,}/g, label: "handle" },
  { re: /https?:\/\/\S+/g, label: "url" },
  { re: /\b\d{1,5}\s+[A-Z][a-z]+\s+(?:Street|St|Ave|Avenue|Road|Rd|Blvd|Lane|Ln|Drive|Dr)\b/g, label: "address" },
];

export type RedactionFlag = { start: number; end: number; label: string };

export function redactCheck(text: string): RedactionFlag[] {
  const flags: RedactionFlag[] = [];
  for (const { re, label } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].trim().length < 2) continue;
      flags.push({ start: m.index, end: m.index + m[0].length, label });
    }
  }
  return flags.sort((a, b) => a.start - b.start);
}

/* ── Seed ── */

export function seed() {
  // Self-hosters name their first administrator; sign-in codes go to this address.
  const ownerEmail = process.env.APERTURE_ADMIN_EMAIL?.trim().toLowerCase();
  if (ownerEmail && !db.select().from(admins).where(eq(admins.email, ownerEmail)).get()) {
    db.insert(admins).values({ email: ownerEmail, createdAt: now() }).run();
  }
  const s = db.select().from(platformSettings).get();
  if (s) return;

  db.insert(platformSettings).values({
    id: 1,
    orgName: "Diavanish",
    defaultTurnMinutes: 7,
    requireRoleProofsDefault: 0,
    closedRoomRetentionDays: 30,
    guestSessionRetentionDays: 3,
    applicationRetentionDays: 90,
    sealedLedgerKept: 1,
  }).run();

  // Built-in first administrator, for local runs only. A host that names its own
  // administrator (APERTURE_ADMIN_EMAIL) must not also get an account at the
  // project's address: that mailbox belongs to someone else on a self-hosted install.
  if (!ownerEmail) {
    db.insert(admins).values({ email: "admin@diavanish.org", createdAt: now() }).run();
  }

  for (const c of [
    { code: "SY", name: "Syria" },
    { code: "KP", name: "North Korea" },
    { code: "IR", name: "Iran" },
  ]) {
    db.insert(blockedCountries).values(c).run();
  }

  db.insert(facilitatorApplications).values({
    name: "R. Halabi",
    affiliation: "Mediation Network",
    email: "r.halabi@example.org",
    country: "Lebanon",
    experience: "Twelve years facilitating cross-community dialogue in the Levant.",
    status: "pending",
    createdAt: now() - 2 * DAY,
  }).run();

  db.insert(securityEvents).values([
    { kind: "signin", detail: "Administrator signed in with a one-time link", createdAt: now() - 6 * 3600000 },
    { kind: "purge", detail: "Nightly purge completed", createdAt: now() - DAY },
  ]).run();
}

/* ── Retention engine ── */

export function closeExpiredRooms() {
  const live = db.select().from(rooms)
    .where(and(eq(rooms.status, "live"), lt(rooms.expiresAt, now()))).all();
  for (const r of live) {
    db.update(rooms).set({ status: "closed", floorState: "idle", floorSeatId: null, floorEndsAt: null })
      .where(eq(rooms.id, r.id)).run();
    chatWipe(r.id);
    audit(r.id, "system", "room_closed_expired");
  }
  return live.length;
}

export type PurgeReport = { rooms: number; ledgersKept: number; guestSessions: number; applications: number };

export function purgeExpired(): PurgeReport {
  const settings = db.select().from(platformSettings).get()!;
  const report: PurgeReport = { rooms: 0, ledgersKept: 0, guestSessions: 0, applications: 0 };
  // "Sealed ledgers outlive retention" (admin toggle, on by default).
  const keepSealed = !!settings.sealedLedgerKept;

  // Closed and sealed rooms past retention
  const closed = db.select().from(rooms)
    .where(inArray(rooms.status, ["closed", "sealed"])).all();
  for (const r of closed) {
    const days = r.retentionDays ?? settings.closedRoomRetentionDays;
    const base = r.sealedAt ?? r.createdAt;
    if (base + days * DAY >= now()) continue;
    if (r.status === "sealed" && keepSealed) {
      // Keep only what verify, the brief and the export need; everything else goes on schedule.
      if (r.purgedAt) continue; // already reduced to its ledger
      stripRoomToLedger(r.id);
      report.ledgersKept++;
    } else {
      wipeRoom(r.id);
      report.rooms++;
    }
  }

  // Inactive guest sessions (waiting seats never admitted)
  const stale = db.select().from(seats)
    .where(and(eq(seats.status, "waiting"), lt(seats.joinedAt, now() - settings.guestSessionRetentionDays * DAY))).all();
  for (const seat of stale) {
    db.delete(seats).where(eq(seats.id, seat.id)).run();
    report.guestSessions++;
  }

  // Decided applications past retention
  const apps = db.select().from(facilitatorApplications)
    .where(inArray(facilitatorApplications.status, ["approved", "rejected"])).all();
  for (const a of apps) {
    if (a.decidedAt && a.decidedAt + settings.applicationRetentionDays * DAY < now()) {
      db.delete(facilitatorApplications).where(eq(facilitatorApplications.id, a.id)).run();
      report.applications++;
    }
  }

  security("purge", `Nightly purge: ${report.rooms} rooms wiped; ${report.ledgersKept} sealed ledgers kept (${keepSealed ? "sealed ledgers outlive retention: on; seats, drafts, consents, agenda, notes, summaries and follow-through removed" : "sealed ledgers outlive retention: off"}); ${report.guestSessions} guest sessions; ${report.applications} applications`);
  return report;
}

export function wipeRoom(roomId: number) {
  const eids = db.select().from(entries).where(eq(entries.roomId, roomId)).all().map((e) => e.id);
  if (eids.length) {
    for (const id of eids) {
      db.delete(entryVersions).where(eq(entryVersions.entryId, id)).run();
      db.delete(consents).where(eq(consents.entryId, id)).run();
    }
    db.delete(entries).where(eq(entries.roomId, roomId)).run();
  }
  db.delete(seats).where(eq(seats.roomId, roomId)).run();
  db.delete(invites).where(eq(invites.roomId, roomId)).run();
  db.delete(agendaItems).where(eq(agendaItems.roomId, roomId)).run();
  db.delete(followups).where(eq(followups.roomId, roomId)).run();
  db.delete(notes).where(eq(notes.roomId, roomId)).run();
  const svIds = db.select().from(summaryVersions).where(eq(summaryVersions.roomId, roomId)).all().map((s) => s.id);
  for (const id of svIds) {
    db.delete(summaryConfirmations).where(eq(summaryConfirmations.summaryVersionId, id)).run();
  }
  db.delete(summaryVersions).where(eq(summaryVersions.roomId, roomId)).run();
  db.delete(rooms).where(eq(rooms.id, roomId)).run();
  audit(null, "system", `room_${roomId}_wiped`);
  chatWipe(roomId);
}

/**
 * Retention for a sealed room when "sealed ledgers outlive retention" is on.
 * The room row stays with exactly what verification, the brief and the export
 * read: code, title, seal (fingerprint, sealedAt, chain head, destruction
 * certificate) and the sealed ledger itself. v2 rooms already hold their
 * canonical document in `sealed_ledger`; for v1 rooms the approved rows are
 * frozen there first as `{ ledgerVersion: 1, rows }`, byte-for-byte the rows
 * the v1 fingerprint covers. Then every other table for the room is emptied,
 * like wipeRoom: seats, invites, entries and versions (drafts included),
 * consents, agenda, notes, summaries and follow-through. Free-text room fields
 * outside the ledger (purpose, schedule) are cleared too.
 */
export function stripRoomToLedger(roomId: number) {
  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get();
  if (!room || room.status !== "sealed") return;
  let sealedLedger = room.sealedLedger;
  if (room.ledgerVersion !== 2 && !v1Snapshot(room)) {
    sealedLedger = JSON.stringify({ ledgerVersion: 1, rows: buildLedger(roomId).rows });
  }
  // Same deletions as a wipe, minus the room row.
  const eids = db.select().from(entries).where(eq(entries.roomId, roomId)).all().map((e) => e.id);
  for (const id of eids) {
    db.delete(entryVersions).where(eq(entryVersions.entryId, id)).run();
    db.delete(consents).where(eq(consents.entryId, id)).run();
  }
  db.delete(entries).where(eq(entries.roomId, roomId)).run();
  db.delete(seats).where(eq(seats.roomId, roomId)).run();
  db.delete(invites).where(eq(invites.roomId, roomId)).run();
  db.delete(agendaItems).where(eq(agendaItems.roomId, roomId)).run();
  db.delete(followups).where(eq(followups.roomId, roomId)).run();
  db.delete(notes).where(eq(notes.roomId, roomId)).run();
  const svIds = db.select().from(summaryVersions).where(eq(summaryVersions.roomId, roomId)).all().map((s) => s.id);
  for (const id of svIds) db.delete(summaryConfirmations).where(eq(summaryConfirmations.summaryVersionId, id)).run();
  db.delete(summaryVersions).where(eq(summaryVersions.roomId, roomId)).run();
  db.update(rooms).set({
    sealedLedger, purgedAt: now(), purpose: null, sessionAt: null,
    floorSeatId: null, floorEndsAt: null, caucusSeatId: null,
  }).where(eq(rooms.id, roomId)).run();
  audit(null, "system", `room_${roomId}_reduced_to_sealed_ledger`);
  chatWipe(roomId);
}

/** A v1 ledger frozen at retention time, if there is one. */
function v1Snapshot(room: typeof rooms.$inferSelect): LedgerRow[] | null {
  if (room.ledgerVersion === 2 || !room.sealedLedger) return null;
  try {
    const s = JSON.parse(room.sealedLedger);
    return s?.ledgerVersion === 1 && Array.isArray(s.rows) ? s.rows : null;
  } catch { return null; }
}

/* ── Ledger build ── */

export function buildLedger(roomId: number): { rows: LedgerRow[]; fingerprint: string | null } {
  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get();
  if (!room) return { rows: [], fingerprint: null };
  const frozen = v1Snapshot(room);
  if (frozen) return { rows: frozen, fingerprint: room.fingerprint };
  const approved = db.select().from(entries)
    .where(and(eq(entries.roomId, roomId), eq(entries.status, "approved"))).all()
    .sort((a, b) => a.id - b.id);
  const rows: LedgerRow[] = [];
  for (const e of approved) {
    const v = db.select().from(entryVersions)
      .where(and(eq(entryVersions.entryId, e.id), eq(entryVersions.version, e.currentVersion))).get();
    if (!v) continue;
    let author = "Facilitator";
    if (e.authorSeatId) {
      const seat = db.select().from(seats).where(eq(seats.id, e.authorSeatId)).get();
      if (seat) author = seatLabel(seat);
    }
    let agenda: string | null = null;
    if (e.agendaItemId) {
      const item = db.select().from(agendaItems).where(eq(agendaItems.id, e.agendaItemId)).get();
      if (item) agenda = item.title;
    }
    rows.push({ id: e.id, kind: e.kind, text: v.text, author, agenda, approvedAt: e.approvedAt ?? e.createdAt });
  }
  return { rows, fingerprint: room.fingerprint };
}

/* ── Ledger v2: structured, consented record ── */

type RoomRow = typeof rooms.$inferSelect;
type SeatRow = typeof seats.$inferSelect;

/** Who may never be named in the record, given the room's anonymity choice. */
export function recordContext(room: RoomRow): RecordContext {
  const roomSeats = db.select().from(seats).where(eq(seats.roomId, room.id)).all();
  const open = room.anonymityMode === "open";
  const personLabels: string[] = [];
  const hiddenNames: string[] = [];
  for (const s of roomSeats) {
    if (s.realName && !(open && s.useRealName)) hiddenNames.push(s.realName);
    // In an anonymous room a pseudonym still points at one person; in an open
    // room only seats that chose their real name may carry a position.
    if (!open || !s.useRealName) personLabels.push(s.pseudonym);
  }
  return { anonymityMode: room.anonymityMode, personLabels, hiddenNames };
}

/** The name an objection may carry: only a seat that chose real-name mode in an open room. */
function objectorName(room: RoomRow, seat: SeatRow | undefined): string | null {
  if (!seat || room.anonymityMode !== "open" || !seat.useRealName || !seat.realName) return null;
  return seat.realName;
}

export type ConsentTally = {
  responded: number; supported: number; rewording: number; required: number;
  support: Support | null; decision: Decision; ready: boolean;
  /** "levels" while fewer than seven seats are admitted. */
  detail: SupportDetail;
};

/** What the facilitator may see of a tally. Nothing about the answers until every seat has answered;
 *  then levels only in rooms under seven seats, counts otherwise. Never who answered or what. */
export type FacilitatorTally = {
  responded: number; required: number; complete: boolean; ready: boolean; detail: SupportDetail;
  decision: { passed: boolean; blocker: Decision["blocker"] };
  support: SupportView | null;
  /** Counts only in rooms of seven or more, and only once complete. */
  rewording: number | null; consenting: number | null;
  /** Present-or-not, once complete. */
  anyRewording: boolean | null;
};

export function facilitatorTally(t: ConsentTally): FacilitatorTally {
  const complete = t.required > 0 && t.decision.answered >= t.required;
  const counts = complete && t.detail === "counts";
  return {
    responded: t.responded, required: t.required, complete, ready: t.ready, detail: t.detail,
    decision: { passed: t.decision.passed, blocker: t.decision.blocker },
    support: complete ? viewSupport(t.support, t.detail) : null,
    rewording: counts ? t.rewording : null,
    consenting: counts ? t.decision.consenting : null,
    anyRewording: complete ? t.rewording > 0 : null,
  };
}

/** Aggregate support for one structured entry. Never returns who chose what (except real-name objectors). */
export function tallyFor(entryId: number, room: RoomRow): ConsentTally {
  const rows = db.select().from(consents).where(eq(consents.entryId, entryId)).all();
  const admitted = db.select().from(seats)
    .where(and(eq(seats.roomId, room.id), eq(seats.status, "admitted"))).all();
  const ids = new Set(admitted.map((s) => s.id));
  const live = rows.filter((c) => ids.has(c.seatId));
  const supported = live.filter((c) => c.confirmed && c.support);
  const rewording = live.filter((c) => !c.confirmed).length;
  const support = aggregateSupport(supported.map((c) => ({
    support: c.support as SupportLevel, reason: c.reason,
    name: objectorName(room, admitted.find((s) => s.id === c.seatId)),
  })));
  const required = admitted.length;
  const decision = decide(room.sealThreshold, {
    required, rewording, full: support?.full ?? 0, reservations: support?.reservations ?? 0, objection: support?.objection ?? 0,
  });
  return {
    responded: live.length, supported: supported.length, rewording, required, support, decision,
    ready: decision.passed, detail: supportDetailFor(required),
  };
}

function includeInRecord(e: typeof entries.$inferSelect): boolean {
  if (e.status !== "approved") return false;
  if (e.visibility === "facilitator") return false; // never shown to the room, so never agreed by it
  if (e.visibility === "conditional" && !e.released) return false;
  return true;
}

/** Builds the canonical v2 document from approved, room-visible entries only. */
export function buildLedgerDocV2(roomId: number, sealedAt: number): LedgerDocV2 | null {
  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get();
  if (!room) return null;
  const items: LedgerItemV2[] = [];
  // Levels or counts is fixed by the seats admitted at the moment of sealing.
  const seatsAtSeal = db.select().from(seats)
    .where(and(eq(seats.roomId, roomId), eq(seats.status, "admitted"))).all().length;
  const supportDetail = supportDetailFor(seatsAtSeal);
  const approved = db.select().from(entries).where(eq(entries.roomId, roomId)).all()
    .filter(includeInRecord).sort((a, b) => a.id - b.id);
  for (const e of approved) {
    const v = db.select().from(entryVersions)
      .where(and(eq(entryVersions.entryId, e.id), eq(entryVersions.version, e.currentVersion))).get();
    if (!v) continue;
    let author = "Facilitator";
    if (e.authorSeatId) {
      const seat = db.select().from(seats).where(eq(seats.id, e.authorSeatId)).get();
      if (seat) author = seatLabel(seat);
    }
    const agenda = e.agendaItemId
      ? db.select().from(agendaItems).where(eq(agendaItems.id, e.agendaItemId)).get()?.title ?? null
      : null;
    const structured = isRecordKind(e.kind);
    items.push({
      id: e.id, kind: e.kind, agenda, author,
      approvedAt: e.approvedAt ?? e.createdAt, text: v.text,
      payload: structured ? parsePayload(v.payload) : null,
      support: structured ? viewSupport(tallyFor(e.id, room).support, supportDetail) : null,
      carriedFrom: e.carriedFrom ?? null,
    });
  }
  const locked = db.select().from(summaryVersions)
    .where(and(eq(summaryVersions.roomId, roomId), eq(summaryVersions.locked, 1)))
    .orderBy(desc(summaryVersions.version)).limit(1).get();
  const summary = locked ? {
    version: locked.version, agreements: locked.agreements, openIssues: locked.openIssues,
    nextSteps: locked.nextSteps, disagreements: locked.disagreements, deadlines: locked.deadlines,
    confirmations: db.select().from(summaryConfirmations)
      .where(eq(summaryConfirmations.summaryVersionId, locked.id)).all().filter((c) => c.confirmed).length,
  } : null;
  const follow = db.select().from(followups).where(eq(followups.roomId, roomId)).all().map((f) => ({
    id: f.id, type: f.type, text: f.text, owner: f.ownerLabel, dueDate: f.dueDate ?? null,
    status: f.status, outcome: f.outcome ?? null,
  }));
  return buildDocV2({
    room: {
      code: room.code, title: room.title, continuesFrom: room.continuesFrom ?? null,
      tier: room.tier ?? null, seatCap: room.seatCap ?? null, threshold: room.sealThreshold,
    },
    sealedAt, supportDetail, items, summary, followups: follow,
  });
}

export function canonicalDocV2(doc: LedgerDocV2): string {
  return canonicalJson(doc);
}

/**
 * Seals a closed room as ledger v2. The audit row is written first, so the
 * chain head captured here already covers the sealing action itself. The
 * destruction certificate binds the sealed ledger, the tamper-evident process
 * chain, and the architectural fact that no transcript exists.
 */
export function sealRoomV2(roomId: number, sealedAt: number, actor = "facilitator") {
  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()!;
  const doc = buildLedgerDocV2(roomId, sealedAt)!;
  const sealedLedger = canonicalDocV2(doc);
  const fingerprint = sha256(sealedLedger);
  audit(roomId, actor, "ledger_sealed");
  const chainHead = auditHead();
  const destructionCert = sha256(`${room.code}|${fingerprint}|${chainHead}|chat-never-persisted|ephemeral-relay`);
  db.update(rooms).set({
    status: "sealed", fingerprint, sealedAt, chainHead, destructionCert, ledgerVersion: 2, sealedLedger,
  }).where(eq(rooms.id, roomId)).run();
  // Per-seat support choices have done their job; only the sealed aggregate remains.
  const structuredIds = db.select().from(entries).where(eq(entries.roomId, roomId)).all()
    .filter((e) => isRecordKind(e.kind)).map((e) => e.id);
  if (structuredIds.length) db.delete(consents).where(inArray(consents.entryId, structuredIds)).run();
  return { fingerprint, chainHead, destructionCert, doc };
}

/** The sealed v2 document, exactly as fingerprinted. */
export function sealedDoc(room: RoomRow): LedgerDocV2 | null {
  if (room.ledgerVersion !== 2 || !room.sealedLedger) return null;
  try { return JSON.parse(room.sealedLedger) as LedgerDocV2; } catch { return null; }
}

/** v1-shaped rows from a v2 document, for older readers of the JSON export. */
export function rowsFromDoc(doc: LedgerDocV2): LedgerRow[] {
  return doc.items.map((i) => ({
    id: i.id, kind: i.kind, text: i.text, author: i.author, agenda: i.agenda, approvedAt: Date.parse(i.approvedAt),
  }));
}

/* ── Series: continue from a sealed ledger ──
   Open questions, conditions, unresolved disagreements and commitments that
   lapsed or were never finished come into the new round as *drafts*. Nothing
   is approved on arrival: the new room has to consent to each one afresh. */

export function carryForward(prev: RoomRow, newRoomId: number): number {
  const doc = sealedDoc(prev);
  const carried: { agenda: string | null; kind: string; payload: object; text: string }[] = [];
  if (doc) {
    for (const i of doc.items) {
      if (!i.payload) continue;
      if (i.kind === "question" || i.kind === "condition") {
        carried.push({ agenda: i.agenda, kind: i.kind, payload: i.payload as QuestionPayload | ConditionPayload, text: i.text });
      }
    }
  }
  // A v1 ledger has no structure to carry; only the follow-through below.
  // Follow-through as it stands today (kept items stay behind).
  const unfinished = db.select().from(followups).where(eq(followups.roomId, prev.id)).all()
    .filter((f) => f.status === "open" || f.status === "lapsed");
  // A real name chosen in the earlier room does not travel: the role stands in for it.
  const ownerOf = (f: typeof followups.$inferSelect) => {
    const seat = f.ownerSeatId ? db.select().from(seats).where(eq(seats.id, f.ownerSeatId)).get() : undefined;
    return seat?.useRealName && seat.realName && f.ownerLabel === seat.realName ? seat.claimedRole : f.ownerLabel;
  };
  for (const f of [...unfinished.map((f) => ({ text: f.text, owner: ownerOf(f), dueDate: f.dueDate }))]) {
    const payload: AgreementPayload = { action: f.text, owner: f.owner, deadline: null, resources: "", measure: "" };
    carried.push({ agenda: null, kind: "agreement", payload, text: recordText("agreement", payload) });
  }
  if (!carried.length) return 0;

  const agendaIds = new Map<string, number>();
  let position = db.select().from(agendaItems).where(eq(agendaItems.roomId, newRoomId)).all().length;
  const agendaFor = (title: string | null) => {
    const key = title ?? `Carried forward from ${prev.code}`;
    let id = agendaIds.get(key);
    if (!id) {
      id = db.insert(agendaItems).values({ roomId: newRoomId, position: ++position, title: key, status: "open" }).returning().get().id;
      agendaIds.set(key, id);
    }
    return id;
  };
  for (const c of carried) {
    const entry = db.insert(entries).values({
      roomId: newRoomId, agendaItemId: agendaFor(c.agenda), kind: c.kind, visibility: "all",
      status: "pending", authorSeatId: null, redactionChecked: 1, carriedFrom: prev.code, createdAt: now(),
    }).returning().get();
    db.insert(entryVersions).values({
      entryId: entry.id, version: 1, text: c.text, payload: JSON.stringify(c.payload), createdAt: now(),
    }).run();
  }
  return carried.length;
}

/* ── Series follow-through: lapsed commitments carry over ── */

export function carryLapsed(seriesKey: string, newRoomId: number) {
  const lapsed = db.select().from(followups)
    .where(and(eq(followups.seriesKey, seriesKey), eq(followups.status, "lapsed"))).all();
  for (const f of lapsed) {
    db.insert(followups).values({
      roomId: newRoomId,
      seriesKey,
      type: f.type,
      text: f.text,
      ownerSeatId: null,
      ownerLabel: f.ownerLabel,
      dueDate: f.dueDate,
      status: "open",
      outcome: null,
      createdAt: now(),
    }).run();
  }
  return lapsed.length;
}

/* ── Structured summary → clean Markdown export ── */

export function summaryMarkdown(
  room: typeof rooms.$inferSelect,
  v: typeof summaryVersions.$inferSelect,
): string {
  const section = (title: string, body: string) =>
    body.trim() ? `## ${title}\n\n${body.trim().split("\n").map((l) => l.trim()).filter(Boolean).join("\n")}\n` : "";
  return [
    `# ${room.title}`,
    "",
    `Room ${room.code} · Outcome summary v${v.version} · ${new Date(v.createdAt).toLocaleString()}`,
    "",
    "This document records outcomes only. The conversation that produced it was never written to disk and cannot be recovered.",
    "",
    section("Points of agreement", v.agreements),
    section("Open issues", v.openIssues),
    section("Next steps", v.nextSteps),
    section("Points of disagreement", v.disagreements),
    section("Deadlines", v.deadlines),
  ].join("\n");
}

seed();

// Room closer: checks every minute (spec: five minutes in production)
setInterval(() => closeExpiredRooms(), 60000).unref();
