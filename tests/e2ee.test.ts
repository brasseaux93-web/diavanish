import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAD_BUCKETS, b64, unb64, newRoomKey, newSeatKeyPair, newAttestKeyPair, pubHash,
  wrapFor, unwrap, wrapSigMessage, sealMessage, openMessage, safetyCode,
  attestationMessage, signAttestation, verifyAttestation, newSigningKeyPair, issueSenderCert,
  verifySenderCert, signChat, verifyChat, type KeyBundle, type SenderCert,
} from "../shared/e2ee";

async function bundle(epoch = 1): Promise<KeyBundle> {
  const attest = await newAttestKeyPair();
  return { epoch, roomKey: await newRoomKey(), caucusKey: await newRoomKey(), attestPub: attest.pub };
}

function flip(s: string): string {
  const bytes = unb64(s);
  bytes[bytes.length - 1] ^= 1;
  return b64(bytes);
}

test("base64 round-trips arbitrary bytes", () => {
  const bytes = new Uint8Array(256).map((_, i) => i);
  assert.deepEqual(unb64(b64(bytes)), bytes);
});

test("a wrapped key bundle opens only for its seat and context", async () => {
  const seat = await newSeatKeyPair();
  const other = await newSeatKeyPair();
  const b = await bundle();
  const w = await wrapFor(seat.pub, b, "room-1|seat-1|1");

  assert.deepEqual(await unwrap(seat.priv, w, "room-1|seat-1|1"), b);
  await assert.rejects(unwrap(other.priv, w, "room-1|seat-1|1"));
  await assert.rejects(unwrap(seat.priv, w, "room-1|seat-2|1"));
  await assert.rejects(unwrap(seat.priv, w, "room-1|seat-1|2"));
  await assert.rejects(unwrap(seat.priv, { ...w, ct: flip(w.ct) }, "room-1|seat-1|1"));
});

test("the wrap signature binds the seat key and the ciphertext", async () => {
  const facilitator = await newAttestKeyPair();
  const seat = await newSeatKeyPair();
  const swapped = await newSeatKeyPair();
  const w = await wrapFor(seat.pub, await bundle(), "ctx");
  const sig = await signAttestation(facilitator.priv, wrapSigMessage("ctx", await pubHash(seat.pub), w));

  assert.equal(await verifyAttestation(facilitator.pub, wrapSigMessage("ctx", await pubHash(seat.pub), w), sig), true);
  assert.equal(await verifyAttestation(facilitator.pub, wrapSigMessage("ctx", await pubHash(swapped.pub), w), sig), false);
  assert.equal(await verifyAttestation(facilitator.pub, wrapSigMessage("ctx", await pubHash(seat.pub), { ...w, ct: flip(w.ct) }), sig), false);
});

test("chat messages round-trip and reject the wrong key, channel, epoch or tampering", async () => {
  const key = await newRoomKey();
  const msg = { from: 1, label: "Seat A", text: "We can meet Thursday.", sentAt: 1700000000000 };
  const c = await sealMessage(key, 3, "floor", msg);

  assert.deepEqual(await openMessage(key, "floor", c), msg);
  await assert.rejects(openMessage(await newRoomKey(), "floor", c));
  await assert.rejects(openMessage(key, "caucus:1", c));
  await assert.rejects(openMessage(key, "floor", { ...c, epoch: 4 }));
  await assert.rejects(openMessage(key, "floor", { ...c, ct: flip(c.ct) }));
});

test("ciphertext length depends on the padding bucket, not the message length", async () => {
  const key = await newRoomKey();
  const short = await sealMessage(key, 1, "floor", { from: 1, label: "A", text: "ok", sentAt: 0, sig: "x".repeat(88) });
  const longer = await sealMessage(key, 1, "floor", { from: 1, label: "A", text: "x".repeat(80), sentAt: 0, sig: "x".repeat(88) });
  const tag = 16;

  assert.equal(unb64(short.ct).length, PAD_BUCKETS[0] + tag);
  assert.equal(unb64(longer.ct).length, unb64(short.ct).length);
  const big = await sealMessage(key, 1, "floor", { from: 1, label: "A", text: "x".repeat(2000), sentAt: 0, sig: "x".repeat(88) });
  assert.equal(unb64(big.ct).length, PAD_BUCKETS[2] + tag);
});

test("the safety code depends on the room and the facilitator's signing key, not the epoch", async () => {
  const { pub } = await newAttestKeyPair();
  const code = await safetyCode("ROOM42", pub);

  assert.match(code, /^\d{4} \d{4} \d{4}$/);
  assert.equal(await safetyCode("ROOM42", pub), code); // stable across rotations
  assert.notEqual(await safetyCode("ROOM43", pub), code);
  assert.notEqual(await safetyCode("ROOM42", (await newAttestKeyPair()).pub), code);
});

test("role attestations verify only for the signed role, invite and signer", async () => {
  const facilitator = await newAttestKeyPair();
  const message = attestationMessage("ROOM42", "mediator", "invite-hash");
  const sig = await signAttestation(facilitator.priv, message);

  assert.equal(await verifyAttestation(facilitator.pub, message, sig), true);
  assert.equal(await verifyAttestation(facilitator.pub, attestationMessage("ROOM42", "observer", "invite-hash"), sig), false);
  assert.equal(await verifyAttestation(facilitator.pub, attestationMessage("ROOM42", "mediator", "other"), sig), false);
  assert.equal(await verifyAttestation((await newAttestKeyPair()).pub, message, sig), false);
  assert.equal(await verifyAttestation(facilitator.pub, message, "not-a-signature"), false);
});

async function certified(fac: { priv: JsonWebKey }, seatId: number, label: string) {
  const keys = await newSigningKeyPair();
  return { keys, cert: await issueSenderCert(fac.priv, "ROOM42", seatId, label, keys.pub) };
}

test("sender certificates bind room, seat, label and signing key to the facilitator", async () => {
  const fac = await newAttestKeyPair();
  const { cert } = await certified(fac, 7, "Heron");
  const other = await newSigningKeyPair();

  assert.equal(await verifySenderCert(fac.pub, "ROOM42", cert), true);
  assert.equal(await verifySenderCert(fac.pub, "ROOM43", cert), false);
  assert.equal(await verifySenderCert(fac.pub, "ROOM42", { ...cert, seatId: 8 }), false);
  assert.equal(await verifySenderCert(fac.pub, "ROOM42", { ...cert, label: "Kestrel" }), false);
  assert.equal(await verifySenderCert(fac.pub, "ROOM42", { ...cert, signPub: other.pub }), false);
  assert.equal(await verifySenderCert((await newAttestKeyPair()).pub, "ROOM42", cert), false);
  // Self-issued by a seat rather than the facilitator.
  const self = await issueSenderCert(other.priv, "ROOM42", 7, "Heron", other.pub);
  assert.equal(await verifySenderCert(fac.pub, "ROOM42", self), false);
});

test("chat signatures verify only for the certified sender, label, text, channel and epoch", async () => {
  const fac = await newAttestKeyPair();
  const heron = await certified(fac, 7, "Heron");
  const kestrel = await certified(fac, 8, "Kestrel");
  const roster = new Map<number, SenderCert[]>([[7, [heron.cert]], [8, [kestrel.cert]]]);
  const opts = { attestPub: fac.pub, roster, facilitatorName: "Facilitator" };
  const body = { from: 7, label: "Heron", text: "We accept the schedule.", sentAt: 1700000000000 };
  const m = await signChat(heron.keys.priv, "floor", 2, body);

  assert.deepEqual(await verifyChat(m, "floor", 2, opts), { ok: true, from: 7, name: "Heron" });
  assert.equal((await verifyChat({ ...m, text: "We reject the schedule." }, "floor", 2, opts)).ok, false);
  assert.equal((await verifyChat({ ...m, label: "Kestrel" }, "floor", 2, opts)).ok, false);
  assert.equal((await verifyChat({ ...m, sentAt: m.sentAt + 1 }, "floor", 2, opts)).ok, false);
  assert.equal((await verifyChat(m, "floor", 3, opts)).ok, false);
  assert.equal((await verifyChat(m, "caucus:7", 2, opts)).ok, false);
  assert.equal((await verifyChat({ ...m, sig: undefined }, "floor", 2, opts)).ok, false);

  // Kestrel holds the floor key and tries to speak as Heron: wrong signer.
  const forged = await signChat(kestrel.keys.priv, "floor", 2, body);
  assert.equal((await verifyChat(forged, "floor", 2, opts)).ok, false);
  // Kestrel re-labels its own seat id as Heron: label does not match its certificate.
  const relabel = await signChat(kestrel.keys.priv, "floor", 2, { ...body, from: 8 });
  assert.equal((await verifyChat(relabel, "floor", 2, opts)).ok, false);
  // Kestrel forges the seat id but keeps its own label.
  const seatSwap = await signChat(kestrel.keys.priv, "floor", 2, { ...body, from: 7, label: "Kestrel" });
  assert.equal((await verifyChat(seatSwap, "floor", 2, opts)).ok, false);
  // Kestrel claims to be the facilitator.
  const asFac = await signChat(kestrel.keys.priv, "floor", 2, { ...body, from: "facilitator" });
  assert.equal((await verifyChat(asFac, "floor", 2, opts)).ok, false);
  // A seat outside the roster.
  assert.equal((await verifyChat(m, "floor", 2, { ...opts, roster: new Map() })).ok, false);
});

test("facilitator lines verify against the attestation key and show the fixed name", async () => {
  const fac = await newAttestKeyPair();
  const opts = { attestPub: fac.pub, roster: new Map<number, SenderCert[]>(), facilitatorName: "Facilitator" };
  const m = await signChat(fac.priv, "caucus:7", 4, { from: "facilitator", label: "anything", text: "Take five.", sentAt: 1 });

  assert.deepEqual(await verifyChat(m, "caucus:7", 4, opts), { ok: true, from: "facilitator", name: "Facilitator" });
  assert.equal((await verifyChat(m, "caucus:7", 4, { ...opts, attestPub: (await newAttestKeyPair()).pub })).ok, false);
  assert.equal((await verifyChat(m, "caucus:7", 4, { ...opts, attestPub: null })).ok, false);
});
