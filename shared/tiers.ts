/*
 * Room tiers and sealing thresholds. Shared by the server (caps, gating,
 * defaults) and the browser (the picker, the cycle estimate, chips).
 */

export const TIERS = ["bilateral", "council", "plenary"] as const;
export type Tier = (typeof TIERS)[number];
export const isTier = (v: unknown): v is Tier => TIERS.includes(v as Tier);

export type TierSpec = {
  id: Tier;
  /** Seat cap the facilitator may choose (admitted + waiting seats). */
  seats: { min: number; max: number; default: number };
  /** Turn length in seconds. */
  turn: { min: number; max: number; default: number; step: number };
  /** Above this many seats the picker shows a calm note about cycle time and fatigue. */
  softCeiling?: number;
  /** Rigid turns: the facilitator cannot extend a running turn. */
  rigidTurns: boolean;
};

export const TIER_SPECS: Record<Tier, TierSpec> = {
  bilateral: { id: "bilateral", seats: { min: 2, max: 6, default: 2 }, turn: { min: 120, max: 180, default: 150, step: 30 }, rigidTurns: false },
  // A full round of about 15 to 20 minutes: 7 to 12 seats at 2 to 2.5 minutes each.
  council: { id: "council", seats: { min: 7, max: 12, default: 8 }, turn: { min: 90, max: 180, default: 120, step: 30 }, rigidTurns: false },
  plenary: { id: "plenary", seats: { min: 13, max: 20, default: 16 }, turn: { min: 60, max: 180, default: 90, step: 30 }, softCeiling: 16, rigidTurns: true },
};

export const DEFAULT_TIER: Tier = "council";

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** Seat cap and turn length for a tier, clamped to its ranges and snapped to its step. */
export function tierSettings(tier: Tier, seats?: unknown, turnSeconds?: unknown) {
  const spec = TIER_SPECS[tier];
  const s = Number.isFinite(Number(seats)) && seats !== null && seats !== "" ? Math.round(Number(seats)) : spec.seats.default;
  const raw = Number.isFinite(Number(turnSeconds)) && turnSeconds !== null && turnSeconds !== "" ? Number(turnSeconds) : spec.turn.default;
  const t = Math.round(raw / spec.turn.step) * spec.turn.step;
  return { seatCap: clamp(s, spec.seats.min, spec.seats.max), turnSeconds: clamp(t, spec.turn.min, spec.turn.max) };
}

/** One full cycle: every seat takes one turn. */
export function cycleSeconds(seats: number, turnSeconds: number) {
  return seats * turnSeconds;
}

/** "2.5 min", "2 min", "45 s" */
export function formatMinutes(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  const m = seconds / 60;
  return `${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, "")} min`;
}

/** Turn length in ms for any room, with or without a tier. */
export function turnMs(room: { turnSeconds?: number | null; turnMinutes: number }) {
  return room.turnSeconds ? room.turnSeconds * 1000 : room.turnMinutes * 60000;
}

/* ── Sealing thresholds ──
   Every admitted seat must answer before an item can be decided: a seat that
   stays silent is never counted as consent. Consent = full consensus +
   consent with reservations. "Needs rewording" and objections count against.
   - consensus: every seat consents (zero objections, zero rewording requests)
   - super75:   consent from at least 75% of admitted seats
   - super66:   consent from at least two thirds of admitted seats
   Integer arithmetic only, so 2 of 3 passes 66% and 3 of 4 passes 75%. */

export const THRESHOLDS = ["consensus", "super75", "super66"] as const;
export type Threshold = (typeof THRESHOLDS)[number];
export const isThreshold = (v: unknown): v is Threshold => THRESHOLDS.includes(v as Threshold);

export type Decision = {
  passed: boolean;
  answered: number;
  consenting: number;
  required: number;
  /** Why it has not passed yet, if it hasn't. */
  blocker: null | "waiting" | "objection" | "rewording" | "short";
};

export function decide(threshold: Threshold | string | null | undefined, t: {
  required: number; full: number; reservations: number; objection: number; rewording: number;
}): Decision {
  const th: Threshold = isThreshold(threshold) ? threshold : "consensus";
  const consenting = t.full + t.reservations;
  const answered = consenting + t.objection + t.rewording;
  const base = { answered, consenting, required: t.required };
  if (t.required <= 0 || answered < t.required) return { ...base, passed: false, blocker: "waiting" };
  if (th === "consensus") {
    if (t.objection > 0) return { ...base, passed: false, blocker: "objection" };
    if (t.rewording > 0) return { ...base, passed: false, blocker: "rewording" };
    return { ...base, passed: true, blocker: null };
  }
  const ok = th === "super75" ? consenting * 4 >= t.required * 3 : consenting * 3 >= t.required * 2;
  if (ok) return { ...base, passed: true, blocker: null };
  return { ...base, passed: false, blocker: t.rewording > 0 && t.objection === 0 ? "rewording" : "short" };
}
