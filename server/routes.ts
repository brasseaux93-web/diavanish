import { Express, Request, Response, NextFunction } from "express";
import {
  type Session,
  db, createSession, getSession, destroySession, uid, sha256, now, DAY,
  audit, security, chatPush, chatRecent, redactCheck, wipeRoom, purgeExpired,
  closeExpiredRooms, buildLedger, canonicalLedger, seatLabel, carryLapsed,
  auditHead, auditVerify, summaryMarkdown, chatWipe, chatWipeCaucus, cryptoFor, rosterFor, isB64, serverPubHash, tokenHash,
  recordContext, tallyFor, facilitatorTally, sealRoomV2, sealedDoc, rowsFromDoc, carryForward,
} from "./storage";
import { isRecordKind, validateRecord, normText, SUPPORT_LEVELS, LEDGER_VERSION, viewSupport, canonicalFor } from "@shared/ledger";
import { renderBrief } from "./brief";
import { TIER_SPECS, DEFAULT_TIER, isTier, isThreshold, tierSettings, turnMs } from "@shared/tiers";
import {
  platformSettings, admins, facilitators, facilitatorApplications, enrolmentLinks,
  blockedCountries, securityEvents, dataRequests, loginCodes, rooms, seats,
  entries, entryVersions, invites, agendaItems, followups, notes, auditLog, consents,
  summaryVersions, summaryConfirmations,
} from "@shared/schema";
import { eq, and, lt, gt, isNull, desc, inArray } from "drizzle-orm";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { mailMode, sendCode } from "./mailer";
import { startDemo, resetDemo, ensureDemo, demoSteward, type DemoRole } from "./demo";
import { bootstrapAdminEmail } from "./dev-hints";
import { demoEnabled, isDemoEmail, isDemoRoom } from "./demo-mode";
import { BRIEF_CSP } from "./security-headers";
import {
  authMethods, emailCodeAllowed, listPasskeys, deletePasskey,
  registrationOptions, verifyRegistration, authenticationOptions, verifyAuthentication,
} from "./passkeys";
import { oidcStart, oidcCallback, oidcClaim } from "./oidc";
import { generateNeutralVariants, testGroqConnection } from "./neutrality-engine";

function deny(status: number, message: string, extra?: { code: string; reason?: string }): never {
  const err: any = new Error(message);
  err.status = status;
  if (extra) Object.assign(err, extra);
  throw err;
}

function getReqToken(req: Request): string | undefined {
  return req.header("x-diavanish-session") || req.header("x-aperture-session") || undefined;
}

const ENDED = ["removed", "banned", "left"];

/** The seat row behind a participant session, whatever its status. */
function ownSeat(session: Session) {
  const seat = db.select().from(seats).where(eq(seats.id, session.id)).get();
  // The session is left to idle out rather than destroyed here, so every call
  // from that browser gets this same answer and the page can say what happened.
  // Seat ids are never reused, so the orphaned session can reach nothing.
  if (!seat) deny(403, "Seat no longer active", { code: "seat_ended", reason: "gone" });
  return seat;
}

/**
 * The seat behind a participant session, for everything that reads or writes
 * the room. A seat the facilitator removed or banned keeps its session only so
 * its holder can still export or erase their data; it is refused here.
 */
function activeSeat(session: Session) {
  const seat = ownSeat(session);
  if (ENDED.includes(seat.status)) deny(403, "Seat no longer active", { code: "seat_ended", reason: seat.status });
  return seat;
}

/**
 * Is this session a demo actor? Decided server-side from the session flag and
 * from the reserved demo accounts and rooms, never from anything the client sends.
 */
function isDemoActor(session: Session): boolean {
  if (session.demo) return true;
  if (session.role === "admin") {
    return isDemoEmail(db.select().from(admins).where(eq(admins.id, session.id)).get()?.email);
  }
  if (session.role === "facilitator") {
    return isDemoEmail(db.select().from(facilitators).where(eq(facilitators.id, session.id)).get()?.email);
  }
  const seat = db.select().from(seats).where(eq(seats.id, session.id)).get();
  return isDemoRoom(seat ? db.select().from(rooms).where(eq(rooms.id, seat.roomId)).get() : null);
}

type Scoped = Session & { demo: boolean };

/**
 * Every signed-in route goes through here. Demo actors are refused outright when
 * demos are off, and the demo administrator is refused on every admin route
 * unless that route opts in with allowDemo and scopes its answer to demo data.
 * New admin routes are therefore closed to the demo by default.
 */
function requireRole(req: Request, role: "admin" | "facilitator" | "participant", opts: { allowDemo?: boolean } = {}): Scoped {
  const token = getReqToken(req);
  const session = getSession(token);
  if (!session || session.role !== role) deny(403, "Not authorized for this role");
  const demo = isDemoActor(session);
  if (demo && !demoEnabled()) {
    destroySession(session.token);
    deny(403, "Demo is turned off on this server");
  }
  if (demo && role === "admin" && !opts.allowDemo) {
    deny(403, "The demo administrator can look around but cannot change this server.");
  }
  return Object.assign(session, { demo });
}

/** Demo actors see only demo rooms; real actors never see demo rooms. */
function sameWorld(session: Scoped, room: { seriesKey: string | null }) {
  return session.demo === isDemoRoom(room);
}

function requirePrivileged(req: Request) {
  const token = getReqToken(req);
  const session = getSession(token);
  if (!session || (session.role !== "admin" && session.role !== "facilitator")) {
    const err: any = new Error("Not authorized for this role");
    err.status = 403;
    throw err;
  }
  return session as { role: "admin" | "facilitator"; id: number; token: string };
}

function myRoom(session: Scoped, roomId: number) {
  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get();
  if (!room || room.facilitatorId !== session.id || !sameWorld(session, room)) deny(404, "Room not found");
  return room;
}

function addAttestPub(roomId: number, pub: string) {
  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()!;
  const list: string[] = JSON.parse(room.attestPubs || "[]");
  if (!list.includes(pub)) {
    list.push(pub);
    db.update(rooms).set({ attestPubs: JSON.stringify(list.slice(-20)) }).where(eq(rooms.id, roomId)).run();
  }
}

// Base64 ceiling for one sealed line: 2,000 characters of any script, a label
// and a signature, padded up to the 12 KiB bucket in the worst case.
const CHAT_CT_MAX = 17_000;

function settings() {
  return db.select().from(platformSettings).get()!;
}

const LEGACY_KINDS = ["issue", "summary", "next-step", "attestation"];

/** Sealed aggregate support for an entry, read from the sealed v2 document. */
function sealedSupport(room: typeof rooms.$inferSelect, entryId: number) {
  const doc = sealedDoc(room);
  return doc?.items.find((i) => i.id === entryId)?.support;
}

/** Live aggregate for an approved item, levels only while fewer than seven seats are admitted. */
function liveSupport(entryId: number, room: typeof rooms.$inferSelect) {
  const t = tallyFor(entryId, room);
  return viewSupport(t.support, t.detail);
}

/** The sealed ledger in the shape both readers expect: v1 rows, and the v2 document when there is one. */
function ledgerPayload(room: typeof rooms.$inferSelect, rowsKey: "rows" | "ledger") {
  const doc = sealedDoc(room);
  const rows = doc ? rowsFromDoc(doc) : buildLedger(room.id).rows;
  return {
    room: {
      code: room.code, title: room.title, sealedAt: room.sealedAt, fingerprint: room.fingerprint,
      chainHead: room.chainHead, destructionCert: room.destructionCert,
    },
    ledgerVersion: doc ? 2 : 1,
    [rowsKey]: rows,
    ...(doc ? { document: doc } : {}),
  };
}

export async function registerRoutes(_httpServer: any, app: Express) {
  const demoOn = demoEnabled();
  if (demoOn) ensureDemo();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    closeExpiredRooms();
    next();
  });

  /* ── Auth ─────────────────────────────────────────────── */

  // Soft-mode only: never returns the real APERTURE_ADMIN_EMAIL.
  app.get("/api/public/bootstrap-admin", (_req, res) => {
    res.json({ email: bootstrapAdminEmail() });
  });

  // What the browser may offer on this server. Read once by the client shell.
  app.get("/api/public/config", (_req, res) => {
    res.json({ demo: demoOn });
  });

  app.get("/api/public/health", (_req, res) => {
    try {
      db.select().from(platformSettings).get();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.get("/api/public/auth-methods", (_req, res) => {
    res.json(authMethods());
  });


  const CODE_PEPPER = process.env.DIAVANISH_SECRET || process.env.APERTURE_SECRET || randomBytes(32).toString("hex");
  const codeHash = (email: string, code: string) =>
    createHash("sha256").update(`${email.toLowerCase()}|${code}|${CODE_PEPPER}`).digest("hex");

  app.post("/api/auth/request-code", async (req, res) => {
    const { email: rawEmail, role } = req.body as { email: string; role: string };
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!email || !["admin", "facilitator"].includes(role)) {
      return res.status(400).json({ message: "Email and role are required" });
    }
    const policy = emailCodeAllowed(role);
    if (!policy.ok) return res.status(policy.status).json({ message: policy.message });
    const mode = mailMode();
    if (mode === "off") {
      return res.status(503).json({ message: "Email delivery is not configured on this server. Ask the operator to set it up." });
    }
    // Same answer whether or not the address exists — no account enumeration.
    // Demo accounts never sign in with a code: they only exist behind /api/demo/start.
    const known = !isDemoEmail(email) && (role === "admin"
      ? !!db.select().from(admins).where(eq(admins.email, email)).get()
      : !!db.select().from(facilitators).where(eq(facilitators.email, email)).get());
    if (!known) return res.json({ sent: true, delivery: mode === "dev" ? "dev" : "email" });
    const live = db.select().from(loginCodes).where(and(
      eq(loginCodes.email, email), isNull(loginCodes.usedAt), gt(loginCodes.expiresAt, now()),
    )).all();
    if (live.length >= 3) {
      return res.status(429).json({ message: "Too many codes requested. Use the latest one or wait 15 minutes." });
    }
    const code = String(randomInt(100000, 1000000));
    try {
      await sendCode(email, code);
    } catch (e: any) {
      return res.status(502).json({ message: e.message || "Could not send the email" });
    }
    db.insert(loginCodes).values({
      email, code: codeHash(email, code), role, expiresAt: now() + 15 * 60000, usedAt: null, attempts: 0,
    }).run();
    security("code_requested", `One-time code requested (${role})`);
    if (mode === "dev") return res.json({ sent: true, delivery: "dev", code });
    res.json({ sent: true, delivery: "email" });
  });

  app.post("/api/auth/verify-code", (req, res) => {
    const { email: rawEmail, code, role } = req.body as { email: string; code: string; role: string };
    const email = String(rawEmail || "").trim().toLowerCase();
    if (isDemoEmail(email)) return res.status(401).json({ message: "Code invalid or expired" });
    const policy = emailCodeAllowed(role);
    if (!policy.ok) return res.status(policy.status).json({ message: policy.message });
    const candidates = db.select().from(loginCodes).where(and(
      eq(loginCodes.email, email), eq(loginCodes.role, role),
      isNull(loginCodes.usedAt), gt(loginCodes.expiresAt, now()),
    )).all();
    const want = Buffer.from(codeHash(email, String(code || "").trim()));
    const row = candidates.find((c) => {
      const have = Buffer.from(c.code);
      return have.length === want.length && timingSafeEqual(have, want);
    });
    if (!row) {
      // Count the failure against every live code; burn after 5 tries.
      for (const c of candidates) {
        const attempts = (c.attempts ?? 0) + 1;
        db.update(loginCodes).set({ attempts, ...(attempts >= 5 ? { usedAt: now() } : {}) })
          .where(eq(loginCodes.id, c.id)).run();
      }
      return res.status(401).json({ message: "Code invalid or expired" });
    }
    db.update(loginCodes).set({ usedAt: now() }).where(eq(loginCodes.id, row.id)).run();

    let token: string;
    if (role === "admin") {
      const admin = db.select().from(admins).where(eq(admins.email, email)).get()!;
      token = createSession("admin", admin.id);
    } else {
      const fac = db.select().from(facilitators).where(eq(facilitators.email, email)).get()!;
      if (fac.status !== "active") return res.status(403).json({ message: "Facilitator rights withdrawn" });
      token = createSession("facilitator", fac.id);
    }
    security("signin", `Signed in with a one-time link (${role})`);
    res.json({ token });
  });

  app.get("/api/auth/session", (req, res) => {
    const session = getSession(getReqToken(req));
    if (!session) return res.json(null);
    const demo = isDemoActor(session);
    if (demo && !demoOn) { destroySession(session.token); return res.json(null); }
    let profile: any = null;
    if (session.role === "admin") {
      const a = db.select().from(admins).where(eq(admins.id, session.id)).get()!;
      profile = { email: a.email, demo };
    } else if (session.role === "facilitator") {
      const f = db.select().from(facilitators).where(eq(facilitators.id, session.id)).get()!;
      profile = { email: f.email, name: f.name, demo };
    } else {
      const s = db.select().from(seats).where(eq(seats.id, session.id)).get();
      // The seat was erased, or its room purged: the session has nothing left to stand for.
      if (!s) return res.json(null);
      const r = db.select().from(rooms).where(eq(rooms.id, s.roomId)).get();
      profile = { seatId: s.id, roomId: s.roomId, pseudonym: s.pseudonym, demo: demo || isDemoRoom(r) };
    }
    res.json({ role: session.role, ...profile });
  });

  app.get("/api/auth/oidc/start", (req, res) => oidcStart(req, res));
  app.get("/api/auth/oidc/callback", (req, res) => oidcCallback(req, res));
  app.post("/api/auth/oidc/claim", (req, res) => {
    const ticket = String(req.body?.ticket || "");
    if (!ticket) return res.status(400).json({ message: "Missing ticket" });
    res.json(oidcClaim(ticket));
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = getReqToken(req);
    if (token) destroySession(token);
    res.json({ ok: true });
  });

  /* ── Passkeys ─────────────────────────────────────────── */

  app.post("/api/auth/passkey/register/options", async (req, res) => {
    const session = requirePrivileged(req);
    const email = session.role === "admin"
      ? db.select().from(admins).where(eq(admins.id, session.id)).get()?.email
      : db.select().from(facilitators).where(eq(facilitators.id, session.id)).get()?.email;
    if (!email) return res.status(404).json({ message: "Account not found" });
    res.json(await registrationOptions(req, session.role, session.id, email));
  });

  app.post("/api/auth/passkey/register/verify", async (req, res) => {
    const session = requirePrivileged(req);
    const nickname = typeof req.body?.nickname === "string" ? req.body.nickname : undefined;
    res.json(await verifyRegistration(req, session.role, session.id, req.body?.response ?? req.body, nickname));
  });

  app.post("/api/auth/passkey/authenticate/options", async (req, res) => {
    res.json(await authenticationOptions(req));
  });

  app.post("/api/auth/passkey/authenticate/verify", async (req, res) => {
    const result = await verifyAuthentication(req, req.body?.response ?? req.body);
    security("signin", `Signed in with a passkey (${result.role})`);
    res.json(result);
  });

  app.get("/api/auth/passkeys", (req, res) => {
    const session = requirePrivileged(req);
    res.json(listPasskeys(session.role, session.id));
  });

  app.delete("/api/auth/passkeys/:id", (req, res) => {
    const session = requirePrivileged(req);
    if (!deletePasskey(session.role, session.id, Number(req.params.id))) {
      return res.status(404).json({ message: "Passkey not found" });
    }
    res.json({ ok: true });
  });

  /* ── Demos: one click per role, sample data only ──────── */

  // With demos off, every /api/demo/* path is simply not there.
  app.use("/api/demo", (_req, res, next) => {
    if (!demoOn) return res.status(404).json({ message: "Not found" });
    next();
  });

  app.post("/api/demo/start", (req, res) => {
    const role = String(req.body?.role || "") as DemoRole;
    if (!["admin", "facilitator", "participant", "verifier"].includes(role)) {
      return res.status(400).json({ message: "Unknown demo role" });
    }
    security("demo_started", `Demo started (${role})`);
    res.json(startDemo(role));
  });

  app.post("/api/demo/reset", (_req, res) => {
    const { live, sealed } = resetDemo();
    res.json({ ok: true, liveCode: live.code, sealedCode: sealed.code });
  });

  /* ── Admin ────────────────────────────────────────────── */

  app.get("/api/platform/settings", (_req, res) => {
    res.json(settings());
  });

  app.patch("/api/platform/settings", (req, res) => {
    requireRole(req, "admin");
    const s = settings();
    const b = req.body;
    const turn = Math.min(15, Math.max(5, b.defaultTurnMinutes ?? s.defaultTurnMinutes));
    // Retention must be a whole number of days, 1–3650. Anything else (missing,
    // null, text, absurd) falls back to the current value rather than purging early.
    const days = (v: unknown, fallback: number) => {
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 1 ? Math.min(3650, n) : fallback;
    };
    db.update(platformSettings).set({
      orgName: b.orgName ?? s.orgName,
      defaultTurnMinutes: turn,
      requireRoleProofsDefault: b.requireRoleProofsDefault == null ? s.requireRoleProofsDefault : (b.requireRoleProofsDefault ? 1 : 0),
      closedRoomRetentionDays: days(b.closedRoomRetentionDays, s.closedRoomRetentionDays),
      guestSessionRetentionDays: days(b.guestSessionRetentionDays, s.guestSessionRetentionDays),
      applicationRetentionDays: days(b.applicationRetentionDays, s.applicationRetentionDays),
      // A partial save (the sign-in policy sends only its two fields) must not
      // switch this off: with it off, the purge deletes sealed ledgers.
      sealedLedgerKept: b.sealedLedgerKept == null ? s.sealedLedgerKept : (b.sealedLedgerKept ? 1 : 0),
      requirePasskey: b.requirePasskey == null ? s.requirePasskey : (b.requirePasskey ? 1 : 0),
      emailCodeEnabled: b.emailCodeEnabled == null ? s.emailCodeEnabled : (b.emailCodeEnabled ? 1 : 0),
    }).where(eq(platformSettings.id, 1)).run();
    audit(null, "admin", "platform_settings_changed");
    res.json(settings());
  });

  app.get("/api/admin/applications", (req, res) => {
    if (requireRole(req, "admin", { allowDemo: true }).demo) return res.json([]);
    const rows = db.select().from(facilitatorApplications)
      .where(eq(facilitatorApplications.status, "pending")).all();
    res.json(rows);
  });

  app.post("/api/admin/applications/:id/decide", (req, res) => {
    const session = requireRole(req, "admin");
    const approve = !!req.body.approve;
    const app = db.select().from(facilitatorApplications)
      .where(eq(facilitatorApplications.id, Number(req.params.id))).get();
    if (!app) return res.status(404).json({ message: "Application not found" });
    db.update(facilitatorApplications).set({
      status: approve ? "approved" : "rejected", decidedAt: now(),
    }).where(eq(facilitatorApplications.id, app.id)).run();

    let link: string | null = null;
    if (approve) {
      let fac = db.select().from(facilitators).where(eq(facilitators.email, app.email)).get();
      if (!fac) {
        fac = db.insert(facilitators).values({
          email: app.email, name: app.name, status: "active", createdAt: now(),
        }).returning().get();
      }
      const token = uid(16);
      db.insert(enrolmentLinks).values({
        token, email: app.email, facilitatorId: fac.id,
        expiresAt: now() + 7 * DAY, usedAt: null,
      }).run();
      link = token;
    }
    audit(null, "admin", `application_${approve ? "approved" : "rejected"}`);
    res.json({ ok: true, enrolmentToken: link });
  });

  app.get("/api/admin/facilitators", (req, res) => {
    const session = requireRole(req, "admin", { allowDemo: true });
    res.json(db.select().from(facilitators).all().filter((f) => isDemoEmail(f.email) === session.demo));
  });

  app.post("/api/admin/facilitators/:id/withdraw", (req, res) => {
    requireRole(req, "admin");
    const fac = db.select().from(facilitators).where(eq(facilitators.id, Number(req.params.id))).get();
    if (!fac) return res.status(404).json({ message: "Facilitator not found" });
    db.update(facilitators).set({ status: "withdrawn" }).where(eq(facilitators.id, fac.id)).run();
    audit(null, "admin", "facilitator_rights_withdrawn");
    res.json({ ok: true });
  });

  app.post("/api/admin/facilitators/:id/restore", (req, res) => {
    requireRole(req, "admin");
    db.update(facilitators).set({ status: "active" })
      .where(eq(facilitators.id, Number(req.params.id))).run();
    audit(null, "admin", "facilitator_rights_restored");
    res.json({ ok: true });
  });

  app.get("/api/admin/blocked-countries", (req, res) => {
    if (requireRole(req, "admin", { allowDemo: true }).demo) return res.json([]);
    res.json(db.select().from(blockedCountries).all());
  });

  app.post("/api/admin/blocked-countries", (req, res) => {
    requireRole(req, "admin");
    const { code, name } = req.body;
    if (!code || !name) return res.status(400).json({ message: "Code and name required" });
    db.insert(blockedCountries).values({ code: code.toUpperCase(), name }).run();
    audit(null, "admin", "blocked_country_added");
    res.json({ ok: true });
  });

  app.delete("/api/admin/blocked-countries/:id", (req, res) => {
    requireRole(req, "admin");
    db.delete(blockedCountries).where(eq(blockedCountries.id, Number(req.params.id))).run();
    audit(null, "admin", "blocked_country_removed");
    res.json({ ok: true });
  });

  app.get("/api/admin/data-requests", (req, res) => {
    if (requireRole(req, "admin", { allowDemo: true }).demo) return res.json([]);
    res.json(db.select().from(dataRequests).orderBy(desc(dataRequests.createdAt)).all());
  });

  app.post("/api/admin/data-requests/:id/decide", (req, res) => {
    const session = requireRole(req, "admin");
    const decision = req.body.decision;
    if (decision !== "completed" && decision !== "rejected") {
      return res.status(400).json({ message: "Decision must be completed or rejected" });
    }
    const row = db.select().from(dataRequests).where(eq(dataRequests.id, Number(req.params.id))).get();
    if (!row) return res.status(404).json({ message: "Request not found" });
    if (row.status !== "open") return res.status(409).json({ message: "Request already decided" });
    if (decision === "completed" && row.kind === "erasure") {
      const target = erasureTarget(row);
      if (target === "ambiguous") {
        // Never guess whose data to delete.
        return res.status(409).json({ message: "More than one seat uses this pseudonym. Nothing was erased." });
      }
      if (target) eraseSeatData(target.id);
    }
    // handler and time only — no content recorded
    db.update(dataRequests).set({
      status: decision, handler: "administrator", decidedAt: now(),
    }).where(eq(dataRequests.id, row.id)).run();
    audit(null, "admin", `data_request_${decision}`);
    res.json({ ok: true });
  });

  /**
   * The seat an erasure request refers to. Requests record the seat id
   * (`detail: "seat:<id>"`); pseudonyms can be chosen by participants and
   * repeat across rooms, so a pseudonym alone identifies a seat only when it
   * is unique. Older requests without a seat id fall back to that rule.
   */
  function erasureTarget(row: { requester: string; detail: string | null }) {
    const m = /^seat:(\d+)$/.exec(row.detail ?? "");
    if (m) return db.select().from(seats).where(eq(seats.id, Number(m[1]))).get() ?? null;
    const matches = db.select().from(seats).where(eq(seats.pseudonym, row.requester)).all();
    if (matches.length > 1) return "ambiguous" as const;
    return matches[0] ?? null;
  }

  function eraseSeatData(seatId: number) {
    const authored = db.select().from(entries)
      .where(and(eq(entries.authorSeatId, seatId), inArray(entries.status, ["pending", "rejected"]))).all();
    for (const e of authored) {
      db.delete(entryVersions).where(eq(entryVersions.entryId, e.id)).run();
      db.delete(consents).where(eq(consents.entryId, e.id)).run();
      db.delete(entries).where(eq(entries.id, e.id)).run();
    }
    db.delete(followups).where(eq(followups.ownerSeatId, seatId)).run();
    db.delete(seats).where(eq(seats.id, seatId)).run();
  }

  app.get("/api/admin/security-events", (req, res) => {
    if (requireRole(req, "admin", { allowDemo: true }).demo) return res.json([]);
    const hours = { "24h": 24, "7d": 168, "30d": 720, "90d": 2160 }[String(req.query.range)] ?? 24;
    const since = now() - hours * 3600000;
    res.json(db.select().from(securityEvents)
      .where(gt(securityEvents.createdAt, since)).orderBy(desc(securityEvents.createdAt)).all());
  });

  app.post("/api/admin/purge", (req, res) => {
    requireRole(req, "admin");
    const report = purgeExpired();
    audit(null, "admin", "purge_run_now");
    res.json(report);
  });

  app.get("/api/admin/audit", (req, res) => {
    const session = requireRole(req, "admin", { allowDemo: true });
    if (session.demo) {
      // Demo rooms' process trail only; nothing about real rooms, not even a count.
      const demoIds = new Set(db.select().from(rooms).all().filter(isDemoRoom).map((r) => r.id));
      const mine = db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).all()
        .filter((e) => e.roomId !== null && demoIds.has(e.roomId));
      return res.json({ chain: { total: mine.length, intact: auditVerify().intact }, entries: mine.slice(0, 100) });
    }
    res.json({
      chain: auditVerify(), // anyone can confirm the trail was not edited
      entries: db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(100).all(),
    });
  });

  /* ── Outcome analytics: counts only, never conversation content ── */

  app.get("/api/admin/analytics", (req, res) => {
    const session = requireRole(req, "admin", { allowDemo: true });
    // The demo administrator counts demo rooms only; a real one counts real rooms only.
    const roomRows = db.select().from(rooms).all().filter((r) => isDemoRoom(r) === session.demo);
    const ids = new Set(roomRows.map((r) => r.id));
    const seatRows = db.select().from(seats).all().filter((x) => ids.has(x.roomId));
    const entryRows = db.select().from(entries).all().filter((x) => ids.has(x.roomId));
    const followupRows = db.select().from(followups).all().filter((x) => ids.has(x.roomId));
    const summaryRows = db.select().from(summaryVersions).all().filter((x) => ids.has(x.roomId));
    const svIds = new Set(summaryRows.map((x) => x.id));
    const confirmRows = db.select().from(summaryConfirmations).all().filter((x) => svIds.has(x.summaryVersionId));
    const count = (arr: { status?: string }[], s: string) => arr.filter((x) => x.status === s).length;
    res.json({
      rooms: {
        total: roomRows.length,
        draft: count(roomRows, "draft"), live: count(roomRows, "live"),
        closed: count(roomRows, "closed"), sealed: count(roomRows, "sealed"),
      },
      seats: {
        admitted: count(seatRows, "admitted"), waiting: count(seatRows, "waiting"),
        departed: seatRows.filter((s) => ["left", "removed"].includes(s.status)).length,
      },
      entries: {
        approved: count(entryRows, "approved"), pending: count(entryRows, "pending"),
        rejected: count(entryRows, "rejected"),
      },
      followups: {
        open: count(followupRows, "open"), kept: count(followupRows, "kept"),
        lapsed: count(followupRows, "lapsed"),
      },
      summaries: {
        versions: summaryRows.length, locked: summaryRows.filter((s) => s.locked).length,
        verifications: confirmRows.filter((c) => c.confirmed).length,
      },
    });
  });

  /* ── Facilitator ───────────────────────────────────────── */

  app.post("/api/facilitator/apply", (req, res) => {
    const { name, affiliation, email, country, experience, adult } = req.body;
    if (!name || !email || !country || !experience) {
      return res.status(400).json({ message: "Name, email, country and experience are required" });
    }
    if (!adult) return res.status(400).json({ message: "Eighteen-plus confirmation required" });
    const blocked = db.select().from(blockedCountries).all();
    const isBlocked = blocked.some((c) => c.name.toLowerCase() === String(country).toLowerCase());
    if (isBlocked) {
      security("application_blocked_country", "Application screened out by the blocked-country list");
      return res.status(403).json({ message: "Applications from that country are not accepted" });
    }
    db.insert(facilitatorApplications).values({
      name, affiliation: affiliation || null, email, country, experience,
      status: "pending", createdAt: now(),
    }).run();
    security("application_submitted", "Facilitator application submitted");
    res.json({ ok: true });
  });

  app.post("/api/facilitator/enrol", (req, res) => {
    const { token } = req.body;
    const link = db.select().from(enrolmentLinks).where(and(
      eq(enrolmentLinks.token, token), isNull(enrolmentLinks.usedAt), gt(enrolmentLinks.expiresAt, now()),
    )).get();
    if (!link) return res.status(401).json({ message: "Enrolment code invalid, used, or expired" });
    db.update(enrolmentLinks).set({ usedAt: now() }).where(eq(enrolmentLinks.id, link.id)).run();
    const sessionToken = createSession("facilitator", link.facilitatorId);
    audit(null, "facilitator", "enrolled");
    res.json({ token: sessionToken });
  });

  // Active colleagues a room can be handed to: id and name only.
  app.get("/api/facilitator/colleagues", (req, res) => {
    const session = requireRole(req, "facilitator");
    res.json(db.select().from(facilitators)
      .where(eq(facilitators.status, "active")).all()
      .filter((f) => f.id !== session.id && isDemoEmail(f.email) === session.demo)
      .map((f) => ({ id: f.id, name: f.name })));
  });

  app.get("/api/facilitator/rooms", (req, res) => {
    const session = requireRole(req, "facilitator");
    res.json(db.select().from(rooms).where(eq(rooms.facilitatorId, session.id)).all().filter((r) => sameWorld(session, r)));
  });

  app.post("/api/facilitator/rooms", (req, res) => {
    const session = requireRole(req, "facilitator");
    const s = settings();
    const b = req.body;
    const anonymityMode = b.anonymityMode === "open" ? "open" : "anonymous";
    // Series: continue from one of this facilitator's sealed ledgers.
    let prev: typeof rooms.$inferSelect | undefined;
    if (b.continueFrom) {
      prev = db.select().from(rooms).where(eq(rooms.code, String(b.continueFrom).toUpperCase())).get();
      if (!prev || prev.status !== "sealed" || prev.facilitatorId !== session.id || !sameWorld(session, prev)) {
        return res.status(400).json({ message: "Pick one of your sealed rooms to continue from" });
      }
    }
    // The client never picks a series key under the reserved "demo:" prefix; the demo always does.
    const asked = typeof b.seriesKey === "string" && !b.seriesKey.startsWith("demo:") ? b.seriesKey : null;
    const seriesKey = session.demo
      ? "demo:sandbox"
      : asked || prev?.seriesKey || (prev ? `series:${prev.code}` : null);
    if (prev && !prev.seriesKey) db.update(rooms).set({ seriesKey }).where(eq(rooms.id, prev.id)).run();
    // Tier: seat cap and turn length come from the tier's ranges, never from the client alone.
    const tier = isTier(b.tier) ? b.tier : DEFAULT_TIER;
    const { seatCap, turnSeconds } = tierSettings(tier, b.seatCap, b.turnSeconds);
    const sealThreshold = isThreshold(b.sealThreshold) ? b.sealThreshold : "consensus";
    const room = db.insert(rooms).values({
      code: uid(6).toUpperCase(),
      title: b.title,
      purpose: b.purpose || null,
      facilitatorId: session.id,
      status: "draft",
      anonymityMode,
      turnMinutes: Math.max(1, Math.ceil(turnSeconds / 60)), // legacy readers; turnSeconds is authoritative
      turnSeconds, tier, seatCap, sealThreshold,
      expiresAt: now() + (b.durationDays ?? 1) * DAY,
      requiresRoleProof: (b.requiresRoleProof ?? s.requireRoleProofsDefault) ? 1 : 0,
      chathamHouse: b.chathamHouse === false ? 0 : 1,
      nextStepReview: b.nextStepReview ? 1 : 0,
      retentionDays: b.retentionDays ?? null,
      seriesKey,
      continuesFrom: prev?.code ?? null,
      sessionAt: b.sessionAt || null,
      createdAt: now(),
    }).returning().get();
    audit(room.id, "facilitator", "room_created");
    const carried = prev ? carryForward(prev, room.id) : 0;
    if (prev) audit(room.id, "facilitator", "series_carried_forward");
    res.json({ ...room, carried });
  });

  app.get("/api/facilitator/rooms/:id", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const agenda = db.select().from(agendaItems).where(eq(agendaItems.roomId, room.id))
      .orderBy(agendaItems.position).all();
    const seatRows = db.select().from(seats).where(eq(seats.roomId, room.id)).all();
    const entryRows = db.select().from(entries).where(eq(entries.roomId, room.id)).all();
    const entryList = entryRows.map((e) => {
      const versions = db.select().from(entryVersions)
        .where(eq(entryVersions.entryId, e.id)).orderBy(entryVersions.version).all();
      const consentRows = db.select().from(consents).where(eq(consents.entryId, e.id)).all();
      if (!isRecordKind(e.kind)) return { ...e, versions, consents: consentRows, tally: null };
      // Structured items: the facilitator sees how many have answered, never who or what.
      // The aggregate arrives only once every seat has answered: levels only in rooms
      // under seven seats, counts otherwise. Per-seat consent rows are never sent.
      return { ...e, versions, consents: [], tally: facilitatorTally(tallyFor(e.id, room)) };
    });
    const inviteRows = db.select().from(invites).where(eq(invites.roomId, room.id)).all();
    const followupRows = db.select().from(followups).where(eq(followups.roomId, room.id)).all();
    const noteRows = db.select().from(notes).where(eq(notes.roomId, room.id))
      .orderBy(desc(notes.createdAt)).all();
    const auditRows = db.select().from(auditLog).where(eq(auditLog.roomId, room.id))
      .orderBy(desc(auditLog.createdAt)).limit(40).all();
    const lapsedCarried = room.seriesKey
      ? db.select().from(followups).where(and(
          eq(followups.roomId, room.id), eq(followups.ownerSeatId, 0))).all()
      : [];
    const summaryRows = db.select().from(summaryVersions).where(eq(summaryVersions.roomId, room.id))
      .orderBy(desc(summaryVersions.version)).all().map((v) => ({
        ...v,
        confirmations: db.select().from(summaryConfirmations)
          .where(eq(summaryConfirmations.summaryVersionId, v.id)).all(),
      }));
    res.json({
      room, agenda, seats: seatRows, entries: entryList, invites: inviteRows,
      followups: followupRows, notes: noteRows, audit: auditRows, summaries: summaryRows,
    });
  });

  /* ── Process controls: stages, input lock, caucus ── */

  app.post("/api/facilitator/rooms/:id/stage", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const stage = ["opening", "joint", "caucus", "drafting", "closing"].includes(req.body.stage)
      ? req.body.stage : "opening";
    const minutes = Number(req.body.minutes) || 0;
    db.update(rooms).set({
      stage,
      stageEndsAt: minutes > 0 ? now() + minutes * 60000 : null,
    }).where(eq(rooms.id, room.id)).run();
    audit(room.id, "facilitator", `stage_set_${stage}`);
    res.json({ ok: true });
  });

  app.post("/api/facilitator/rooms/:id/lock", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const locked = !!req.body.locked;
    db.update(rooms).set({ inputLocked: locked ? 1 : 0 }).where(eq(rooms.id, room.id)).run();
    audit(room.id, "facilitator", locked ? "input_locked" : "input_unlocked");
    res.json({ ok: true });
  });

  app.post("/api/facilitator/rooms/:id/caucus", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const seatId = req.body.seatId ? Number(req.body.seatId) : null;
    if (seatId) {
      const seat = db.select().from(seats)
        .where(and(eq(seats.id, seatId), eq(seats.roomId, room.id), eq(seats.status, "admitted"))).get();
      if (!seat) return res.status(400).json({ message: "Pick an admitted seat for the caucus" });
      // If switching from a previous caucus, wipe former caucus channel from RAM
      if (room.caucusSeatId && room.caucusSeatId !== seatId) {
        chatWipeCaucus(room.id, `caucus:${room.caucusSeatId}`);
      }
    } else {
      // Merging back into the floor: actively shred caucus messages from memory
      chatWipeCaucus(room.id);
    }
    db.update(rooms).set({ caucusSeatId: seatId }).where(eq(rooms.id, room.id)).run();
    audit(room.id, "facilitator", seatId ? "caucus_opened" : "caucus_closed_memory_shredded");
    res.json({ ok: true, memoryShredded: !seatId });
  });

  /* ── Facilitator chat (floor relay + caucus thread) ── */

  app.get("/api/facilitator/rooms/:id/chat", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const channel = req.query.channel === "caucus" && room.caucusSeatId
      ? `caucus:${room.caucusSeatId}` : "floor";
    res.json(chatRecent(room.id, channel));
  });

  app.post("/api/facilitator/rooms/:id/chat", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const useCaucus = req.body.caucus && room.caucusSeatId;
    const { epoch, iv, ct } = req.body;
    if (!Number.isInteger(epoch) || !isB64(iv, 32) || !isB64(ct, CHAT_CT_MAX)) {
      return res.status(400).json({ message: "Chat accepts encrypted messages only" });
    }
    chatPush(room.id, { epoch, iv, ct, channel: useCaucus ? `caucus:${room.caucusSeatId}` : "floor" });
    res.json({ ok: true });
  });

  /* ── End-to-end encryption key directory ──
     The server stores public keys and room keys wrapped *for* each seat.
     It never sees a room key in the clear (except demo rooms, below). */

  app.get("/api/facilitator/rooms/:id/e2ee", async (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const c = cryptoFor(room.id);
    const admitted = db.select().from(seats)
      .where(and(eq(seats.roomId, room.id), eq(seats.status, "admitted"))).all();
    const demo = isDemoRoom(room) ? await demoSteward(room.id) : null;
    res.json({
      epoch: c.epoch, rekeyNeeded: c.rekeyNeeded, roomCode: room.code,
      attestPubs: JSON.parse(room.attestPubs || "[]"),
      demo, // demo rooms only: key held by the server so the demo works on one device
      seats: admitted.map((st) => {
        const pub = c.seatPubs.get(st.id) ?? null;
        const signPub = c.signPubs.get(st.id) ?? null;
        const cert = c.certs.get(st.id);
        const w = c.wraps.get(st.id);
        return {
          seatId: st.id, pub, pubHash: pub ? serverPubHash(pub) : null,
          wrapped: !!(w && pub && w.epoch === c.epoch && w.pubHash === serverPubHash(pub)),
          signPub, cert: cert && cert.signPub === signPub ? cert : null,
        };
      }),
    });
  });

  app.post("/api/facilitator/rooms/:id/e2ee/epoch", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    if (isDemoRoom(room)) return res.status(400).json({ message: "Demo rooms use the demo key" });
    const c = cryptoFor(room.id);
    const { epoch, attestPub } = req.body;
    if (epoch !== c.epoch + 1 || !isB64(attestPub, 200)) {
      return res.status(409).json({ message: "Key epoch out of date", epoch: c.epoch });
    }
    c.epoch = epoch;
    c.wraps.clear();
    c.rekeyNeeded = false;
    addAttestPub(room.id, attestPub);
    res.json({ ok: true, epoch });
  });

  app.post("/api/facilitator/rooms/:id/e2ee/wrap", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const c = cryptoFor(room.id);
    const { seatId, epoch, pubHash, eph, iv, ct, sig } = req.body;
    const seat = db.select().from(seats)
      .where(and(eq(seats.id, Number(seatId)), eq(seats.roomId, room.id), eq(seats.status, "admitted"))).get();
    if (!seat) return res.status(400).json({ message: "Seat is not admitted" });
    const pub = c.seatPubs.get(seat.id);
    if (epoch !== c.epoch || !pub || pubHash !== serverPubHash(pub)) {
      return res.status(409).json({ message: "Seat key or epoch changed — try again" });
    }
    if (!isB64(eph, 200) || !isB64(iv, 32) || !isB64(ct, 2000) || !isB64(sig, 200)) {
      return res.status(400).json({ message: "Malformed key wrap" });
    }
    c.wraps.set(seat.id, { epoch, pubHash, eph, iv, ct, sig });
    res.json({ ok: true });
  });

  // Sender certificate: the facilitator's signature over (room, seat, label,
  // signing-key hash). Relayed as-is; every browser verifies it itself.
  app.post("/api/facilitator/rooms/:id/e2ee/cert", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    if (isDemoRoom(room)) return res.status(400).json({ message: "Demo rooms use the demo key" });
    const c = cryptoFor(room.id);
    const { seatId, label, signPub, sig } = req.body;
    const seat = db.select().from(seats)
      .where(and(eq(seats.id, Number(seatId)), eq(seats.roomId, room.id), eq(seats.status, "admitted"))).get();
    if (!seat) return res.status(400).json({ message: "Seat is not admitted" });
    if (typeof label !== "string" || !label || label.length > 120 || !isB64(sig, 200)) {
      return res.status(400).json({ message: "Malformed sender certificate" });
    }
    if (signPub !== c.signPubs.get(seat.id)) {
      return res.status(409).json({ message: "Seat signing key changed — try again" });
    }
    c.certs.set(seat.id, { seatId: seat.id, label, signPub, sig });
    res.json({ ok: true });
  });

  /* ── Structured outcome summary ── */

  app.get("/api/facilitator/rooms/:id/summary.md", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const latest = db.select().from(summaryVersions).where(eq(summaryVersions.roomId, room.id))
      .orderBy(desc(summaryVersions.version)).limit(1).get();
    if (!latest) return res.status(404).json({ message: "No summary written yet" });
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="diavanish-summary-${room.code}.md"`);
    res.send(summaryMarkdown(room, latest));
  });

  app.post("/api/facilitator/rooms/:id/summary", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const latest = db.select().from(summaryVersions).where(eq(summaryVersions.roomId, room.id))
      .orderBy(desc(summaryVersions.version)).limit(1).get();
    if (latest?.locked) {
      return res.status(400).json({ message: "This summary is locked as final — start a new room to revise it" });
    }
    const version = (latest?.version ?? 0) + 1;
    db.insert(summaryVersions).values({
      roomId: room.id, version,
      agreements: String(req.body.agreements ?? ""),
      openIssues: String(req.body.openIssues ?? ""),
      nextSteps: String(req.body.nextSteps ?? ""),
      disagreements: String(req.body.disagreements ?? ""),
      deadlines: String(req.body.deadlines ?? ""),
      locked: 0, createdAt: now(),
    }).run();
    audit(room.id, "facilitator", "summary_version_written");
    res.json({ ok: true, version });
  });

  app.post("/api/facilitator/rooms/:id/summary/:versionId/lock", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const v = db.select().from(summaryVersions)
      .where(and(eq(summaryVersions.id, Number(req.params.versionId)), eq(summaryVersions.roomId, room.id))).get();
    if (!v) return res.status(404).json({ message: "Summary version not found" });
    db.update(summaryVersions).set({ locked: 1 }).where(eq(summaryVersions.id, v.id)).run();
    audit(room.id, "facilitator", "summary_locked_final");
    res.json({ ok: true });
  });

  app.post("/api/facilitator/rooms/:id/open", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    if (room.status !== "draft") return res.status(400).json({ message: "Only draft rooms can open" });
    let carried = 0;
    // Rooms continued from a sealed ledger already hold their carried items as drafts.
    if (room.seriesKey && !room.continuesFrom) carried = carryLapsed(room.seriesKey, room.id);
    db.update(rooms).set({ status: "live" }).where(eq(rooms.id, room.id)).run();
    audit(room.id, "facilitator", "room_opened");
    res.json({ ok: true, carried });
  });

  app.post("/api/facilitator/rooms/:id/agenda", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const count = db.select().from(agendaItems).where(eq(agendaItems.roomId, room.id)).all().length;
    db.insert(agendaItems).values({
      roomId: room.id, position: count + 1, title: req.body.title, status: "open",
    }).run();
    audit(room.id, "facilitator", "agenda_added");
    res.json({ ok: true });
  });

  app.post("/api/facilitator/agenda/:id/status", (req, res) => {
    const session = requireRole(req, "facilitator");
    const item = db.select().from(agendaItems).where(eq(agendaItems.id, Number(req.params.id))).get();
    if (!item) return res.status(404).json({ message: "Agenda item not found" });
    myRoom(session, item.roomId); // only the room's own facilitator, and never across demo/real
    db.update(agendaItems).set({ status: req.body.status === "covered" ? "covered" : "open" })
      .where(eq(agendaItems.id, item.id)).run();
    audit(item.roomId, "facilitator", "agenda_status_changed");
    res.json({ ok: true });
  });

  app.post("/api/facilitator/rooms/:id/invites", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    // The invite code is generated in the facilitator's browser. The server
    // sees only its hash, plus — for role-bound invites — a signature from the
    // facilitator's device binding (room, role, invite) together.
    const { inviteHash, role, sig, pub } = req.body as { inviteHash: string; role?: string; sig?: string; pub?: string };
    if (!isB64(inviteHash, 60)) return res.status(400).json({ message: "Invite hash required" });
    let attestation: string | null = null;
    const boundRole = role ? String(role).trim().slice(0, 60) : null;
    if (boundRole) {
      const known: string[] = JSON.parse(room.attestPubs || "[]");
      if (!isB64(sig, 200) || !isB64(pub, 200) || !known.includes(pub!)) {
        return res.status(400).json({ message: "Role-bound invites must be signed on the facilitator's device" });
      }
      attestation = JSON.stringify({ sig, pub });
    }
    db.insert(invites).values({
      roomId: room.id, token: inviteHash, expiresAt: now() + 7 * DAY, usedAt: null,
      role: boundRole, attestation,
    }).run();
    audit(room.id, "facilitator", boundRole ? "invite_issued_role_bound" : "invite_issued");
    res.json({ ok: true });
  });

  app.post("/api/facilitator/seats/:id/:action", (req, res) => {
    const session = requireRole(req, "facilitator");
    const seat = db.select().from(seats).where(eq(seats.id, Number(req.params.id))).get();
    if (!seat) return res.status(404).json({ message: "Seat not found" });
    const room = db.select().from(rooms).where(eq(rooms.id, seat.roomId)).get();
    if (!room || room.facilitatorId !== session.id || !sameWorld(session, room)) return res.status(404).json({ message: "Seat not found" });
    const action = req.params.action;
    if (!["admit", "remove", "ban"].includes(action)) {
      return res.status(400).json({ message: "Unknown action" });
    }
    const status = action === "admit" ? "admitted" : action === "remove" ? "removed" : "banned";
    if (action === "admit" && room.seatCap && seat.status !== "admitted") {
      const admittedNow = db.select().from(seats).where(and(eq(seats.roomId, room.id), eq(seats.status, "admitted"))).all().length;
      if (admittedNow >= room.seatCap) return res.status(400).json({ message: `This room is full: ${room.seatCap} seats` });
    }
    db.update(seats).set({ status }).where(eq(seats.id, seat.id)).run();
    if (action !== "admit") {
      // A removed seat still holds the old key: rotate so it can't read on.
      const c = cryptoFor(room.id);
      c.wraps.delete(seat.id);
      c.seatPubs.delete(seat.id);
      c.rekeyNeeded = true;
    }
    audit(room.id, "facilitator", `seat_${action}`);
    res.json({ ok: true });
  });

  app.post("/api/facilitator/rooms/:id/floor", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const { action, seatId } = req.body as { action: string; seatId?: number };
    if (room.status !== "live") return res.status(400).json({ message: "Floor runs only in live rooms" });
    if (action === "start") {
      const seat = seatId ? db.select().from(seats).where(and(eq(seats.id, seatId), eq(seats.status, "admitted"))).get() : null;
      if (!seat) return res.status(400).json({ message: "Pick an admitted seat to hold the floor" });
      const turnNumber = room.turnNumber + 1;
      db.update(rooms).set({
        floorState: "running", floorSeatId: seat.id,
        floorEndsAt: now() + turnMs(room), turnNumber,
      }).where(eq(rooms.id, room.id)).run();
      audit(room.id, "facilitator", "floor_started");
    } else if (action === "pause" || action === "resume") {
      if (room.floorState === "idle") return res.status(400).json({ message: "No turn running" });
      if (action === "pause") {
        db.update(rooms).set({ floorState: "paused", floorEndsAt: room.floorEndsAt })
          .where(eq(rooms.id, room.id)).run();
      } else {
        db.update(rooms).set({ floorState: "running" }).where(eq(rooms.id, room.id)).run();
      }
      audit(room.id, "facilitator", `floor_${action}`);
    } else if (action === "extend") {
      if (room.tier && TIER_SPECS[room.tier as keyof typeof TIER_SPECS]?.rigidTurns) {
        return res.status(400).json({ message: "Plenary turns are fixed length and cannot be extended" });
      }
      const mins = Math.max(1, Number(req.body.minutes) || 2);
      db.update(rooms).set({ floorEndsAt: (room.floorEndsAt ?? now()) + mins * 60000 })
        .where(eq(rooms.id, room.id)).run();
      audit(room.id, "facilitator", "floor_extended");
    } else if (action === "end") {
      db.update(rooms).set({ floorState: "idle", floorSeatId: null, floorEndsAt: null })
        .where(eq(rooms.id, room.id)).run();
      audit(room.id, "facilitator", "floor_ended");
    } else {
      return res.status(400).json({ message: "Unknown action" });
    }
    res.json({ ok: true });
  });

  app.post("/api/facilitator/entries", (req, res) => {
    const session = requireRole(req, "facilitator");
    const { roomId, agendaItemId, kind, visibility, conditionText, text, redactionChecked } = req.body;
    const room = myRoom(session, Number(roomId));
    if (kind && !LEGACY_KINDS.includes(kind)) {
      return res.status(400).json({ message: "Structured record items go through the record composer" });
    }
    const entry = db.insert(entries).values({
      roomId: room.id,
      agendaItemId: agendaItemId || null,
      kind: kind || "summary",
      visibility: ["all", "facilitator", "conditional"].includes(visibility) ? visibility : "all",
      status: "pending",
      authorSeatId: null,
      redactionChecked: redactionChecked ? 1 : 0,
      conditionText: conditionText || null,
      createdAt: now(),
    }).returning().get();
    db.insert(entryVersions).values({
      entryId: entry.id, version: 1, text, createdAt: now(),
    }).run();
    audit(room.id, "facilitator", "entry_composed");
    res.json(entry);
  });

  /* ── Structured record (ledger v2): one consented item at a time ── */

  app.post("/api/facilitator/rooms/:id/record", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    if (room.status === "sealed") return res.status(400).json({ message: "This ledger is sealed" });
    const { kind, payload, agendaItemId } = req.body ?? {};
    const agendaId = agendaItemId ? Number(agendaItemId) : null;
    if (agendaId && !db.select().from(agendaItems).where(and(eq(agendaItems.id, agendaId), eq(agendaItems.roomId, room.id))).get()) {
      return res.status(400).json({ message: "Agenda item not found" });
    }
    const checked = validateRecord(String(kind), payload, recordContext(room));
    if (!checked.ok) return res.status(400).json({ message: checked.error });
    const entry = db.insert(entries).values({
      roomId: room.id, agendaItemId: agendaId, kind: String(kind), visibility: "all", status: "pending",
      authorSeatId: null, redactionChecked: 0, createdAt: now(),
    }).returning().get();
    db.insert(entryVersions).values({
      entryId: entry.id, version: 1, text: checked.text, payload: JSON.stringify(checked.payload), createdAt: now(),
    }).run();
    audit(room.id, "facilitator", `record_${kind}_proposed`);
    res.json(entry);
  });

  app.post("/api/facilitator/entries/:id/approve", (req, res) => {
    const session = requireRole(req, "facilitator");
    const entry = db.select().from(entries).where(eq(entries.id, Number(req.params.id))).get();
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    const room = myRoom(session, entry.roomId);
    if (room.status === "sealed") return res.status(400).json({ message: "This ledger is sealed" });
    if (isRecordKind(entry.kind)) {
      // Room approval: every admitted seat has chosen a support level for this exact version.
      const tally = tallyFor(entry.id, room);
      if (!tally.ready) {
        const d = tally.decision;
        const counts = tally.detail === "counts"; // rooms under seven seats never get numbers back
        const rule = room.sealThreshold === "super75" ? "a 75% supermajority" : room.sealThreshold === "super66" ? "a two-thirds supermajority" : "full consensus";
        return res.status(400).json({
          message: d.blocker === "waiting"
            ? `Waiting for the room: ${d.answered} of ${d.required} have answered`
            : d.blocker === "rewording"
              ? `${counts ? `${tally.rewording} of ${tally.required}` : "A seat"} asked for rewording. Revise the item, then ask again.`
              : d.blocker === "objection"
                ? `This room seals by full consensus, and there is an objection on record. Revise the item or set it aside.`
                : counts
                  ? `Short of ${rule}: ${d.consenting} of ${d.required} consent${tally.rewording ? `, ${tally.rewording} asked for rewording` : ""}`
                  : `Short of ${rule}${tally.rewording ? ", and rewording was asked for" : ""}`,
        });
      }
    }
    if (entry.kind === "next-step" && room.nextStepReview) {
      const reviewRows = db.select().from(consents).where(eq(consents.entryId, entry.id)).all();
      const confirmed = reviewRows.filter((c) => c.confirmed).length;
      if (confirmed < (req.body.requiredConfirmations ?? 0)) {
        return res.status(400).json({
          message: `Next-step review on: ${confirmed} of ${req.body.requiredConfirmations} named reviewers have confirmed this version`,
        });
      }
    }
    db.update(entries).set({ status: "approved", approvedAt: now() })
      .where(eq(entries.id, entry.id)).run();
    audit(entry.roomId, "facilitator", "entry_approved");
    res.json({ ok: true });
  });

  app.post("/api/facilitator/entries/:id/revise", (req, res) => {
    const session = requireRole(req, "facilitator");
    const entry = db.select().from(entries).where(eq(entries.id, Number(req.params.id))).get();
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    const room = myRoom(session, entry.roomId);
    if (room.status === "sealed") return res.status(400).json({ message: "This ledger is sealed" });
    const nextVersion = entry.currentVersion + 1;
    let text = String(req.body.text ?? "");
    let payload: string | null = null;
    if (isRecordKind(entry.kind)) {
      const checked = validateRecord(entry.kind, req.body.payload, recordContext(room));
      if (!checked.ok) return res.status(400).json({ message: checked.error });
      text = checked.text;
      payload = JSON.stringify(checked.payload);
    }
    db.insert(entryVersions).values({
      entryId: entry.id, version: nextVersion, text, payload, createdAt: now(),
    }).run();
    db.update(entries).set({ currentVersion: nextVersion, status: "pending", approvedAt: null })
      .where(eq(entries.id, entry.id)).run();
    db.delete(consents).where(eq(consents.entryId, entry.id)).run(); // confirmations apply to the exact version
    audit(entry.roomId, "facilitator", "entry_revised");
    res.json({ ok: true });
  });

  app.post("/api/facilitator/entries/:id/reject", (req, res) => {
    const session = requireRole(req, "facilitator");
    const entry = db.select().from(entries).where(eq(entries.id, Number(req.params.id))).get();
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    myRoom(session, entry.roomId);
    db.update(entries).set({ status: "rejected" }).where(eq(entries.id, entry.id)).run();
    audit(entry.roomId, "facilitator", "entry_rejected");
    res.json({ ok: true });
  });

  app.post("/api/facilitator/entries/:id/release", (req, res) => {
    const session = requireRole(req, "facilitator");
    const entry = db.select().from(entries).where(eq(entries.id, Number(req.params.id))).get();
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    myRoom(session, entry.roomId);
    db.update(entries).set({ released: 1 }).where(eq(entries.id, entry.id)).run();
    audit(entry.roomId, "facilitator", "conditional_entry_released");
    res.json({ ok: true });
  });

  app.post("/api/facilitator/rooms/:id/notes", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    db.insert(notes).values({ roomId: room.id, text: req.body.text, createdAt: now() }).run();
    audit(room.id, "facilitator", "note_written");
    res.json({ ok: true });
  });

  app.post("/api/facilitator/rooms/:id/followups", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const { type, text, ownerSeatId, dueDate } = req.body;
    let ownerLabel = "Facilitator";
    if (ownerSeatId) {
      const seat = db.select().from(seats).where(eq(seats.id, Number(ownerSeatId))).get();
      if (seat) ownerLabel = seatLabel(seat);
    }
    db.insert(followups).values({
      roomId: room.id, seriesKey: room.seriesKey, type: type === "commitment" ? "commitment" : "pledge",
      text, ownerSeatId: ownerSeatId || null, ownerLabel, dueDate: dueDate || null,
      status: "open", createdAt: now(),
    }).run();
    audit(room.id, "facilitator", "followup_added");
    res.json({ ok: true });
  });

  app.post("/api/facilitator/followups/:id/status", (req, res) => {
    const session = requireRole(req, "facilitator");
    const f = db.select().from(followups).where(eq(followups.id, Number(req.params.id))).get();
    if (!f) return res.status(404).json({ message: "Follow-up not found" });
    myRoom(session, f.roomId);
    const status = ["open", "kept", "lapsed"].includes(req.body.status) ? req.body.status : "open";
    db.update(followups).set({ status, outcome: req.body.outcome || null })
      .where(eq(followups.id, f.id)).run();
    audit(f.roomId, "facilitator", "followup_status_changed");
    res.json({ ok: true });
  });

  /* ── Neutrality Engine (Groq In-Memory Ephemeral Pipeline) ── */

  app.get("/api/neutrality/status", (req, res) => {
    const hasEnvKey = !!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim() !== "";
    res.json({
      configured: hasEnvKey,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    });
  });

  app.post("/api/neutrality/test-key", async (req, res) => {
    requireRole(req, "facilitator");
    const apiKey = typeof req.body.apiKey === "string" ? req.body.apiKey.trim() : "";
    if (!apiKey && !process.env.GROQ_API_KEY) {
      return res.status(400).json({ ok: false, error: "API key is required" });
    }
    const result = await testGroqConnection(apiKey || undefined);
    res.json(result);
  });

  app.post("/api/neutrality/reword", async (req, res) => {
    const session = getSession(getReqToken(req));
    if (!session || !["facilitator", "admin", "participant"].includes(session.role)) {
      return res.status(401).json({ message: "Sign in to use the Neutrality Engine" });
    }

    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      return res.status(400).json({ message: "Text to neutralize is required" });
    }
    if (text.length > 4000) {
      return res.status(400).json({ message: "Draft text exceeds 4,000 characters limit" });
    }

    const kind = typeof req.body.kind === "string" ? req.body.kind : undefined;
    const context = typeof req.body.context === "string" ? req.body.context : undefined;
    const apiKey = typeof req.body.apiKey === "string" ? req.body.apiKey.trim() : undefined;
    const model = typeof req.body.model === "string" ? req.body.model.trim() : undefined;

    try {
      const result = await generateNeutralVariants({ text, kind, context, apiKey, model });
      res.json(result);
    } catch (err: any) {
      res.status(502).json({ message: err.message || "Failed to transform text through Groq Neutrality Engine" });
    }
  });

  app.post("/api/facilitator/rooms/:id/ai-draft", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    // Drafts suggested only from approved room-wide entries; stays a draft until accepted
    const { rows } = buildLedger(room.id);
    const roomWide = rows.filter((r) => r.kind === "issue" || r.kind === "summary" || r.kind === "next-step");
    if (roomWide.length === 0) {
      return res.status(400).json({ message: "No approved room-wide entries to draft from yet" });
    }
    const issues = roomWide.filter((r) => r.kind === "issue").map((r) => r.text);
    const steps = roomWide.filter((r) => r.kind === "next-step").map((r) => r.text);
    const draft = [
      `Working summary (${new Date().toLocaleDateString()})`,
      "",
      "Issues recorded:",
      ...(issues.length ? issues.map((t) => `- ${t}`) : ["- None recorded"]),
      "",
      "Next steps recorded:",
      ...(steps.length ? steps.map((t) => `- ${t}`) : ["- None recorded"]),
      "",
      "Suggested next step: review the follow-through register and confirm owners and due dates before closing.",
    ].join("\n");
    audit(room.id, "facilitator", "ai_draft_requested");
    res.json({ draft });
  });

  app.post("/api/facilitator/rooms/:id/close", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    if (room.status !== "live") return res.status(400).json({ message: "Only live rooms can close" });
    db.update(rooms).set({ status: "closed", floorState: "idle", floorSeatId: null, floorEndsAt: null })
      .where(eq(rooms.id, room.id)).run();
    chatWipe(room.id); // the relay forgets everything the moment the room closes
    audit(room.id, "facilitator", "room_closed");
    res.json({ ok: true });
  });

  app.post("/api/facilitator/rooms/:id/seal", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    if (room.status !== "closed") return res.status(400).json({ message: "Close the room before sealing" });
    // Nothing is left half-decided: every structured item is approved or set aside first.
    const undecided = db.select().from(entries).where(and(eq(entries.roomId, room.id), eq(entries.status, "pending"))).all()
      .filter((e) => isRecordKind(e.kind) && e.visibility === "all").length;
    if (undecided) {
      return res.status(400).json({ message: `${undecided} record item${undecided === 1 ? " is" : "s are"} still awaiting the room. Approve or set aside each one before sealing.` });
    }
    const { fingerprint, chainHead, destructionCert } = sealRoomV2(room.id, now(), "facilitator");
    res.json({ fingerprint, chainHead, destructionCert, ledgerVersion: LEDGER_VERSION });
  });

  app.post("/api/facilitator/rooms/:id/handoff", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const to = db.select().from(facilitators).where(eq(facilitators.id, Number(req.body.facilitatorId))).get();
    if (!to || to.status !== "active" || isDemoEmail(to.email) !== session.demo) {
      return res.status(404).json({ message: "Facilitator not available" });
    }
    db.update(rooms).set({ facilitatorId: to.id }).where(eq(rooms.id, room.id)).run();
    audit(room.id, "facilitator", "room_handed_off");
    res.json({ ok: true });
  });

  app.post("/api/facilitator/rooms/:id/wipe", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    wipeRoom(room.id);
    res.json({ ok: true });
  });

  app.get("/api/facilitator/rooms/:id/export", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    res.setHeader("Content-Disposition", `attachment; filename="diavanish-ledger-${room.code}.json"`);
    res.json(ledgerPayload(room, "ledger"));
  });

  /* ── Calendar (ICS) for scheduled sessions ── */

  app.get("/api/facilitator/rooms/:id/calendar.ics", (req, res) => {
    const session = requireRole(req, "facilitator");
    const room = myRoom(session, Number(req.params.id));
    const start = room.sessionAt ? new Date(room.sessionAt) : null;
    if (!start || Number.isNaN(start.getTime())) {
      return res.status(404).json({ message: "No session time scheduled for this room" });
    }
    const end = new Date(start.getTime() + 90 * 60000);
    const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Diavanish//Session//EN",
      "BEGIN:VEVENT",
      `UID:diavanish-${room.code}@diavanish.org`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${room.title.replace(/[,;]/g, "")} (Diavanish ${room.code})`,
      "DESCRIPTION:Dialogue session. The conversation is never recorded; only agreed outcomes are kept.",
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="diavanish-${room.code}.ics"`);
    res.send(ics);
  });

  /* ── Redaction check (edge-function stand-in) ── */

  app.post("/api/redact", (req, res) => {
    const flags = redactCheck(String(req.body.text || ""));
    res.json({ flags, clean: flags.length === 0 });
  });

  /* ── Participant ────────────────────────────────────────── */

  app.post("/api/join", (req, res) => {
    const { inviteToken, nameChoice, name, realName, claimedRole: typedRole, adult } = req.body;
    const invite = db.select().from(invites).where(and(
      eq(invites.token, tokenHash(String(inviteToken || ""))), isNull(invites.usedAt), gt(invites.expiresAt, now()),
    )).get();
    if (!invite) return res.status(401).json({ message: "Invite invalid, used, or expired" });
    const room = db.select().from(rooms).where(eq(rooms.id, invite.roomId)).get();
    if (!room || room.status !== "live") return res.status(400).json({ message: "Room is not admitting" });
    if (!adult) return res.status(400).json({ message: "Eighteen-plus confirmation required" });
    if (room.seatCap) {
      const taken = db.select().from(seats).where(and(eq(seats.roomId, room.id), inArray(seats.status, ["waiting", "admitted"]))).all().length;
      if (taken >= room.seatCap) return res.status(403).json({ message: "This room is full" });
    }
    // A role-bound invite fixes the role; nobody can claim a different one.
    const claimedRole = invite.role || String(typedRole || "").trim().slice(0, 60);
    if (!claimedRole) return res.status(400).json({ message: "State a role to claim" });
    if (room.requiresRoleProof && !invite.attestation) {
      return res.status(403).json({ message: "This room needs a role-verified invite. Ask the facilitator for one." });
    }
    let attestation: string | null = null;
    if (invite.role && invite.attestation) {
      const a = JSON.parse(invite.attestation);
      attestation = JSON.stringify({ role: invite.role, inviteHash: invite.token, sig: a.sig, pub: a.pub });
    }

    // The anonymity decision the facilitator made for this room
    const open = room.anonymityMode === "open";
    let pseudonym = `Seat ${uid(4).toUpperCase()}`;
    let storedRealName: string | null = null;
    let useRealName = 0;
    if (open && nameChoice === "real" && name) {
      storedRealName = name;
      useRealName = 1;
      pseudonym = `Seat ${uid(4).toUpperCase()}`;
    } else if (name) {
      pseudonym = name;
      if (open && realName) storedRealName = String(realName);
    }
    const token = uid(24);
    const recoveryKey = uid(10);
    const seat = db.insert(seats).values({
      roomId: room.id, token, pseudonym, realName: storedRealName, useRealName, claimedRole,
      roleProofVerified: attestation ? 1 : 0, attestation,
      recoveryKey, status: "waiting", joinedAt: now(),
    }).returning().get();
    db.update(invites).set({ usedAt: now() }).where(eq(invites.id, invite.id)).run();
    audit(room.id, "participant", "seat_joined");
    security("join", "Guest session opened via invite");
    const sessionToken = createSession("participant", seat.id);
    res.json({
      token: sessionToken, seatId: seat.id, roomId: room.id,
      anonymityMode: room.anonymityMode, recoveryKey,
    });
  });

  /* ── Seat recovery: no identity, no contact details, no new friction ── */

  app.post("/api/recover", (req, res) => {
    const { roomCode, pseudonym, recoveryKey } = req.body;
    const room = db.select().from(rooms).where(eq(rooms.code, String(roomCode || "").toUpperCase())).get();
    if (!room || room.status !== "live") {
      return res.status(404).json({ message: "No live room with that code" });
    }
    const seat = db.select().from(seats).where(and(
      eq(seats.roomId, room.id), eq(seats.pseudonym, String(pseudonym || "")),
    )).get();
    if (!seat || seat.recoveryKey !== String(recoveryKey || "")) {
      security("recover_failed", "Seat recovery attempt failed");
      return res.status(401).json({ message: "Pseudonym and recovery key do not match" });
    }
    if (["removed", "banned", "left"].includes(seat.status)) {
      return res.status(403).json({ message: "That seat is no longer active in this room" });
    }
    const sessionToken = createSession("participant", seat.id);
    audit(room.id, "participant", "seat_recovered");
    security("recover", "Seat recovered with a recovery key");
    res.json({ token: sessionToken, seatId: seat.id, roomId: room.id });
  });

  app.post("/api/participant/reveal-name", (req, res) => {
    const session = requireRole(req, "participant");
    const seat = activeSeat(session);
    const room = db.select().from(rooms).where(eq(rooms.id, seat.roomId)).get();
    if (!room || room.anonymityMode !== "open") {
      return res.status(403).json({ message: "This room keeps participants anonymous" });
    }
    if (!seat.realName) return res.status(400).json({ message: "No real name on file for this seat" });
    db.update(seats).set({ useRealName: 1 }).where(eq(seats.id, seat.id)).run();
    audit(room.id, "participant", "name_revealed");
    res.json({ ok: true });
  });

  app.get("/api/participant/room", (req, res) => {
    const session = requireRole(req, "participant");
    const seat = ownSeat(session);
    if (["removed", "banned"].includes(seat.status)) {
      return res.status(403).json({ message: "Seat no longer active", code: "seat_ended", reason: seat.status });
    }
    const room = db.select().from(rooms).where(eq(rooms.id, seat.roomId)).get();
    if (!room) return res.status(404).json({ message: "Room not found" });
    const agenda = db.select().from(agendaItems).where(eq(agendaItems.roomId, room.id))
      .orderBy(agendaItems.position).all();
    const allEntries = db.select().from(entries).where(eq(entries.roomId, room.id)).all();
    const visible = allEntries.filter((e) => {
      if (e.status !== "approved") return e.authorSeatId === seat.id; // own drafts
      if (e.visibility === "facilitator") return false;
      if (e.visibility === "conditional") return !!e.released;
      return true;
    }).map((e) => {
      const v = db.select().from(entryVersions)
        .where(and(eq(entryVersions.entryId, e.id), eq(entryVersions.version, e.currentVersion))).get();
      const structured = isRecordKind(e.kind);
      return {
        ...e, text: v?.text ?? "", mine: e.authorSeatId === seat.id,
        payload: structured && v?.payload ? JSON.parse(v.payload) : null,
        support: structured ? sealedSupport(room, e.id) ?? liveSupport(e.id, room) : null,
      };
    });
    // Structured items proposed for the record: every seat sees them and answers for itself.
    const proposals = allEntries
      .filter((e) => isRecordKind(e.kind) && e.status === "pending" && e.visibility === "all")
      .sort((a, b) => a.id - b.id)
      .map((e) => {
        const v = db.select().from(entryVersions)
          .where(and(eq(entryVersions.entryId, e.id), eq(entryVersions.version, e.currentVersion))).get();
        const mine = db.select().from(consents)
          .where(and(eq(consents.entryId, e.id), eq(consents.seatId, seat.id))).get();
        const tally = tallyFor(e.id, room);
        return {
          id: e.id, kind: e.kind, agendaItemId: e.agendaItemId, version: e.currentVersion,
          carriedFrom: e.carriedFrom, text: v?.text ?? "", payload: v?.payload ? JSON.parse(v.payload) : null,
          my: mine ? { support: mine.confirmed ? mine.support : null, reason: mine.reason ?? null, rewording: !mine.confirmed } : null,
          responded: tally.responded, required: tally.required,
        };
      });
    const seatRows = db.select().from(seats).where(eq(seats.roomId, room.id))
      .all().map((s) => ({
        id: s.id, label: seatLabel(s), claimedRole: s.claimedRole,
        status: s.status, roleProofVerified: !!s.roleProofVerified,
        // Signed on the facilitator's device; each browser checks it itself.
        attestation: s.attestation ? JSON.parse(s.attestation) : null,
      }));
    const myFollowups = db.select().from(followups).where(eq(followups.roomId, room.id))
      .all().filter((f) => f.ownerSeatId === seat.id || f.ownerSeatId === null);
    const reviewQueue = db.select().from(entries).where(and(
      eq(entries.roomId, room.id), eq(entries.kind, "next-step"),
      inArray(entries.status, ["pending", "approved"]),
    )).all().map((e) => {
      const c = db.select().from(consents)
        .where(and(eq(consents.entryId, e.id), eq(consents.seatId, seat.id))).get();
      return { entryId: e.id, confirmed: !!c?.confirmed, text: "" };
    });
    // Current structured outcome summary + this seat's verification of it
    const latestSummary = db.select().from(summaryVersions).where(eq(summaryVersions.roomId, room.id))
      .orderBy(desc(summaryVersions.version)).limit(1).get();
    const mySummaryConfirmation = latestSummary
      ? db.select().from(summaryConfirmations).where(and(
          eq(summaryConfirmations.summaryVersionId, latestSummary.id),
          eq(summaryConfirmations.seatId, seat.id),
        )).get()
      : undefined;
    res.json({
      room: {
        id: room.id, code: room.code, title: room.title, status: room.status,
        anonymityMode: room.anonymityMode, turnMinutes: room.turnMinutes, turnSeconds: room.turnSeconds,
        tier: room.tier, seatCap: room.seatCap, sealThreshold: room.sealThreshold, continuesFrom: room.continuesFrom,
        floorState: room.floorState, floorSeatId: room.floorSeatId, floorEndsAt: room.floorEndsAt,
        turnNumber: room.turnNumber, chathamHouse: !!room.chathamHouse,
        requiresRoleProof: !!room.requiresRoleProof, nextStepReview: !!room.nextStepReview,
        fingerprint: room.fingerprint, sealedAt: room.sealedAt,
        destructionCert: room.destructionCert, chainHead: room.chainHead,
        stage: room.stage, stageEndsAt: room.stageEndsAt, inputLocked: !!room.inputLocked,
        caucusSeatId: room.caucusSeatId, sessionAt: room.sessionAt,
      },
      seat: { id: seat.id, pseudonym: seat.pseudonym, realName: seat.realName, useRealName: !!seat.useRealName, status: seat.status, claimedRole: seat.claimedRole, roleProofVerified: !!seat.roleProofVerified },
      agenda, entries: visible, proposals, seats: seatRows, followups: myFollowups, reviewQueue,
      ledgerVersion: room.ledgerVersion ?? null,
      summary: latestSummary
        ? {
            ...latestSummary,
            myConfirmation: mySummaryConfirmation
              ? { confirmed: !!mySummaryConfirmation.confirmed, note: mySummaryConfirmation.note ?? null }
              : null,
          }
        : null,
    });
  });

  app.post("/api/participant/entries", (req, res) => {
    const session = requireRole(req, "participant");
    const seat = activeSeat(session);
    if (seat.status !== "admitted") return res.status(403).json({ message: "Waiting seats can draft but not send" });
    const room = db.select().from(rooms).where(eq(rooms.id, seat.roomId)).get()!;
    if (room.status !== "live") return res.status(400).json({ message: "Room is not live" });
    if (room.inputLocked) {
      return res.status(403).json({ message: "The facilitator has paused input for this stage" });
    }
    if (room.floorState === "running" && room.floorSeatId !== seat.id) {
      return res.status(403).json({ message: "Only the speaker and facilitator can add entries during a turn" });
    }
    const { agendaItemId, kind, text, redactionChecked } = req.body;
    if (kind && !["issue", "summary", "next-step"].includes(kind)) {
      return res.status(400).json({ message: "Unknown entry kind" });
    }
    const entry = db.insert(entries).values({
      roomId: room.id, agendaItemId: agendaItemId || null,
      kind: kind || "issue", visibility: "all", status: "pending",
      authorSeatId: seat.id, redactionChecked: redactionChecked ? 1 : 0,
      createdAt: now(),
    }).returning().get();
    db.insert(entryVersions).values({ entryId: entry.id, version: 1, text, createdAt: now() }).run();
    audit(room.id, "participant", "entry_proposed");
    res.json(entry);
  });

  app.post("/api/participant/consents/:entryId", (req, res) => {
    const session = requireRole(req, "participant");
    const seat = activeSeat(session);
    const entry = db.select().from(entries).where(eq(entries.id, Number(req.params.entryId))).get();
    if (!entry || entry.roomId !== seat.roomId) return res.status(404).json({ message: "Entry not found" });
    const structured = isRecordKind(entry.kind);
    let support: string | null = null;
    let reason: string | null = null;
    let confirm = !!req.body.confirm;
    if (structured) {
      if (seat.status !== "admitted") return res.status(403).json({ message: "Only admitted seats can give consent" });
      const room = db.select().from(rooms).where(eq(rooms.id, entry.roomId)).get()!;
      if (room.status === "sealed") return res.status(400).json({ message: "This ledger is sealed" });
      if (entry.status !== "pending" || entry.visibility !== "all") {
        return res.status(400).json({ message: "This item is not open for consent" });
      }
      if (req.body.support == null) {
        confirm = false; // asked for rewording
      } else if (!SUPPORT_LEVELS.includes(req.body.support)) {
        return res.status(400).json({ message: "Choose full consensus, consent with reservations, or objection" });
      } else {
        confirm = true;
        support = req.body.support;
        // A short reason may accompany an objection. It goes on the record, so it is
        // capped and stripped like everything else the room approves.
        if (support === "objection" && req.body.reason) reason = normText(req.body.reason).slice(0, 280) || null;
      }
    }
    const existing = db.select().from(consents)
      .where(and(eq(consents.entryId, entry.id), eq(consents.seatId, seat.id))).get();
    if (existing) {
      db.update(consents).set({ confirmed: confirm ? 1 : 0, support, reason, createdAt: now() })
        .where(eq(consents.id, existing.id)).run();
    } else {
      db.insert(consents).values({
        entryId: entry.id, seatId: seat.id, confirmed: confirm ? 1 : 0, support, reason, createdAt: now(),
      }).run();
    }
    // One action for every answer, so the audit log never says what a seat chose.
    audit(entry.roomId, "participant", structured
      ? "record_item_answered"
      : (confirm ? "next_step_confirmed" : "next_step_declined"));
    res.json({ ok: true });
  });

  app.post("/api/participant/chat", (req, res) => {
    const session = requireRole(req, "participant");
    const seat = activeSeat(session);
    if (seat.status !== "admitted") return res.status(403).json({ message: "Not admitted" });
    const room = db.select().from(rooms).where(eq(rooms.id, seat.roomId)).get()!;
    const inCaucus = room.caucusSeatId === seat.id;
    if (!inCaucus && room.inputLocked) {
      return res.status(403).json({ message: "The facilitator has paused input for this stage" });
    }
    if (!inCaucus && room.caucusSeatId) {
      return res.status(403).json({ message: "The room is in a private caucus right now" });
    }
    if (!inCaucus && room.floorState === "running" && room.floorSeatId !== seat.id) {
      // Chat send lock during another's turn — browser-side lock in the spec; enforced here too
      return res.status(403).json({ message: "Chat is locked while another seat holds the floor" });
    }
    const channel = inCaucus ? `caucus:${seat.id}` : "floor";
    const { epoch, iv, ct } = req.body;
    if (!Number.isInteger(epoch) || !isB64(iv, 32) || !isB64(ct, CHAT_CT_MAX)) {
      return res.status(400).json({ message: "Chat accepts encrypted messages only" });
    }
    chatPush(room.id, { epoch, iv, ct, channel });
    res.json({ ok: true });
  });

  app.post("/api/participant/e2ee/pubkey", (req, res) => {
    const session = requireRole(req, "participant");
    const seat = activeSeat(session);
    const { pub, signPub } = req.body;
    if (!isB64(pub, 200) || !isB64(signPub, 200)) return res.status(400).json({ message: "Malformed public key" });
    const c = cryptoFor(seat.roomId);
    if (c.seatPubs.get(seat.id) !== pub) {
      c.seatPubs.set(seat.id, pub);
      c.wraps.delete(seat.id);
    }
    if (c.signPubs.get(seat.id) !== signPub) {
      c.signPubs.set(seat.id, signPub);
      c.certs.delete(seat.id);
    }
    res.json({ ok: true });
  });

  app.get("/api/participant/e2ee", async (req, res) => {
    const session = requireRole(req, "participant");
    const seat = activeSeat(session);
    const room = db.select().from(rooms).where(eq(rooms.id, seat.roomId)).get()!;
    if (isDemoRoom(room) && seat.status === "admitted") await demoSteward(room.id);
    const c = cryptoFor(seat.roomId);
    const fresh = db.select().from(rooms).where(eq(rooms.id, seat.roomId)).get()!;
    const pub = c.seatPubs.get(seat.id);
    const w = c.wraps.get(seat.id);
    const ok = !!(w && pub && w.epoch === c.epoch && w.pubHash === serverPubHash(pub));
    const admittedIds = db.select({ id: seats.id }).from(seats)
      .where(and(eq(seats.roomId, room.id), eq(seats.status, "admitted"))).all().map((r) => r.id);
    res.json({
      epoch: c.epoch, hasPub: !!pub && c.signPubs.has(seat.id), wrap: ok ? w : null, roomId: room.id, roomCode: room.code,
      attestPubs: JSON.parse(fresh.attestPubs || "[]"), demo: isDemoRoom(room),
      roster: seat.status === "admitted" ? rosterFor(room.id, admittedIds) : [],
    });
  });

  app.get("/api/participant/chat", (req, res) => {
    const session = requireRole(req, "participant");
    const seat = activeSeat(session);
    // The relay is for admitted seats. A waiting seat has no key yet, and gets
    // no ciphertext or message timing either.
    if (seat.status !== "admitted") return res.status(403).json({ message: "Not admitted" });
    const room = db.select().from(rooms).where(eq(rooms.id, seat.roomId)).get()!;
    // A seat in caucus sees only the caucus channel; everyone else sees the floor.
    const channel = room?.caucusSeatId === seat.id ? `caucus:${seat.id}` : "floor";
    res.json(chatRecent(seat.roomId, channel));
  });

  /* ── Participant summary verification + clean export ── */

  app.post("/api/participant/summary/:versionId/verify", (req, res) => {
    const session = requireRole(req, "participant");
    const seat = activeSeat(session);
    if (seat.status !== "admitted") return res.status(403).json({ message: "Not admitted" });
    const v = db.select().from(summaryVersions)
      .where(eq(summaryVersions.id, Number(req.params.versionId))).get();
    if (!v) return res.status(404).json({ message: "Summary version not found" });
    const room = db.select().from(rooms).where(eq(rooms.id, v.roomId)).get()!;
    if (!room || room.id !== seat.roomId) return res.status(404).json({ message: "Summary version not found" });
    const existing = db.select().from(summaryConfirmations).where(and(
      eq(summaryConfirmations.summaryVersionId, v.id), eq(summaryConfirmations.seatId, seat.id),
    )).get();
    const confirmed = req.body.confirmed ? 1 : 0;
    const note = req.body.note ? String(req.body.note).slice(0, 400) : null;
    if (existing) {
      db.update(summaryConfirmations).set({ confirmed, note, createdAt: now() })
        .where(eq(summaryConfirmations.id, existing.id)).run();
    } else {
      db.insert(summaryConfirmations).values({
        summaryVersionId: v.id, seatId: seat.id, confirmed, note, createdAt: now(),
      }).run();
    }
    audit(v.roomId, "participant", confirmed ? "summary_verified" : "summary_change_requested");
    res.json({ ok: true });
  });

  app.get("/api/participant/summary.md", (req, res) => {
    const session = requireRole(req, "participant");
    const seat = activeSeat(session);
    const room = db.select().from(rooms).where(eq(rooms.id, seat.roomId)).get();
    if (!room) return res.status(404).json({ message: "Room not found" });
    const latest = db.select().from(summaryVersions).where(eq(summaryVersions.roomId, room.id))
      .orderBy(desc(summaryVersions.version)).limit(1).get();
    if (!latest) return res.status(404).json({ message: "No summary written yet" });
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="diavanish-summary-${room.code}.md"`);
    res.send(summaryMarkdown(room, latest));
  });

  app.post("/api/participant/leave", (req, res) => {
    const session = requireRole(req, "participant");
    const seat = ownSeat(session);
    // Unapproved entries wiped, pseudonym replaced
    const authored = db.select().from(entries)
      .where(and(eq(entries.authorSeatId, seat.id), inArray(entries.status, ["pending", "rejected"]))).all();
    for (const e of authored) {
      db.delete(entryVersions).where(eq(entryVersions.entryId, e.id)).run();
      db.delete(consents).where(eq(consents.entryId, e.id)).run();
      db.delete(entries).where(eq(entries.id, e.id)).run();
    }
    db.update(seats).set({ status: "left", pseudonym: `Departed ${uid(3).toUpperCase()}`, leftAt: now() })
      .where(eq(seats.id, seat.id)).run();
    audit(seat.roomId, "participant", "seat_left");
    destroySession(session.token);
    res.json({ ok: true });
  });

  app.get("/api/participant/export", (req, res) => {
    const session = requireRole(req, "participant");
    const seat = ownSeat(session);
    const authored = db.select().from(entries).where(eq(entries.authorSeatId, seat.id)).all()
      .map((e) => {
        const v = db.select().from(entryVersions)
          .where(and(eq(entryVersions.entryId, e.id), eq(entryVersions.version, e.currentVersion))).get();
        return { kind: e.kind, status: e.status, text: v?.text ?? "" };
      });
    res.setHeader("Content-Disposition", 'attachment; filename="diavanish-my-data.json"');
    res.json({
      pseudonym: seat.pseudonym, claimedRole: seat.claimedRole,
      roomCode: db.select().from(rooms).where(eq(rooms.id, seat.roomId)).get()?.code,
      entries: authored,
    });
  });

  app.post("/api/participant/erasure-request", (req, res) => {
    const session = requireRole(req, "participant");
    const seat = ownSeat(session);
    db.insert(dataRequests).values({
      kind: "erasure", requester: seat.pseudonym, detail: `seat:${seat.id}`,
      status: "open", createdAt: now(),
    }).run();
    audit(seat.roomId, "participant", "erasure_requested");
    res.json({ ok: true });
  });

  /* ── Public: sealed ledger verification ── */

  app.get("/api/public/ledger/:code", (req, res) => {
    const room = db.select().from(rooms).where(eq(rooms.code, String(req.params.code).toUpperCase())).get();
    if (!room || room.status !== "sealed") {
      return res.status(404).json({ message: "No sealed ledger for that code" });
    }
    res.json(ledgerPayload(room, "rows"));
  });

  /* ── Public: proposal-ready brief, typeset from the sealed document only ── */

  app.get("/api/public/ledger/:code/brief.html", (req, res) => {
    const room = db.select().from(rooms).where(eq(rooms.code, String(req.params.code).toUpperCase())).get();
    if (!room || room.status !== "sealed") {
      return res.status(404).json({ message: "No sealed ledger for that code" });
    }
    const doc = sealedDoc(room);
    if (!doc) return res.status(404).json({ message: "This ledger was sealed before proposal briefs existed (v1). Use the JSON export." });
    const lang = ["en", "fr", "es", "ar"].includes(String(req.query.lang)) ? String(req.query.lang) : "en";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // A standalone document: no scripts from anywhere but itself, no external fetches.
    res.setHeader("Content-Security-Policy", BRIEF_CSP);
    if (req.query.download) res.setHeader("Content-Disposition", `attachment; filename="diavanish-brief-${room.code}.html"`);
    res.send(renderBrief(doc, {
      fingerprint: room.fingerprint ?? "", chainHead: room.chainHead, destructionCert: room.destructionCert, lang: lang as any,
    }));
  });

  /* ── Public: self-contained tamper-evident cryptographic receipt ── */
  app.get("/api/public/ledger/:code/artifact.json", (req, res) => {
    const room = db.select().from(rooms).where(eq(rooms.code, String(req.params.code).toUpperCase())).get();
    if (!room || room.status !== "sealed") {
      return res.status(404).json({ message: "No sealed ledger for that code" });
    }
    const doc = sealedDoc(room);
    const rows = doc ? rowsFromDoc(doc) : buildLedger(room.id).rows;
    const version = doc ? 2 : 1;

    // Leaf hashes for Merkle tree computation
    const itemStrings: string[] = doc
      ? doc.items.map((it) => JSON.stringify(it))
      : rows.map((r) => JSON.stringify(r));
    const leafHashes = itemStrings.map((s) => createHash("sha256").update(s).digest("hex"));

    // Merkle tree root calculation
    let merkleRoot = "";
    if (leafHashes.length === 0) {
      merkleRoot = createHash("sha256").update("").digest("hex");
    } else {
      let level = [...leafHashes];
      while (level.length > 1) {
        const next: string[] = [];
        for (let i = 0; i < level.length; i += 2) {
          if (i + 1 < level.length) {
            next.push(createHash("sha256").update(level[i] + level[i + 1]).digest("hex"));
          } else {
            next.push(level[i]);
          }
        }
        level = next;
      }
      merkleRoot = level[0];
    }

    const receipt = {
      $schema: "https://diavanish.org/schemas/receipt/v1.json",
      specification: "Diavanish Tamper-Evident Ratified Cryptographic Receipt",
      issuedAt: new Date().toISOString(),
      room: {
        code: room.code,
        title: room.title,
        sealedAt: room.sealedAt ? new Date(room.sealedAt).toISOString() : null,
        fingerprint: room.fingerprint,
        chainHead: room.chainHead,
        destructionCert: room.destructionCert,
      },
      cryptographicProof: {
        hashAlgorithm: "SHA-256",
        ledgerVersion: version,
        merkleRoot,
        totalRatifiedEntries: leafHashes.length,
        entryHashes: leafHashes,
        auditHead: auditHead(),
        auditChainIntact: auditVerify().intact,
      },
      zeroKnowledgeAssurances: {
        chatRelayMode: "RAM_EPHEMERAL_ONLY",
        databaseChatPersistence: false,
        audioVideoPaths: "NONE",
        caucusMemoryShredded: true,
        destructionCertComputed: !!room.destructionCert,
      },
      ledger: {
        version,
        document: doc ?? null,
        rows,
      },
    };

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="diavanish-receipt-${room.code}.json"`);
    res.json(receipt);
  });

  /* ── Public: non-retention evidence ──
     A cautious reviewer can recompute the destruction certificate from the
     sealed ledger fingerprint, the audit chain head, and the architectural
     commitment that the relay is ephemeral. Nothing else is exposed. */

  app.get("/api/public/non-retention/:code", (req, res) => {
    const room = db.select().from(rooms).where(eq(rooms.code, String(req.params.code).toUpperCase())).get();
    if (!room || room.status !== "sealed") {
      return res.status(404).json({ message: "No sealed room with that code" });
    }
    res.json({
      architecture: [
        "Chat runs on an in-memory relay; it is never written to the database or disk.",
        "No audio, video, or speech-to-text path exists in the platform.",
        "The only persisted record is the approved outcome ledger.",
        "Guest sessions expire and are purged on retention schedule.",
      ],
      ledgerFingerprint: room.fingerprint,
      chainHead: room.chainHead,
      destructionCert: room.destructionCert,
      chainIntact: auditVerify().intact,
    });
  });

  app.get("/api/public/invite-lookup/:token", (req, res) => {
    const invite = db.select().from(invites)
      .where(eq(invites.token, tokenHash(String(req.params.token)))).get();
    if (!invite || invite.usedAt || invite.expiresAt < now()) {
      return res.status(404).json({ message: "Invite invalid, used, or expired" });
    }
    const room = db.select().from(rooms).where(eq(rooms.id, invite.roomId)).get();
    if (!room || room.status !== "live") return res.status(404).json({ message: "Room is not admitting" });
    res.json({
      roomTitle: room.title, anonymityMode: room.anonymityMode,
      requiresRoleProof: !!room.requiresRoleProof, turnMinutes: room.turnMinutes,
      boundRole: invite.role ?? null, roleAttested: !!invite.attestation,
    });
  });
}
