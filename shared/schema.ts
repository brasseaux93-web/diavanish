import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import type * as z from "zod/mini";

/* ── Platform ─────────────────────────────────────────────── */

export const platformSettings = sqliteTable("platform_settings", {
  id: integer("id").primaryKey(),
  orgName: text("org_name").notNull().default("Diavanish"),
  defaultTurnMinutes: integer("default_turn_minutes").notNull().default(7),
  requireRoleProofsDefault: integer("require_role_proofs_default").notNull().default(0),
  closedRoomRetentionDays: integer("closed_room_retention_days").notNull().default(30),
  guestSessionRetentionDays: integer("guest_session_retention_days").notNull().default(3),
  applicationRetentionDays: integer("application_retention_days").notNull().default(90),
  sealedLedgerKept: integer("sealed_ledger_kept").notNull().default(1),
  requirePasskey: integer("require_passkey").notNull().default(0),
  emailCodeEnabled: integer("email_code_enabled").notNull().default(1),
});

/** WebAuthn passkeys for administrators and facilitators (never participants). */
export const passkeys = sqliteTable("passkeys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  role: text("role").notNull(), // admin | facilitator
  userId: integer("user_id").notNull(),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(), // base64url COSE key
  counter: integer("counter").notNull().default(0),
  transports: text("transports"),
  nickname: text("nickname"),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
});

export const admins = sqliteTable("admins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at").notNull(),
});

export const loginCodes = sqliteTable("login_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  code: text("code").notNull(), // salted SHA-256 of the code, never the code
  role: text("role").notNull(), // 'admin' | 'facilitator'
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  attempts: integer("attempts").notNull().default(0),
});

export const blockedCountries = sqliteTable("blocked_countries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull(),
  name: text("name").notNull(),
});

export const facilitatorApplications = sqliteTable("facilitator_applications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  affiliation: text("affiliation"),
  email: text("email").notNull(),
  country: text("country").notNull(),
  experience: text("experience").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  createdAt: integer("created_at").notNull(),
  decidedAt: integer("decided_at"),
});

export const facilitators = sqliteTable("facilitators", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"), // active | withdrawn
  createdAt: integer("created_at").notNull(),
});

export const enrolmentLinks = sqliteTable("enrolment_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  facilitatorId: integer("facilitator_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
});

export const dataRequests = sqliteTable("data_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // access | erasure
  requester: text("requester").notNull(),
  detail: text("detail"),
  status: text("status").notNull().default("open"), // open | completed | rejected
  handler: text("handler"),
  createdAt: integer("created_at").notNull(),
  decidedAt: integer("decided_at"),
});

export const securityEvents = sqliteTable("security_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  detail: text("detail"),
  createdAt: integer("created_at").notNull(),
});

/* ── Rooms ───────────────────────────────────────────────── */

export const rooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  purpose: text("purpose"),
  facilitatorId: integer("facilitator_id").notNull(),
  status: text("status").notNull().default("draft"), // draft | live | closed | sealed
  // NEW: facilitator chooses whether participants stay anonymous
  anonymityMode: text("anonymity_mode").notNull().default("anonymous"), // anonymous | open
  turnMinutes: integer("turn_minutes").notNull().default(7),
  expiresAt: integer("expires_at").notNull(),
  requiresRoleProof: integer("requires_role_proof").notNull().default(0),
  chathamHouse: integer("chatham_house").notNull().default(1),
  nextStepReview: integer("next_step_review").notNull().default(0),
  retentionDays: integer("retention_days"),
  seriesKey: text("series_key"),
  // Floor
  floorState: text("floor_state").notNull().default("idle"), // idle | running | paused
  floorSeatId: integer("floor_seat_id"),
  floorEndsAt: integer("floor_ends_at"),
  turnNumber: integer("turn_number").notNull().default(0),
  // Process
  stage: text("stage").notNull().default("opening"), // opening | joint | caucus | drafting | closing
  stageEndsAt: integer("stage_ends_at"),
  inputLocked: integer("input_locked").notNull().default(0), // facilitator mute/pause
  caucusSeatId: integer("caucus_seat_id"), // private facilitator↔seat channel
  sessionAt: text("session_at"), // scheduled start (ISO)
  // Seal
  fingerprint: text("fingerprint"),
  sealedAt: integer("sealed_at"),
  chainHead: text("chain_head"), // audit chain head at seal
  destructionCert: text("destruction_cert"), // proof the conversation is unrecoverable
  attestPubs: text("attest_pubs"), // JSON array of facilitator attestation public keys (raw P-256, base64)
  // Room tier (shared/tiers.ts): bilateral | council | plenary. Null for rooms made before tiers.
  tier: text("tier"),
  seatCap: integer("seat_cap"), // admitted + waiting seats may not exceed this
  turnSeconds: integer("turn_seconds"), // overrides turnMinutes when set (tiers allow 2.5 min turns)
  // Sealing threshold for structured items: consensus | super75 | super66
  sealThreshold: text("seal_threshold").notNull().default("consensus"),
  // Ledger v2: null = v1 seal (rows only). 2 = structured, consented record.
  ledgerVersion: integer("ledger_version"),
  // The exact canonical v2 document the fingerprint covers (consented content only).
  sealedLedger: text("sealed_ledger"),
  // Series: the sealed room code this round continues from.
  continuesFrom: text("continues_from"),
  // Set when retention removed everything but the sealed ledger ("sealed ledgers outlive retention").
  purgedAt: integer("purged_at"),
  createdAt: integer("created_at").notNull(),
});

export const agendaItems = sqliteTable("agenda_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull(),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("open"), // open | covered
});

export const invites = sqliteTable("invites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull(),
  token: text("token").notNull().unique(), // SHA-256 of the invite code; the code itself is never stored
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  role: text("role"), // role bound by the facilitator who vetted the delegate
  attestation: text("attestation"), // JSON {sig, pub} signed on the facilitator's device
});

export const seats = sqliteTable("seats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull(),
  token: text("token").notNull().unique(), // anonymous session handle
  pseudonym: text("pseudonym").notNull(),
  realName: text("real_name"),
  useRealName: integer("use_real_name").notNull().default(0),
  claimedRole: text("claimed_role").notNull(),
  roleProofVerified: integer("role_proof_verified").notNull().default(0),
  attestation: text("attestation"), // JSON {role, inviteHash, sig, pub}
  recoveryKey: text("recovery_key"), // seat recovery without identity
  status: text("status").notNull().default("waiting"), // waiting | admitted | removed | banned | left
  joinedAt: integer("joined_at").notNull(),
  leftAt: integer("left_at"),
});

export const entries = sqliteTable("entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull(),
  agendaItemId: integer("agenda_item_id"),
  // issue | summary | next-step | attestation, plus the structured record kinds
  // (see shared/ledger.ts): problem | position | evidence | option | agreement | condition | question
  kind: text("kind").notNull(),
  visibility: text("visibility").notNull().default("all"), // all | facilitator | conditional
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  authorSeatId: integer("author_seat_id"),
  currentVersion: integer("current_version").notNull().default(1),
  conditionText: text("condition_text"),
  released: integer("released").notNull().default(0),
  redactionChecked: integer("redaction_checked").notNull().default(0),
  approvedAt: integer("approved_at"),
  carriedFrom: text("carried_from"), // sealed room code this draft was carried forward from
  createdAt: integer("created_at").notNull(),
});

export const entryVersions = sqliteTable("entry_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entryId: integer("entry_id").notNull(),
  version: integer("version").notNull(),
  text: text("text").notNull(),
  payload: text("payload"), // structured record fields (JSON), validated by shared/ledger.ts
  createdAt: integer("created_at").notNull(),
});

export const consents = sqliteTable("consents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entryId: integer("entry_id").notNull(),
  seatId: integer("seat_id").notNull(),
  confirmed: integer("confirmed").notNull().default(0),
  // Structured items: full | reservations | objection (null = asked for rewording)
  support: text("support"),
  reason: text("reason"), // optional short reason for an objection
  createdAt: integer("created_at").notNull(),
});

export const followups = sqliteTable("followups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull(),
  seriesKey: text("series_key"),
  type: text("type").notNull(), // pledge | commitment
  text: text("text").notNull(),
  ownerSeatId: integer("owner_seat_id"),
  ownerLabel: text("owner_label").notNull(), // pseudonym or real name snapshot
  dueDate: text("due_date"),
  status: text("status").notNull().default("open"), // open | kept | lapsed
  outcome: text("outcome"),
  createdAt: integer("created_at").notNull(),
});

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull(),
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id"),
  actor: text("actor").notNull(), // admin | facilitator | participant | system
  action: text("action").notNull(), // no content, per spec
  prevHash: text("prev_hash"), // hash-chained: tamper-evident process trail
  hash: text("hash"),
  createdAt: integer("created_at").notNull(),
});

/* ── Structured outcome summary (better than a blank page) ── */

export const summaryVersions = sqliteTable("summary_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull(),
  version: integer("version").notNull(),
  agreements: text("agreements").notNull().default(""),
  openIssues: text("open_issues").notNull().default(""),
  nextSteps: text("next_steps").notNull().default(""),
  disagreements: text("disagreements").notNull().default(""),
  deadlines: text("deadlines").notNull().default(""),
  locked: integer("locked").notNull().default(0), // final: no further versions
  createdAt: integer("created_at").notNull(),
});

export const summaryConfirmations = sqliteTable("summary_confirmations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  summaryVersionId: integer("summary_version_id").notNull(),
  seatId: integer("seat_id").notNull(),
  confirmed: integer("confirmed").notNull().default(0),
  note: text("note"), // participant annotation, shown to facilitator only
  createdAt: integer("created_at").notNull(),
});

/* ── Types ───────────────────────────────────────────────── */

export const insertApplicationSchema = createInsertSchema(facilitatorApplications).pick({
  name: true, affiliation: true, email: true, country: true, experience: true,
});
export const insertRoomSchema = createInsertSchema(rooms).pick({
  title: true, purpose: true, turnMinutes: true, expiresAt: true,
  requiresRoleProof: true, chathamHouse: true, nextStepReview: true,
  retentionDays: true, seriesKey: true, anonymityMode: true,
});
export const insertEntrySchema = createInsertSchema(entries).pick({
  roomId: true, agendaItemId: true, kind: true, visibility: true, conditionText: true,
});

export type Application = typeof facilitatorApplications.$inferSelect;
export type Facilitator = typeof facilitators.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type AgendaItem = typeof agendaItems.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Seat = typeof seats.$inferSelect;
export type Entry = typeof entries.$inferSelect;
export type EntryVersion = typeof entryVersions.$inferSelect;
export type Consent = typeof consents.$inferSelect;
export type Followup = typeof followups.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type SummaryVersion = typeof summaryVersions.$inferSelect;
export type SummaryConfirmation = typeof summaryConfirmations.$inferSelect;
export type DataRequest = typeof dataRequests.$inferSelect;
export type SecurityEvent = typeof securityEvents.$inferSelect;
export type PlatformSettings = typeof platformSettings.$inferSelect;
export type Passkey = typeof passkeys.$inferSelect;
export type BlockedCountry = typeof blockedCountries.$inferSelect;
export type EnrolmentLink = typeof enrolmentLinks.$inferSelect;
