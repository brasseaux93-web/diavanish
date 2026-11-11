/*
 * Diavanish end-to-end encryption.
 *
 * Trust model
 *  - Every room has a symmetric room key K (AES-256-GCM) generated on the
 *    facilitator's device. The server never sees K.
 *  - Each seat generates an ECDH P-256 key pair in its own browser and uploads
 *    only the public half. The facilitator's device wraps K for each admitted
 *    seat (ephemeral ECDH + HKDF-SHA-256 + AES-GCM) and posts the wrapped
 *    blob; the server relays opaque bytes.
 *  - A private caucus key per seat is wrapped alongside K, so other seats
 *    cannot read a facilitator↔seat caucus.
 *  - Role attestations are ECDSA P-256 signatures made on the facilitator's
 *    device over the role bound to a single-use invite.
 *  - Each seat also holds an ECDSA P-256 signing key. The facilitator's device
 *    certifies (room, seat, label, signing-key hash) with its attestation key,
 *    and every chat line is signed by its sender, so a room member holding K
 *    cannot post under another seat's name.
 *  - K rotates on removal and when an epoch grows older than EPOCH_MAX_AGE_MS.
 *  - The safety code is a short hash of the room code and the facilitator's
 *    attestation key. Everyone compares it aloud at the opening; if the server
 *    swapped that key, the codes would not match. Wraps are signed by that key,
 *    so a swapped room key is already refused.
 *  - Chat plaintext is padded to fixed buckets before encryption so
 *    ciphertext length does not reveal message length.
 *
 * Uses only WebCrypto, so the same code runs in browsers and Node ≥ 20.
 */

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const PAD_BUCKETS = [256, 1024, 4096];

/** The facilitator's browser starts a fresh room key once an epoch is this old. */
export const EPOCH_MAX_AGE_MS = 30 * 60_000;

export function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

/* ── Keys ── */

export async function newRoomKey(): Promise<string> {
  return b64(randomBytes(32));
}

async function aesKey(raw: string | Uint8Array, usage: KeyUsage[] = ["encrypt", "decrypt"]) {
  const bytes = typeof raw === "string" ? unb64(raw) : raw;
  return subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, usage);
}

export type SeatKeyPair = { pub: string; priv: JsonWebKey };

export async function newSeatKeyPair(): Promise<SeatKeyPair> {
  const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = b64(await subtle.exportKey("raw", kp.publicKey));
  const priv = await subtle.exportKey("jwk", kp.privateKey);
  return { pub, priv };
}

export type AttestKeyPair = { pub: string; priv: JsonWebKey };

export async function newAttestKeyPair(): Promise<AttestKeyPair> {
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = b64(await subtle.exportKey("raw", kp.publicKey));
  const priv = await subtle.exportKey("jwk", kp.privateKey);
  return { pub, priv };
}

/** Seat signing keys are ECDSA P-256, the same shape as the attestation key. */
export const newSigningKeyPair = newAttestKeyPair;

export async function pubHash(pub: string): Promise<string> {
  const h = await subtle.digest("SHA-256", unb64(pub));
  return b64(h).slice(0, 16);
}

/* ── Wrapping: ephemeral ECDH → HKDF → AES-GCM ── */

export type KeyBundle = {
  epoch: number;
  roomKey: string;
  caucusKey: string;
  attestPub: string;
};

export type Wrapped = { eph: string; iv: string; ct: string };

/**
 * What the facilitator signs for each wrapped room key. Binding the seat's own
 * public-key hash means the server cannot swap in its own key, read the room
 * key, and quietly re-wrap it for the seat: the seat checks this signature
 * against the signing key inside the safety code, and against its own key.
 */
export function wrapSigMessage(context: string, seatPubHash: string, w: Wrapped) {
  return `aperture-wrap-v1|${context}|${seatPubHash}|${w.eph}|${w.iv}|${w.ct}`;
}

async function wrapKeyFrom(secret: ArrayBuffer, info: string) {
  const ikm = await subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("aperture-wrap-v1"), info: enc.encode(info) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapFor(seatPub: string, bundle: KeyBundle, context: string): Promise<Wrapped> {
  const eph = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const peer = await subtle.importKey("raw", unb64(seatPub), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = await subtle.deriveBits({ name: "ECDH", public: peer }, eph.privateKey, 256);
  const key = await wrapKeyFrom(secret, context);
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(context) }, key,
    enc.encode(JSON.stringify(bundle)));
  return { eph: b64(await subtle.exportKey("raw", eph.publicKey)), iv: b64(iv), ct: b64(ct) };
}

export async function unwrap(priv: JsonWebKey, w: Wrapped, context: string): Promise<KeyBundle> {
  const me = await subtle.importKey("jwk", priv, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const peer = await subtle.importKey("raw", unb64(w.eph), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = await subtle.deriveBits({ name: "ECDH", public: peer }, me, 256);
  const key = await wrapKeyFrom(secret, context);
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: unb64(w.iv), additionalData: enc.encode(context) },
    key, unb64(w.ct));
  return JSON.parse(dec.decode(pt));
}

/* ── Messages ── */

/** `from` is a seat id or "facilitator"; `sig` is by that sender's signing key. */
export type ChatBody = { from: number | "facilitator"; label: string; text: string; sentAt: number };
export type ChatPlain = ChatBody & { sig?: string };
export type ChatCipher = { epoch: number; iv: string; ct: string };

function pad(bytes: Uint8Array): Uint8Array {
  const need = bytes.length + 4;
  const size = PAD_BUCKETS.find((b) => b >= need) ?? Math.ceil(need / 4096) * 4096;
  const out = randomBytes(size); // random filler, not zeros
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}

function unpad(bytes: Uint8Array): Uint8Array {
  const len = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  return bytes.slice(4, 4 + len);
}

export async function sealMessage(keyB64: string, epoch: number, channel: string, msg: ChatPlain): Promise<ChatCipher> {
  const key = await aesKey(keyB64);
  const iv = randomBytes(12);
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(`aperture-chat-v1|${channel}|${epoch}`) },
    key, pad(enc.encode(JSON.stringify(msg))),
  );
  return { epoch, iv: b64(iv), ct: b64(ct) };
}

export async function openMessage(keyB64: string, channel: string, c: ChatCipher): Promise<ChatPlain> {
  // Callers must treat the result as unverified until verifyChat() says otherwise.
  const key = await aesKey(keyB64);
  const pt = await subtle.decrypt(
    { name: "AES-GCM", iv: unb64(c.iv), additionalData: enc.encode(`aperture-chat-v1|${channel}|${c.epoch}`) },
    key, unb64(c.ct),
  );
  return JSON.parse(dec.decode(unpad(new Uint8Array(pt))));
}

/* ── Safety code: compare aloud ──
   Deliberately independent of the room key and epoch, so routine rotation does
   not raise an alarm. What it catches is a swapped facilitator signing key,
   which is the key every wrap and sender certificate hangs from. */

export async function safetyCode(roomCode: string, attestPub: string): Promise<string> {
  const h = new Uint8Array(await subtle.digest("SHA-256",
    enc.encode(`aperture-safety-v2|${roomCode}|${attestPub}`)));
  const n = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
  const m = ((h[4] << 8) | h[5]) >>> 0;
  const digits = (String(n).padStart(10, "0") + String(m).padStart(5, "0")).slice(0, 12);
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)}`;
}

/* ── Role attestation: signed on the facilitator's device ── */

export function attestationMessage(roomCode: string, role: string, inviteHash: string) {
  return `aperture-role-v1\n${roomCode}\n${role}\n${inviteHash}`;
}

export async function signAttestation(priv: JsonWebKey, message: string): Promise<string> {
  const key = await subtle.importKey("jwk", priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return b64(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(message)));
}

export async function verifyAttestation(pub: string, message: string, sig: string): Promise<boolean> {
  try {
    const key = await subtle.importKey("raw", unb64(pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, unb64(sig), enc.encode(message));
  } catch {
    return false;
  }
}

export async function sha256b64(s: string): Promise<string> {
  return b64(await subtle.digest("SHA-256", enc.encode(s)));
}

/* ── Per-sender signatures ──
   Messages are JSON arrays so no field can smuggle a separator into another. */

export type SenderCert = { seatId: number; label: string; signPub: string; sig: string };

/** Full SHA-256 of a raw public key (pubHash() is a short display form). */
export async function keyDigest(pub: string): Promise<string> {
  return b64(await subtle.digest("SHA-256", unb64(pub)));
}

export function senderCertMessage(roomCode: string, seatId: number, label: string, signPubDigest: string) {
  return JSON.stringify(["aperture-sender-v1", roomCode, seatId, label, signPubDigest]);
}

/** Facilitator side: certify a seat's signing key under the label the facilitator sees. */
export async function issueSenderCert(
  attestPriv: JsonWebKey, roomCode: string, seatId: number, label: string, signPub: string,
): Promise<SenderCert> {
  const sig = await signAttestation(attestPriv, senderCertMessage(roomCode, seatId, label, await keyDigest(signPub)));
  return { seatId, label, signPub, sig };
}

export async function verifySenderCert(attestPub: string, roomCode: string, c: SenderCert): Promise<boolean> {
  if (!c || !Number.isInteger(c.seatId) || typeof c.label !== "string" || typeof c.signPub !== "string") return false;
  let digest: string;
  try { digest = await keyDigest(c.signPub); } catch { return false; }
  return verifyAttestation(attestPub, senderCertMessage(roomCode, c.seatId, c.label, digest), c.sig);
}

export function chatSigMessage(channel: string, epoch: number, m: ChatBody) {
  return JSON.stringify(["aperture-msg-v1", channel, epoch, m.from, m.label, m.text, m.sentAt]);
}

export async function signChat(priv: JsonWebKey, channel: string, epoch: number, body: ChatBody): Promise<ChatPlain> {
  return { ...body, sig: await signAttestation(priv, chatSigMessage(channel, epoch, body)) };
}

export type ChatVerdict = { ok: true; from: number | "facilitator"; name: string } | { ok: false };

/**
 * Checks a decrypted line against certificates this device has already
 * verified. The name to display comes from the certificate, never from the
 * message, so a member holding the room key cannot post as someone else.
 */
export async function verifyChat(
  m: ChatPlain, channel: string, epoch: number,
  opts: { attestPub: string | null; roster: Map<number, SenderCert[]>; facilitatorName: string },
): Promise<ChatVerdict> {
  if (!m || typeof m.sig !== "string" || typeof m.text !== "string" || typeof m.label !== "string"
    || typeof m.sentAt !== "number") return { ok: false };
  const msg = chatSigMessage(channel, epoch, m);
  if (m.from === "facilitator") {
    if (!opts.attestPub || !(await verifyAttestation(opts.attestPub, msg, m.sig))) return { ok: false };
    return { ok: true, from: "facilitator", name: opts.facilitatorName };
  }
  if (!Number.isInteger(m.from)) return { ok: false };
  // A caucus channel belongs to one seat and the facilitator.
  if (channel.startsWith("caucus:") && channel !== `caucus:${m.from}`) return { ok: false };
  for (const c of opts.roster.get(m.from) ?? []) {
    if (c.seatId === m.from && c.label === m.label && await verifyAttestation(c.signPub, msg, m.sig)) {
      return { ok: true, from: m.from, name: c.label };
    }
  }
  return { ok: false };
}
