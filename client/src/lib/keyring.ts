/*
 * Local keyring. Private keys never leave this browser tab: they live in
 * memory and in this tab's sessionStorage (never sent to any server; see the
 * threat model for its limits). Signing out or closing the tab wipes them.
 */
import * as E from "@shared/e2ee";

export type RoomSecrets = {
  epoch: number;
  createdAt: number; // when this epoch's room key was made; drives time-based rotation
  roomKey: string;
  attestPriv: JsonWebKey;
  attestPub: string;
  caucus: Record<string, string>;
};

/** ECDH pair for receiving the room key, ECDSA pair for signing chat. */
export type SeatKeys = E.SeatKeyPair & { signPub: string; signPriv: JsonWebKey };

type Keyring = {
  seats: Record<string, SeatKeys>;
  rooms: Record<string, RoomSecrets>;
  codes: Record<string, string>; // last safety code seen, per room
};

let ring: Keyring = { seats: {}, rooms: {}, codes: {} };
let onChange: (() => void) | null = null;

export function loadKeyring(raw: unknown) {
  if (raw && typeof raw === "object") {
    const r = raw as Partial<Keyring>;
    ring = { seats: r.seats ?? {}, rooms: r.rooms ?? {}, codes: r.codes ?? {} };
  }
}
export function keyringSnapshot(): Keyring | null {
  return Object.keys(ring.seats).length || Object.keys(ring.rooms).length ? ring : null;
}
export function onKeyringChange(fn: () => void) { onChange = fn; }
export function wipeKeyring() { ring = { seats: {}, rooms: {}, codes: {} }; onChange?.(); }
function save() { onChange?.(); }

export async function seatKeys(seatId: number): Promise<SeatKeys> {
  const k = ring.seats[seatId];
  if (k?.signPub && k.signPriv) return k;
  const ecdh = k ?? await E.newSeatKeyPair(); // keyrings from before signing keys keep their ECDH pair
  const sign = await E.newSigningKeyPair();
  const fresh: SeatKeys = { pub: ecdh.pub, priv: ecdh.priv, signPub: sign.pub, signPriv: sign.priv };
  ring.seats[seatId] = fresh;
  save();
  return fresh;
}

export function roomSecrets(roomId: number): RoomSecrets | undefined {
  return ring.rooms[roomId];
}
export function setRoomSecrets(roomId: number, s: RoomSecrets) {
  ring.rooms[roomId] = s;
  save();
}

/** Returns the previous safety code if it changed, else null. */
export function noteSafetyCode(roomId: number, code: string): string | null {
  const prev = ring.codes[roomId];
  if (prev === code) return null;
  ring.codes[roomId] = code;
  save();
  return prev ?? null;
}

export function wrapContext(roomId: number, seatId: number, epoch: number) {
  return `room:${roomId}|seat:${seatId}|epoch:${epoch}`;
}

/** Fresh invite code, generated here so the server only ever sees its hash. */
export function newInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const bytes = E.randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i] % 32];
  return out.match(/.{4}/g)!.join("-");
}

export function normInvite(code: string) {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}
export function inviteHash(code: string) {
  return E.sha256b64(normInvite(code));
}
