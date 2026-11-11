import {
  db, createSession, uid, now, DAY, audit, wipeRoom,
  cryptoFor, serverPubHash, tokenHash, seatLabel, recordContext, sealRoomV2, carryForward,
} from "./storage";
import { validateRecord } from "@shared/ledger";
import * as E from "@shared/e2ee";
import {
  admins, facilitators, rooms, seats, entries, entryVersions, agendaItems, followups,
  invites, summaryVersions, summaryConfirmations, consents,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

/* ── One-click demos ─────────────────────────────────────────────
   Every role can be tried without an account. Demo rooms are marked
   by seriesKey "demo:live" / "demo:sealed" and are rebuilt on reset.
   They hold only invented sample content — no real participant data. */

import { DEMO_FAC_EMAIL, DEMO_ADMIN_EMAIL } from "./demo-mode";

function demoFacilitator() {
  let f = db.select().from(facilitators).where(eq(facilitators.email, DEMO_FAC_EMAIL)).get();
  if (!f) {
    f = db.insert(facilitators).values({
      email: DEMO_FAC_EMAIL, name: "L. Mansour (demo)", status: "active", createdAt: now(),
    }).returning().get();
  } else if (f.status !== "active") {
    db.update(facilitators).set({ status: "active" }).where(eq(facilitators.id, f.id)).run();
  }
  return f;
}

function demoAdmin() {
  let a = db.select().from(admins).where(eq(admins.email, DEMO_ADMIN_EMAIL)).get();
  if (!a) a = db.insert(admins).values({ email: DEMO_ADMIN_EMAIL, createdAt: now() }).returning().get();
  return a;
}

function addSeat(roomId: number, s: {
  pseudonym: string; claimedRole: string; realName?: string; useRealName?: boolean; verified?: boolean;
}) {
  return db.insert(seats).values({
    roomId, token: uid(24), pseudonym: s.pseudonym, realName: s.realName ?? null,
    useRealName: s.useRealName ? 1 : 0, claimedRole: s.claimedRole,
    roleProofVerified: s.verified ? 1 : 0, recoveryKey: uid(10), status: "admitted",
    joinedAt: now() - 40 * 60000,
  }).returning().get();
}

function addEntry(roomId: number, e: {
  kind: string; text: string; author: number | null; agenda: number | null;
  status?: string; ago: number;
}) {
  const row = db.insert(entries).values({
    roomId, agendaItemId: e.agenda, kind: e.kind, visibility: "all",
    status: e.status ?? "approved", authorSeatId: e.author, redactionChecked: 1,
    approvedAt: (e.status ?? "approved") === "approved" ? now() - e.ago : null,
    createdAt: now() - e.ago - 60000,
  }).returning().get();
  db.insert(entryVersions).values({ entryId: row.id, version: 1, text: e.text, createdAt: now() - e.ago }).run();
  return row;
}

type Support = "full" | "reservations" | "objection";

/** One structured record item, validated exactly like a real one, with seeded consents. */
function addRecord(room: typeof rooms.$inferSelect, r: {
  kind: string; agenda: number | null; payload: Record<string, unknown>;
  status?: "approved" | "pending"; ago: number;
  consent?: [number, Support | null, string?][];
  carriedFrom?: string;
}) {
  const checked = validateRecord(r.kind, r.payload, recordContext(room));
  if (!checked.ok) throw new Error(`demo record ${r.kind}: ${checked.error}`);
  const status = r.status ?? "approved";
  const row = db.insert(entries).values({
    roomId: room.id, agendaItemId: r.agenda, kind: r.kind, visibility: "all", status,
    authorSeatId: null, redactionChecked: 1, carriedFrom: r.carriedFrom ?? null,
    approvedAt: status === "approved" ? now() - r.ago : null, createdAt: now() - r.ago - 120000,
  }).returning().get();
  db.insert(entryVersions).values({
    entryId: row.id, version: 1, text: checked.text, payload: JSON.stringify(checked.payload), createdAt: now() - r.ago - 120000,
  }).run();
  for (const [seatId, support, reason] of r.consent ?? []) {
    db.insert(consents).values({
      entryId: row.id, seatId, confirmed: support ? 1 : 0, support, reason: reason ?? null, createdAt: now() - r.ago - 60000,
    }).run();
  }
  return row;
}

const all = (ids: number[], level: Support = "full") => ids.map((id) => [id, level] as [number, Support]);
const day = (offset: number) => new Date(now() + offset * DAY).toISOString().slice(0, 10);

/* Round 1, sealed two days ago: a city climate-adaptation round. Anonymous
   seats, delegations named by role. Everything below was consented item by
   item; the seal is a real ledger v2 seal over it. */
function buildSealed(facId: number) {
  const room = db.insert(rooms).values({
    code: `S${uid(5).toUpperCase()}`,
    title: "Harbour City Heat & Flood Adaptation · Round 1",
    purpose: "Agree first steps on extreme heat and stormwater flooding in the lower wards.",
    facilitatorId: facId, status: "closed", anonymityMode: "anonymous", turnMinutes: 2,
    tier: "council", seatCap: 8, turnSeconds: 120, sealThreshold: "super75",
    expiresAt: now() + 30 * DAY, requiresRoleProof: 0, chathamHouse: 1, nextStepReview: 0,
    seriesKey: "demo:sealed", stage: "closing", createdAt: now() - 23 * DAY,
  }).returning().get();
  const heat = db.insert(agendaItems).values({ roomId: room.id, position: 1, title: "Extreme heat in dense neighbourhoods", status: "covered" }).returning().get().id;
  const flood = db.insert(agendaItems).values({ roomId: room.id, position: 2, title: "Stormwater flooding in the lower wards", status: "covered" }).returning().get().id;
  const res = addSeat(room.id, { pseudonym: "Heron", claimedRole: "Residents' association" });
  const util = addSeat(room.id, { pseudonym: "Kestrel", claimedRole: "City emergency management" });
  const biz = addSeat(room.id, { pseudonym: "Wren", claimedRole: "Small business council" });
  const youth = addSeat(room.id, { pseudonym: "Lark", claimedRole: "Youth climate group" });
  const everyone = [res.id, util.id, biz.id, youth.id];
  const ago = 22 * DAY;

  addRecord(room, { kind: "problem", agenda: heat, ago, consent: all(everyone), payload: {
    statement: "Residents cannot safely reach a cooling centre during heat alerts.",
    scale: "city", affected: "Older residents, Outdoor workers, Top-floor households",
  } });
  addRecord(room, { kind: "problem", agenda: flood, ago, consent: all(everyone), payload: {
    statement: "Short, intense storms overwhelm the combined sewer in the lower wards, flooding basements and ground-floor shops two to four times a year.",
    scale: "community", affected: "Lower-ward households, Ground-floor businesses, Commuters on Route 9",
  } });
  addRecord(room, { kind: "position", agenda: heat, ago, consent: all(everyone), payload: {
    party: "Residents' association", wants: "Cooling centres within a ten-minute walk of every block, open late during heat alerts.",
    why: "Many older residents cannot travel far in the heat, and will not go somewhere that closes at five.",
  } });
  addRecord(room, { kind: "position", agenda: flood, ago, consent: all(everyone), payload: {
    party: "City utilities", wants: "Fund green infrastructure in phases, starting where flood losses are highest.",
    why: "The capital budget is fixed for two years. Phasing lets work start this season.",
  } });
  addRecord(room, { kind: "position", agenda: flood, ago, consent: all(everyone), payload: {
    party: "Small business council", wants: "Flood barriers and faster claims support for ground-floor shops.",
    why: "Three floods in one year can close a small shop for good.",
  } });
  addRecord(room, { kind: "position", agenda: heat, ago, consent: all(everyone), payload: {
    party: "Youth climate group", wants: "Open heat and flood data, and young people involved in monitoring.",
    why: "Trust grows when everyone can see the same numbers.",
  } });
  addRecord(room, { kind: "evidence", agenda: flood, ago, consent: all(everyone), payload: {
    summary: "Flood complaints in the lower wards rose from 41 to 118 between 2022 and 2025.",
    source: "City utilities, service request log", url: "https://example.org/harbour-city/flood-requests",
  } });
  addRecord(room, { kind: "evidence", agenda: heat, ago, consent: all(everyone), payload: {
    summary: "Tree canopy covers 9% of the lower wards, against 27% city-wide.",
    source: "2024 urban canopy survey", url: "https://example.org/harbour-city/canopy-2024",
  } });
  addRecord(room, { kind: "evidence", agenda: heat, ago, consent: all(everyone), payload: {
    summary: "Ambulance call-outs for heat illness doubled during the July 2025 heatwave.",
    source: "Regional health authority, seasonal summary",
  } });
  addRecord(room, { kind: "option", agenda: flood, ago, consent: all(everyone), payload: {
    title: "Bioswales and permeable paving on the six worst-flooding streets", status: "chosen",
    rationale: "Cuts peak runoff and adds shade. Work can start this season inside the existing budget.",
  } });
  addRecord(room, { kind: "option", agenda: flood, ago,
    consent: [[res.id, "full"], [util.id, "full"], [youth.id, "full"], [biz.id, "objection", "Shops need certainty. Green measures alone may not hold back the worst storms."]],
    payload: {
      title: "A new deep storage tunnel", status: "dropped",
      rationale: "Would remove most flooding in a single project.",
      reason: "Cost, and an eight-year build. Revisit if green measures fall short.",
    } });
  addRecord(room, { kind: "option", agenda: heat, ago, consent: all(everyone), payload: {
    title: "Extended-hours cooling centres in libraries and community halls", status: "chosen",
    rationale: "Uses buildings that already exist. Staff can be redeployed during heat alerts.",
  } });
  addRecord(room, { kind: "agreement", agenda: heat, ago, consent: all(everyone), payload: {
    action: "Open four extended-hours cooling centres in underserved neighbourhoods.", owner: "City emergency management",
    deadline: day(200), resources: "Library staff rota, two portable cooling units",
    measure: "Published locations, operating hours, and accessibility details.",
  } });
  addRecord(room, { kind: "agreement", agenda: flood, ago,
    consent: [[res.id, "full"], [util.id, "full"], [youth.id, "full"], [biz.id, "reservations"]],
    payload: {
      action: "Build bioswales on the first two flood streets", owner: "City utilities",
      deadline: day(320), resources: "€1.2m from the stormwater capital budget",
      measure: "Basement flooding reports on those streets fall by half within a year",
    } });
  addRecord(room, { kind: "agreement", agenda: flood, ago, consent: all(everyone), payload: {
    action: "Map the ground-floor shops at highest flood risk and share barrier guidance", owner: "Small business council",
    deadline: day(150), resources: "Volunteer surveyors, city flood maps", measure: "Every shop on the six streets contacted",
  } });
  addRecord(room, { kind: "agreement", agenda: heat, ago, consent: all(everyone), payload: {
    action: "Run a youth-led heat and flood monitoring network", owner: "Youth climate group",
    deadline: day(170), resources: "20 low-cost sensors, a school partnership", measure: "Readings published weekly, open to all",
  } });
  addRecord(room, { kind: "condition", agenda: flood, ago, consent: all(everyone), payload: {
    form: "conditional", accept: "phased funding for green infrastructure",
    provided: "the first phase starts on the streets with the highest flood losses, not the easiest ones",
  } });
  addRecord(room, { kind: "condition", agenda: heat, ago, consent: all(everyone, "reservations"), payload: {
    form: "unresolved", point: "Whether landlords should be required to fit cooling in top-floor flats, or only encouraged.",
  } });
  addRecord(room, { kind: "question", agenda: heat, ago, consent: all(everyone), payload: {
    question: "What would a city-wide tree-planting programme cost per degree of cooling?",
    research: "Ask the university climate lab for a costed estimate before Round 2.",
  } });
  addRecord(room, { kind: "question", agenda: flood, ago, consent: all(everyone), payload: {
    question: "Could the regional authority co-fund a deep tunnel if green measures fall short?",
    research: "Request a written answer from the regional infrastructure fund.",
  } });

  db.insert(followups).values([
    { roomId: room.id, seriesKey: "demo:sealed", type: "commitment", text: "Publish the canopy survey ward by ward", ownerSeatId: util.id, ownerLabel: "Kestrel", dueDate: day(-12), status: "kept", outcome: "Published on the city data portal", createdAt: now() - ago },
    { roomId: room.id, seriesKey: "demo:sealed", type: "pledge", text: "Circulate a list of flood-barrier suppliers to shops", ownerSeatId: biz.id, ownerLabel: "Wren", dueDate: day(-3), status: "lapsed", outcome: null, createdAt: now() - ago },
    { roomId: room.id, seriesKey: "demo:sealed", type: "commitment", text: "Share sensor specifications with partner schools", ownerSeatId: youth.id, ownerLabel: "Lark", dueDate: day(6), status: "open", outcome: null, createdAt: now() - ago },
  ]).run();

  const sv = db.insert(summaryVersions).values({
    roomId: room.id, version: 2,
    agreements: "Phase green infrastructure from the worst-flooding streets first. Open extended-hours cooling centres during heat alerts. Publish heat and flood data openly.",
    openIssues: "A duty on landlords to fit cooling. Co-funding for a deep tunnel.",
    nextSteps: "Cooling centres before next summer; first bioswales within the year; a youth monitoring network in spring.",
    disagreements: "Whether green measures alone can cope with the worst storms.",
    deadlines: `${day(150)}, ${day(170)}, ${day(200)}, ${day(320)}.`,
    locked: 1, createdAt: now() - ago,
  }).returning().get();
  for (const id of everyone) {
    db.insert(summaryConfirmations).values({ summaryVersionId: sv.id, seatId: id, confirmed: 1, note: null, createdAt: now() - ago }).run();
  }

  sealRoomV2(room.id, now() - 21 * DAY, "facilitator");
  return db.select().from(rooms).where(eq(rooms.id, room.id)).get()!;
}

/* Round 2, live: continues from Round 1. Open questions, conditions and
   unfinished commitments arrived as drafts; some were consented earlier in
   this session, the rest wait for every seat, including you. */
function buildLive(facId: number, prev: typeof rooms.$inferSelect) {
  const room = db.insert(rooms).values({
    code: `D${uid(5).toUpperCase()}`,
    title: "Harbour City Heat & Flood Adaptation · Round 2",
    purpose: "Turn Round 1's agreements into a funded plan for the lower wards.",
    facilitatorId: facId, status: "live", anonymityMode: "open", turnMinutes: 2,
    tier: "council", seatCap: 10, turnSeconds: 120, sealThreshold: "consensus",
    expiresAt: now() + 2 * DAY, requiresRoleProof: 1, chathamHouse: 1, nextStepReview: 1,
    seriesKey: "demo:live", continuesFrom: prev.code, stage: "drafting", stageEndsAt: now() + 18 * 60000,
    sessionAt: new Date(now() + DAY).toISOString().slice(0, 16), createdAt: now() - 2 * 3600000,
  }).returning().get();

  const heat = db.insert(agendaItems).values({ roomId: room.id, position: 1, title: "Cooling centres and shade", status: "covered" }).returning().get().id;
  const drain = db.insert(agendaItems).values({ roomId: room.id, position: 2, title: "Lower-ward drainage", status: "open" }).returning().get().id;
  db.insert(agendaItems).values({ roomId: room.id, position: 3, title: "Monitoring and data sharing", status: "open" }).run();

  const heron = addSeat(room.id, { pseudonym: "Heron", claimedRole: "Residents' association", verified: true });
  const kestrel = addSeat(room.id, { pseudonym: "Kestrel", claimedRole: "City utilities", verified: true });
  const wren = addSeat(room.id, { pseudonym: "Wren", claimedRole: "Small business council" });
  const amara = addSeat(room.id, { pseudonym: "Seat 7Q2F", claimedRole: "Youth climate group", realName: "Amara Okafor", useRealName: true });
  const everyone = [heron.id, kestrel.id, wren.id, amara.id];

  // Carried forward from the sealed Round 1, as drafts needing fresh consent.
  carryForward(prev, room.id);
  const carried = db.select().from(entries).where(eq(entries.roomId, room.id)).all().sort((a, b) => a.id - b.id);
  // Earlier in this session the room consented to most of them; two still wait.
  const waiting = new Set([carried.find((e) => e.kind === "condition")?.id, carried.find((e) => e.kind === "agreement")?.id]);
  for (const e of carried) {
    for (const id of everyone) {
      db.insert(consents).values({ entryId: e.id, seatId: id, confirmed: 1, support: "full", createdAt: now() - 30 * 60000 }).run();
    }
    if (!waiting.has(e.id)) {
      db.update(entries).set({ status: "approved", approvedAt: now() - 25 * 60000 }).where(eq(entries.id, e.id)).run();
    }
  }

  addRecord(room, { kind: "problem", agenda: drain, ago: 50 * 60000,
    consent: [[heron.id, "full"], [kestrel.id, "full"], [wren.id, "reservations"], [amara.id, "full"]], payload: {
    statement: "Basements on Dock Street and Mill Row still flood in heavy storms, even after the first bioswale.",
    scale: "community", affected: "Dock Street households, Mill Row shops, Route 9 bus stop",
  } });
  addRecord(room, { kind: "evidence", agenda: drain, ago: 44 * 60000, consent: all(everyone), payload: {
    summary: "The first bioswale on Rope Walk cut peak runoff by an estimated 35% in the March storm.",
    source: "City utilities flow gauge", url: "https://example.org/harbour-city/rope-walk-gauge",
  } });
  addRecord(room, { kind: "position", agenda: drain, ago: 40 * 60000, consent: all(everyone), payload: {
    party: "Youth climate group", wants: "Sensor readings from every new planter, published the same week.",
    why: "So the next round can see whether each measure works.",
  } });
  addRecord(room, { kind: "agreement", agenda: heat, ago: 70 * 60000, consent: all(everyone), payload: {
    action: "Keep two cooling centres open until 22:00 on heat-alert days", owner: "City utilities",
    deadline: day(30), resources: "Library evening staff", measure: "No centre turns anyone away",
  } });
  // Waiting on the room now.
  addRecord(room, { kind: "option", agenda: drain, ago: 12 * 60000, status: "pending",
    consent: [[heron.id, "full"], [kestrel.id, "full"], [wren.id, "reservations"], [amara.id, "full"]],
    payload: {
      title: "Two retention planters at the foot of Mill Row", status: "chosen",
      rationale: "Holds the first 20 minutes of a storm, where the gauge shows the peak.",
    } });
  addRecord(room, { kind: "agreement", agenda: drain, ago: 6 * 60000, status: "pending",
    consent: [[heron.id, "full"], [kestrel.id, "full"], [wren.id, "full"], [amara.id, "full"]],
    payload: {
      action: "Fit flood barriers to eligible ground-floor shops on Dock Street", owner: "Small business council",
      deadline: day(90), resources: "Shared grant fund of €80,000", measure: "No shop on Dock Street closed by flooding next winter",
    } });

  // Plain entries still work alongside the structured record.
  addEntry(room.id, { kind: "issue", text: "Bus stop on Route 9 needs a dry waiting area during storms.", author: heron.id, agenda: drain, ago: 20 * 60000 });
  addEntry(room.id, { kind: "next-step", text: "City to share three years of storm-gauge readings before Round 3.", author: amara.id, agenda: drain, status: "pending", ago: 4 * 60000 });

  db.insert(followups).values([
    { roomId: room.id, seriesKey: "demo:live", type: "commitment", text: "Council to circulate the barrier supplier list", ownerSeatId: wren.id, ownerLabel: "Wren", dueDate: day(-2), status: "kept", outcome: "Shared before the session", createdAt: now() - 3 * DAY },
    { roomId: room.id, seriesKey: "demo:live", type: "pledge", text: "City to publish storm-gauge readings weekly", ownerSeatId: kestrel.id, ownerLabel: "Kestrel", dueDate: day(7), status: "open", outcome: null, createdAt: now() - 2 * DAY },
  ]).run();

  const sv = db.insert(summaryVersions).values({
    roomId: room.id, version: 1,
    agreements: "Retention planters on Mill Row; flood barriers for Dock Street shops; late cooling centres on alert days.",
    openIssues: "Landlord cooling duty.",
    nextSteps: "City shares storm-gauge readings; shops confirm barrier eligibility.",
    disagreements: "Whether the review should be annual or per season.",
    deadlines: "Gauge readings within 7 days.",
    locked: 0, createdAt: now() - 20 * 60000,
  }).returning().get();
  db.insert(summaryConfirmations).values({ summaryVersionId: sv.id, seatId: kestrel.id, confirmed: 1, note: null, createdAt: now() - 15 * 60000 }).run();
  db.insert(summaryConfirmations).values({ summaryVersionId: sv.id, seatId: heron.id, confirmed: 0, note: "Please name the review body.", createdAt: now() - 10 * 60000 }).run();

  db.insert(invites).values({ roomId: room.id, token: tokenHash(uid(16)), expiresAt: now() + DAY, usedAt: null }).run();
  audit(room.id, "facilitator", "demo_room_prepared");
  return room;
}

function findDemo(key: "demo:live" | "demo:sealed") {
  const r = db.select().from(rooms).where(eq(rooms.seriesKey, key)).get();
  if (!r) return undefined;
  if (key === "demo:live" && (r.status !== "live" || !r.continuesFrom)) { wipeRoom(r.id); forgetSteward(r.id); return undefined; }
  // Demo data from before ledger v2 is rebuilt once.
  if (key === "demo:sealed" && r.ledgerVersion !== 2) { wipeRoom(r.id); return undefined; }
  return r;
}

export function ensureDemo() {
  const fac = demoFacilitator();
  const sealed = findDemo("demo:sealed") ?? buildSealed(fac.id);
  let live = findDemo("demo:live");
  if (live && live.continuesFrom !== sealed.code) { wipeRoom(live.id); forgetSteward(live.id); live = undefined; }
  live ??= buildLive(fac.id, sealed);
  return { fac, live, sealed };
}

export function resetDemo() {
  // Every demo room, including ones the demo facilitator created (demo:sandbox).
  const demoRooms = db.select().from(rooms).all().filter((r) => r.seriesKey?.startsWith("demo:"));
  for (const r of demoRooms) { wipeRoom(r.id); forgetSteward(r.id); }
  return ensureDemo();
}

export type DemoRole = "admin" | "facilitator" | "participant" | "verifier";

export function startDemo(role: DemoRole) {
  const { fac, live, sealed } = ensureDemo();
  if (role === "admin") {
    const a = demoAdmin();
    return { role, token: createSession("admin", a.id, { demo: true }), next: "/admin/console" };
  }
  if (role === "facilitator") {
    return { role, token: createSession("facilitator", fac.id, { demo: true }), next: `/facilitate/room/${live.id}` };
  }
  if (role === "participant") {
    // Keep the demo room uncluttered: only the two newest guests stay seated.
    const guests = db.select().from(seats).where(eq(seats.roomId, live.id)).all()
      .filter((s) => s.claimedRole === "Observer (demo)" && s.status === "admitted")
      .sort((a, b) => b.id - a.id);
    for (const g of guests.slice(1)) db.update(seats).set({ status: "left" }).where(eq(seats.id, g.id)).run();
    const guest = addSeat(live.id, { pseudonym: `Guest ${uid(3).toUpperCase()}`, claimedRole: "Observer (demo)" });
    audit(live.id, "participant", "demo_seat_joined");
    return {
      role, token: createSession("participant", guest.id, { demo: true }), next: "/p",
      recoveryKey: guest.recoveryKey, roomCode: live.code, pseudonym: guest.pseudonym,
    };
  }
  return { role, token: null, next: `/verify/${sealed.code}`, roomCode: sealed.code };
}

/* ── Demo key steward ────────────────────────────────────────────
   In a real room the facilitator's browser holds the room key and hands
   it to each seat. A one-click demo has no second device, so for demo
   rooms only the server plays that part — and the UI says so plainly.
   This is NOT end-to-end encryption and never runs for real rooms. */

type DemoSecrets = {
  epoch: number; createdAt: number; roomKey: string; attestPriv: JsonWebKey; attestPub: string; caucus: Record<number, string>;
};
const stewards = new Map<number, Promise<DemoSecrets>>();

export function wrapContext(roomId: number, seatId: number, epoch: number) {
  return `room:${roomId}|seat:${seatId}|epoch:${epoch}`;
}

export async function demoSteward(roomId: number): Promise<DemoSecrets> {
  let p = stewards.get(roomId);
  if (!p) {
    p = (async () => {
      const attest = await E.newAttestKeyPair();
      const c = cryptoFor(roomId);
      c.epoch = 1;
      c.wraps.clear();
      const secrets: DemoSecrets = { epoch: 1, createdAt: now(), roomKey: await E.newRoomKey(), attestPriv: attest.priv, attestPub: attest.pub, caucus: {} };
      const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()!;
      db.update(rooms).set({ attestPubs: JSON.stringify([attest.pub]) }).where(eq(rooms.id, roomId)).run();
      // Seeded "verified" seats get real signatures from the demo steward.
      const verified = db.select().from(seats).where(eq(seats.roomId, roomId)).all().filter((s) => s.roleProofVerified);
      for (const s of verified) {
        const inviteHash = tokenHash(uid(16));
        const sig = await E.signAttestation(attest.priv, E.attestationMessage(room.code, s.claimedRole, inviteHash));
        db.update(seats).set({ attestation: JSON.stringify({ role: s.claimedRole, inviteHash, sig, pub: attest.pub }) })
          .where(eq(seats.id, s.id)).run();
      }
      return secrets;
    })();
    stewards.set(roomId, p);
  }
  const secrets = await p;
  const c = cryptoFor(roomId);
  if (c.epoch !== secrets.epoch) { c.epoch = secrets.epoch; c.wraps.clear(); }
  c.rekeyNeeded = false;
  const admitted = db.select().from(seats).where(eq(seats.roomId, roomId)).all().filter((s) => s.status === "admitted");
  const roomCode = db.select().from(rooms).where(eq(rooms.id, roomId)).get()!.code;
  for (const s of admitted) {
    // Demo sender certificates come from the server-held key, like everything else here.
    const signPub = c.signPubs.get(s.id);
    const cert = c.certs.get(s.id);
    if (signPub && (cert?.signPub !== signPub || cert.label !== seatLabel(s))) {
      c.certs.set(s.id, await E.issueSenderCert(secrets.attestPriv, roomCode, s.id, seatLabel(s), signPub));
    }
    const pub = c.seatPubs.get(s.id);
    if (!pub) continue;
    const ph = serverPubHash(pub);
    const w = c.wraps.get(s.id);
    if (w && w.epoch === secrets.epoch && w.pubHash === ph) continue;
    secrets.caucus[s.id] ??= await E.newRoomKey();
    const ctx = wrapContext(roomId, s.id, secrets.epoch);
    const wrapped = await E.wrapFor(pub, {
      epoch: secrets.epoch, roomKey: secrets.roomKey, caucusKey: secrets.caucus[s.id], attestPub: secrets.attestPub,
    }, ctx);
    const sig = await E.signAttestation(secrets.attestPriv, E.wrapSigMessage(ctx, ph, wrapped));
    c.wraps.set(s.id, { epoch: secrets.epoch, pubHash: ph, ...wrapped, sig });
  }
  return secrets;
}

export function forgetSteward(roomId: number) {
  stewards.delete(roomId);
}
