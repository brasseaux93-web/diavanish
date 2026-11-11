/*
 * Ledger v2: the structured, consented record and its canonical form.
 *
 * Nothing here ever touches chat. Every structured item is an ordinary ledger
 * entry (same entries / versions / consents flow as v1), whose current version
 * carries a validated JSON payload. Only approved items reach the sealed
 * document, and the fingerprint is SHA-256 over canonicalJson(document).
 *
 * Shared by the server (seal, export, brief) and the browser (verify), so
 * both compute the same bytes.
 */

export const LEDGER_VERSION = 2 as const;

export const RECORD_KINDS = ["problem", "position", "evidence", "option", "agreement", "condition", "question"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
export const isRecordKind = (k: unknown): k is RecordKind => RECORD_KINDS.includes(k as RecordKind);

export const SCALES = ["team", "org", "community", "city", "national", "regional", "global"] as const;
export type Scale = (typeof SCALES)[number];

export const SUPPORT_LEVELS = ["full", "reservations", "objection"] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

export type ProblemPayload = { statement: string; scale: Scale; affected: string[] };
export type PositionPayload = { party: string; wants: string; why: string };
export type EvidencePayload = { summary: string; source: string; url: string | null };
export type OptionPayload = { title: string; rationale: string; status: "chosen" | "dropped"; reason: string };
export type AgreementPayload = { action: string; owner: string; deadline: string | null; resources: string; measure: string };
export type ConditionPayload =
  | { form: "conditional"; accept: string; provided: string }
  | { form: "unresolved"; point: string };
export type QuestionPayload = { question: string; research: string };

export type RecordPayload =
  | ProblemPayload | PositionPayload | EvidencePayload | OptionPayload
  | AgreementPayload | ConditionPayload | QuestionPayload;

/* ── Normalisation: the same input always gives the same bytes ── */

/** NFC, LF line ends, single spaces, no padding. Idempotent. */
export function normText(v: unknown): string {
  return String(v ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00A0 ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** YYYY-MM-DD for a real calendar date, otherwise null. */
export function normDate(v: unknown): string | null {
  const s = normText(v);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Epoch milliseconds to a fixed ISO-8601 UTC string. */
export function isoTime(ms: number): string {
  return new Date(ms).toISOString();
}

/** http(s) only, no credentials, at most 500 characters. Returns the normalised href or null. */
export function safeUrl(v: unknown): string | null {
  const s = normText(v);
  if (!s || s.length > 500 || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    if (!u.hostname.includes(".")) return null;
    return u.href;
  } catch {
    return null;
  }
}

/* ── Canonical JSON: sorted keys, normalised strings, no undefined ── */

export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return normText(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Ledger numbers must be finite");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      out[k] = canonicalize(v);
    }
    return out;
  }
  throw new Error(`Unsupported ledger value: ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/* ── v1, unchanged: kept byte-for-byte so old seals still verify ── */

export type LedgerRowV1 = { id: number; kind: string; text: string; author: string; agenda: string | null; approvedAt: number };

export function canonicalLedgerV1(rows: LedgerRowV1[]): string {
  return JSON.stringify(
    rows.slice().sort((a, b) => a.id - b.id).map((r) => ({
      agenda: r.agenda ?? null, approvedAt: r.approvedAt, author: r.author,
      id: r.id, kind: r.kind, text: r.text,
    })),
  );
}

/* ── Validation of one structured item ── */

const LIMIT = { short: 160, line: 320, long: 1200 } as const;

export type RecordContext = {
  anonymityMode: "anonymous" | "open" | string;
  /** Labels that point at a person and may not be used to attribute a position. */
  personLabels: string[];
  /** Real names a seat has not chosen to show. Never allowed anywhere in the record. */
  hiddenNames: string[];
};

export type RecordResult = { ok: true; payload: RecordPayload; text: string } | { ok: false; error: string };

function field(raw: Record<string, unknown>, key: string, max: number, required: boolean, name: string): string | { error: string } {
  const v = normText(raw[key]);
  if (required && !v) return { error: `${name} is required` };
  if (v.length > max) return { error: `${name} is too long (max ${max} characters)` };
  return v;
}

function list(raw: unknown, maxItems: number, maxLen: number): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw ?? "").split(/[,;\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const v = normText(p).slice(0, maxLen);
    const key = v.toLocaleLowerCase();
    if (v && !seen.has(key)) { seen.add(key); out.push(v); }
  }
  return out.slice(0, maxItems);
}

const isErr = (v: unknown): v is { error: string } => typeof v === "object" && v !== null && "error" in v;

export function validateRecord(kind: string, raw: unknown, ctx: RecordContext): RecordResult {
  if (!isRecordKind(kind)) return { ok: false, error: "Unknown record section" };
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const set = (l: string[]) => new Set(l.map((x) => normText(x).toLocaleLowerCase()).filter(Boolean));
  const persons = set(ctx.personLabels);
  const hidden = set(ctx.hiddenNames);
  const notPerson = (label: string, name: string) =>
    persons.has(label.toLocaleLowerCase()) || hidden.has(label.toLocaleLowerCase())
      ? { error: `${name} must be a role or delegation, not a person${ctx.anonymityMode === "open" ? " who has not chosen to use their real name" : ""}` }
      : null;
  const fields: Record<string, string> = {};
  const take = (key: string, max: number, required: boolean, name: string) => {
    const v = field(r, key, max, required, name);
    if (isErr(v)) throw v;
    fields[key] = v;
    return v;
  };
  try {
    let payload: RecordPayload;
    switch (kind) {
      case "problem": {
        const scale = normText(r.scale) as Scale;
        if (!SCALES.includes(scale)) return { ok: false, error: "Pick a scale" };
        payload = { statement: take("statement", LIMIT.long, true, "Problem statement"), scale, affected: list(r.affected, 12, 120) };
        break;
      }
      case "position": {
        const party = take("party", LIMIT.short, true, "Role or delegation");
        const bad = notPerson(party, "A position");
        if (bad) return { ok: false, error: bad.error };
        payload = { party, wants: take("wants", LIMIT.long, true, "What they want"), why: take("why", LIMIT.long, false, "Why") };
        break;
      }
      case "evidence": {
        const rawUrl = normText(r.url);
        const url = rawUrl ? safeUrl(rawUrl) : null;
        if (rawUrl && !url) return { ok: false, error: "Links must be a full http(s) address" };
        payload = { summary: take("summary", LIMIT.long, true, "Evidence"), source: take("source", LIMIT.line, false, "Source"), url };
        break;
      }
      case "option": {
        const status = normText(r.status);
        if (status !== "chosen" && status !== "dropped") return { ok: false, error: "Mark the option chosen or dropped" };
        payload = {
          title: take("title", LIMIT.line, true, "Option"), rationale: take("rationale", LIMIT.long, false, "Rationale"),
          status, reason: take("reason", LIMIT.long, false, "Reason"),
        };
        break;
      }
      case "agreement": {
        const owner = take("owner", LIMIT.short, true, "Owner");
        if (hidden.has(owner.toLocaleLowerCase())) return { ok: false, error: "An owner can be a seat label or a role, never a real name that seat has not chosen to show" };
        const rawDeadline = normText(r.deadline);
        const deadline = rawDeadline ? normDate(rawDeadline) : null;
        if (rawDeadline && !deadline) return { ok: false, error: "Deadline must be a date (YYYY-MM-DD)" };
        payload = {
          action: take("action", LIMIT.long, true, "Action"), owner, deadline,
          resources: take("resources", LIMIT.line, false, "Resources"), measure: take("measure", LIMIT.line, false, "Success measure"),
        };
        break;
      }
      case "condition": {
        if (normText(r.form) === "unresolved") {
          payload = { form: "unresolved", point: take("point", LIMIT.long, true, "Unresolved point") };
        } else {
          payload = { form: "conditional", accept: take("accept", LIMIT.long, true, "What would be accepted"), provided: take("provided", LIMIT.long, true, "The condition") };
        }
        break;
      }
      case "question": {
        payload = { question: take("question", LIMIT.long, true, "Question"), research: take("research", LIMIT.long, false, "Research needed") };
        break;
      }
    }
    return { ok: true, payload: payload!, text: recordText(kind, payload!) };
  } catch (e) {
    if (isErr(e)) return { ok: false, error: e.error };
    throw e;
  }
}

/** One plain line for lists and the v1-style row text. */
export function recordText(kind: RecordKind, p: RecordPayload): string {
  switch (kind) {
    case "problem": return (p as ProblemPayload).statement;
    case "position": { const x = p as PositionPayload; return `${x.party}: ${x.wants}`; }
    case "evidence": return (p as EvidencePayload).summary;
    case "option": { const x = p as OptionPayload; return `${x.title} (${x.status})`; }
    case "agreement": { const x = p as AgreementPayload; return `${x.action} — ${x.owner}${x.deadline ? `, by ${x.deadline}` : ""}`; }
    case "condition": { const x = p as ConditionPayload; return x.form === "unresolved" ? x.point : `We'd accept ${x.accept} if ${x.provided}`; }
    case "question": return (p as QuestionPayload).question;
  }
}

export function parsePayload(json: string | null | undefined): RecordPayload | null {
  if (!json) return null;
  try { return JSON.parse(json) as RecordPayload; } catch { return null; }
}

/* ── Support: chosen per seat at consent time, sealed only as an aggregate ── */

export type SupportResponse = { support: SupportLevel | null; reason?: string | null; name?: string | null };
export type Support = {
  level: SupportLevel;
  full: number;
  reservations: number;
  objection: number;
  /** Reasons on record. `by` is present only for seats that chose real-name mode. */
  objections: { reason: string; by?: string }[];
};

export function aggregateSupport(responses: SupportResponse[]): Support | null {
  const given = responses.filter((r): r is SupportResponse & { support: SupportLevel } => !!r.support && SUPPORT_LEVELS.includes(r.support));
  if (given.length === 0) return null;
  const count = (l: SupportLevel) => given.filter((r) => r.support === l).length;
  const full = count("full"), reservations = count("reservations"), objection = count("objection");
  const objections = given
    .filter((r) => r.support === "objection" && (normText(r.reason) || r.name))
    .map((r) => {
      const o: { reason: string; by?: string } = { reason: normText(r.reason).slice(0, 280) };
      if (r.name) o.by = normText(r.name);
      return o;
    })
    .sort((a, b) => (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : (a.by ?? "") < (b.by ?? "") ? -1 : 1));
  return { level: objection ? "objection" : reservations ? "reservations" : "full", full, reservations, objection, objections };
}

/* ── Levels only: small rooms never show counts ──
   In a room of fewer than seven seats, "3 full, 1 objection" can point at a
   person. There the aggregate is expressed as the strongest category present
   plus whether reservations or objections exist, and never as numbers. Live
   views use the current number of admitted seats; the seal fixes the choice
   from the admitted seats at the moment of sealing and records it in the
   canonical ledger as `supportDetail`, so verification stays deterministic. */

export const SMALL_ROOM_SEATS = 7;
export type SupportDetail = "levels" | "counts";
export const supportDetailFor = (seats: number): SupportDetail => (seats < SMALL_ROOM_SEATS ? "levels" : "counts");

export type SupportLevels = {
  level: SupportLevel;
  withReservations: boolean;
  withObjection: boolean;
  /** Reasons on record, de-duplicated. `by` only for real-name seats in open rooms. */
  objections: { reason: string; by?: string }[];
};
export type SupportView = Support | SupportLevels;

export const isCountsView = (s: SupportView): s is Support => "full" in s;

export function levelsOnly(s: Support): SupportLevels {
  const seen = new Set<string>();
  const objections = s.objections.filter((o) => {
    const k = `${o.reason}\u0000${o.by ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { level: s.level, withReservations: s.reservations > 0, withObjection: s.objection > 0, objections };
}

export function viewSupport(s: Support | null | undefined, detail: SupportDetail): SupportView | null {
  if (!s) return null;
  return detail === "levels" ? levelsOnly(s) : s;
}

/** Present-or-not flags for either shape. */
export function supportFlags(s: SupportView): { level: SupportLevel; reservations: boolean; objection: boolean } {
  return isCountsView(s)
    ? { level: s.level, reservations: s.reservations > 0, objection: s.objection > 0 }
    : { level: s.level, reservations: s.withReservations, objection: s.withObjection };
}

/* ── The sealed v2 document ── */

export type LedgerItemV2 = {
  id: number;
  kind: string;
  agenda: string | null;
  author: string;
  approvedAt: number;
  text: string;
  payload: RecordPayload | null;
  support: SupportView | null;
  carriedFrom: string | null;
};

export type SummaryV2 = {
  version: number; agreements: string; openIssues: string; nextSteps: string;
  disagreements: string; deadlines: string; confirmations: number;
};

export type FollowupV2 = {
  id: number; type: string; text: string; owner: string; dueDate: string | null; status: string; outcome: string | null;
};

export type LedgerDocV2 = {
  ledgerVersion: 2;
  room: { code: string; title: string; continuesFrom: string | null; tier: string | null; seatCap: number | null; threshold: string };
  sealedAt: string;
  /** "levels" when fewer than seven seats were admitted at seal: support carries no counts. */
  supportDetail: SupportDetail;
  items: (Omit<LedgerItemV2, "approvedAt"> & { approvedAt: string })[];
  summary: SummaryV2 | null;
  followups: FollowupV2[];
};

export function buildDocV2(input: {
  room: { code: string; title: string; continuesFrom?: string | null; tier?: string | null; seatCap?: number | null; threshold?: string };
  sealedAt: number;
  supportDetail?: SupportDetail;
  items: LedgerItemV2[];
  summary: SummaryV2 | null;
  followups: FollowupV2[];
}): LedgerDocV2 {
  const detail: SupportDetail = input.supportDetail ?? "counts";
  const doc: LedgerDocV2 = {
    ledgerVersion: LEDGER_VERSION,
    room: {
      code: input.room.code, title: input.room.title, continuesFrom: input.room.continuesFrom ?? null,
      tier: input.room.tier ?? null, seatCap: input.room.seatCap ?? null, threshold: input.room.threshold ?? "consensus",
    },
    sealedAt: isoTime(input.sealedAt),
    supportDetail: detail,
    // Belt and braces: in levels mode no item may carry counts, whatever the caller passed.
    items: input.items.slice().sort((a, b) => a.id - b.id).map((i) => ({
      ...i, approvedAt: isoTime(i.approvedAt),
      support: i.support && detail === "levels" && isCountsView(i.support) ? levelsOnly(i.support) : i.support,
    })),
    summary: input.summary,
    followups: input.followups.slice().sort((a, b) => a.id - b.id).map((f) => ({ ...f, dueDate: normDate(f.dueDate) })),
  };
  return canonicalize(doc) as LedgerDocV2;
}

/* ── Fingerprints ── */

async function sha256Hex(s: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The exact bytes a seal covers, by version. */
export function canonicalFor(version: number | null | undefined, data: { rows?: LedgerRowV1[]; document?: unknown }): string {
  if (version === 2) return canonicalJson(data.document);
  return canonicalLedgerV1(data.rows ?? []);
}

export async function fingerprintFor(version: number | null | undefined, data: { rows?: LedgerRowV1[]; document?: unknown }): Promise<string> {
  return sha256Hex(canonicalFor(version, data));
}
