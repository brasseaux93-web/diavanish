/*
 * End-to-end encryption, browser side.
 *
 *  • Each seat makes an ECDH key pair (to receive the room key) and an ECDSA
 *    key pair (to sign chat) here; only the public halves are uploaded.
 *  • The facilitator's browser makes the room key, wraps it for every
 *    admitted seat's public key, certifies each seat's signing key under the
 *    label the facilitator sees, and rotates the room key whenever a seat is
 *    removed or the epoch is older than E.EPOCH_MAX_AGE_MS.
 *  • Chat is signed and sealed with AES-GCM before it leaves the tab. The
 *    server relays padded ciphertext with no sender, no label and no timestamp.
 *  • Everyone sees a safety code derived from the room code and the
 *    facilitator's signing key. Reading it aloud proves no one swapped it.
 */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import * as E from "@shared/e2ee";
import { apiJson } from "./queryClient";
import {
  seatKeys, roomSecrets, setRoomSecrets, noteSafetyCode, wrapContext, type RoomSecrets,
} from "./keyring";

export type Signer = { from: number | "facilitator"; priv: JsonWebKey; pub: string };

export type CryptoState = {
  status: "starting" | "waiting" | "ready" | "error";
  demo: boolean;
  epoch: number;
  roomKey: string | null;
  caucusKey: string | null; // participant: own caucus key; facilitator: use caucusFor()
  attestPub: string | null;
  attestPriv: JsonWebKey | null; // facilitator only
  roomCode: string | null;
  safety: string | null;
  safetyChanged: boolean;
  signer: Signer | null;
  roster: Map<number, E.SenderCert[]>; // certificates this browser has verified itself
  rosterVersion: number;
  caucusFor: (seatId: number) => string | null;
  keyForEpoch: (epoch: number, channel: string) => string | null;
  attestForEpoch: (epoch: number) => string | null;
};

const empty: CryptoState = {
  status: "starting", demo: false, epoch: 0, roomKey: null, caucusKey: null, attestPub: null,
  attestPriv: null, roomCode: null, safety: null, safetyChanged: false,
  signer: null, roster: new Map(), rosterVersion: 0,
  caucusFor: () => null, keyForEpoch: () => null, attestForEpoch: () => null,
};

export const CryptoContext = createContext<CryptoState>(empty);
export const useRoomCrypto = () => useContext(CryptoContext);

/**
 * Verified sender certificates, kept in memory for the life of the tab so
 * scrollback from a seat that has since left still verifies.
 */
function useRoster() {
  const roster = useRef(new Map<number, E.SenderCert[]>());
  const seen = useRef(new Set<string>());
  const version = useRef(0);
  const absorb = async (certs: (E.SenderCert | null | undefined)[], attestPub: string, roomCode: string) => {
    let changed = false;
    for (const c of certs) {
      if (!c) continue;
      const id = `${attestPub}|${c.seatId}|${c.label}|${c.signPub}|${c.sig}`;
      if (seen.current.has(id)) continue;
      seen.current.add(id);
      if (!(await E.verifySenderCert(attestPub, roomCode, c))) continue;
      roster.current.set(c.seatId, [...(roster.current.get(c.seatId) ?? []), c]);
      changed = true;
    }
    if (changed) version.current++;
    return changed;
  };
  return { roster, version, absorb };
}

/* ── Participant ── */

type SeatDir = {
  epoch: number; hasPub: boolean; roomId: number; roomCode: string; demo: boolean;
  wrap: { epoch: number; pubHash: string; eph: string; iv: string; ct: string; sig: string } | null;
  roster: E.SenderCert[];
};

export function useSeatCrypto(seatId: number | undefined, active: boolean): CryptoState {
  const [state, setState] = useState<CryptoState>(empty);
  const keys = useRef(new Map<string, string>()); // `${epoch}|${channel}` → key, memory only
  const attests = useRef(new Map<number, string>()); // epoch → facilitator signing key
  const current = useRef<E.KeyBundle | null>(null);
  const changedFlag = useRef(false);
  const busy = useRef(false);
  const { roster, version, absorb } = useRoster();

  useEffect(() => {
    if (!seatId || !active) return;
    let alive = true;
    let uploaded = false;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const mine = await seatKeys(seatId);
        if (!uploaded) {
          await apiJson("POST", "/api/participant/e2ee/pubkey", { pub: mine.pub, signPub: mine.signPub });
          uploaded = true;
        }
        const dir = await apiJson<SeatDir>("GET", "/api/participant/e2ee");
        if (!dir.hasPub) uploaded = false;
        if (!alive) return;
        let fresh = false;
        if (dir.wrap && !keys.current.has(`${dir.wrap.epoch}|floor`)) {
          const ctx = wrapContext(dir.roomId, seatId, dir.wrap.epoch);
          const bundle = await E.unwrap(mine.priv, dir.wrap, ctx);
          // The facilitator signed this wrap for *our* key. If not, someone in the
          // middle swapped keys: refuse the room key rather than chat in the open.
          const myHash = await E.pubHash(mine.pub);
          const signed = await E.verifyAttestation(bundle.attestPub, E.wrapSigMessage(ctx, myHash, dir.wrap), dir.wrap.sig);
          if (!signed || bundle.epoch !== dir.wrap.epoch) throw new Error("wrap signature mismatch");
          // Older epochs stay in memory so scrollback remains readable after rotation.
          keys.current.set(`${bundle.epoch}|floor`, bundle.roomKey);
          keys.current.set(`${bundle.epoch}|caucus:${seatId}`, bundle.caucusKey);
          attests.current.set(bundle.epoch, bundle.attestPub);
          if (!current.current || bundle.epoch > current.current.epoch) current.current = bundle;
          fresh = true;
        }
        const b = current.current;
        if (!b) {
          setState((s) => ({ ...s, status: "waiting", demo: dir.demo, roomCode: dir.roomCode }));
          return;
        }
        const rosterChanged = await absorb(dir.roster, b.attestPub, dir.roomCode);
        if (!fresh && !rosterChanged) return;
        const safety = await E.safetyCode(dir.roomCode, b.attestPub);
        if (noteSafetyCode(dir.roomId, safety) !== null) changedFlag.current = true;
        if (!alive) return;
        setState({
          status: "ready", demo: dir.demo, epoch: b.epoch, roomKey: b.roomKey,
          caucusKey: b.caucusKey, attestPub: b.attestPub, attestPriv: null,
          roomCode: dir.roomCode, safety, safetyChanged: changedFlag.current,
          signer: { from: seatId, priv: mine.signPriv, pub: mine.signPub },
          roster: roster.current, rosterVersion: version.current,
          caucusFor: (id) => (id === seatId ? b.caucusKey : null),
          keyForEpoch: (epoch, channel) => keys.current.get(`${epoch}|${channel}`) ?? null,
          attestForEpoch: (epoch) => attests.current.get(epoch) ?? null,
        });
      } catch {
        if (alive) setState((s) => (s.status === "ready" ? s : { ...s, status: "error" }));
      } finally {
        busy.current = false;
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [seatId, active]);

  return state;
}

/* ── Facilitator ── */

type FacSeat = {
  seatId: number; pub: string | null; pubHash: string | null; wrapped: boolean;
  signPub: string | null; cert: E.SenderCert | null;
};
type FacDir = {
  epoch: number; rekeyNeeded: boolean; roomCode: string;
  demo: (RoomSecrets & { caucus: Record<string, string> }) | null;
  seats: FacSeat[];
};

/**
 * `labels` are the seat names exactly as this facilitator's screen shows them;
 * sender certificates bind those, so a seat's chat lines carry the name the
 * facilitator admitted.
 */
export function useFacilitatorCrypto(roomId: number, active: boolean, labels: Record<number, string> = {}): CryptoState {
  const [state, setState] = useState<CryptoState>(empty);
  const keys = useRef(new Map<string, string>());
  const attests = useRef(new Map<number, string>());
  const issued = useRef(new Set<string>());
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const busy = useRef(false);
  const { roster, version, absorb } = useRoster();

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const publish = async (sec: RoomSecrets, roomCode: string, demo: boolean) => {
      keys.current.set(`${sec.epoch}|floor`, sec.roomKey);
      for (const [sid, k] of Object.entries(sec.caucus)) keys.current.set(`${sec.epoch}|caucus:${sid}`, k);
      attests.current.set(sec.epoch, sec.attestPub);
      const safety = await E.safetyCode(roomCode, sec.attestPub);
      const prev = noteSafetyCode(roomId, safety);
      if (!alive) return;
      setState((s) => ({
        status: "ready", demo, epoch: sec.epoch, roomKey: sec.roomKey, caucusKey: null,
        attestPub: sec.attestPub, attestPriv: sec.attestPriv, roomCode, safety,
        safetyChanged: s.safetyChanged || prev !== null,
        signer: { from: "facilitator", priv: sec.attestPriv, pub: sec.attestPub },
        roster: roster.current, rosterVersion: version.current,
        caucusFor: (id) => sec.caucus[id] ?? null,
        keyForEpoch: (epoch, channel) => keys.current.get(`${epoch}|${channel}`) ?? null,
        attestForEpoch: (epoch) => attests.current.get(epoch) ?? null,
      }));
    };
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const dir = await apiJson<FacDir>("GET", `/api/facilitator/rooms/${roomId}/e2ee`);
        if (dir.demo) {
          await absorb(dir.seats.map((s) => s.cert), dir.demo.attestPub, dir.roomCode);
          await publish(dir.demo, dir.roomCode, true);
          return;
        }

        let sec = roomSecrets(roomId);
        const stale = !!sec && Date.now() - (sec.createdAt ?? 0) > E.EPOCH_MAX_AGE_MS;
        if (!sec || sec.epoch !== dir.epoch || dir.rekeyNeeded || stale) {
          // New epoch: fresh room key; keep this device's signing key if we have one.
          const attest = sec ? { priv: sec.attestPriv, pub: sec.attestPub } : await E.newAttestKeyPair();
          const next: RoomSecrets = {
            epoch: dir.epoch + 1, createdAt: Date.now(), roomKey: await E.newRoomKey(),
            attestPriv: attest.priv, attestPub: attest.pub, caucus: {},
          };
          await apiJson("POST", `/api/facilitator/rooms/${roomId}/e2ee/epoch`, { epoch: next.epoch, attestPub: next.attestPub });
          setRoomSecrets(roomId, next);
          sec = next;
          dir.seats.forEach((s) => (s.wrapped = false));
        }
        let changed = false;
        for (const s of dir.seats) {
          if (!s.pub || !s.pubHash || s.wrapped) continue;
          if (!sec.caucus[s.seatId]) { sec.caucus[s.seatId] = await E.newRoomKey(); changed = true; }
          const ctx = wrapContext(roomId, s.seatId, sec.epoch);
          const w = await E.wrapFor(s.pub, {
            epoch: sec.epoch, roomKey: sec.roomKey, caucusKey: sec.caucus[s.seatId], attestPub: sec.attestPub,
          }, ctx);
          // Sign over the hash we computed ourselves, not the one the server sent.
          const sig = await E.signAttestation(sec.attestPriv, E.wrapSigMessage(ctx, await E.pubHash(s.pub), w));
          await apiJson("POST", `/api/facilitator/rooms/${roomId}/e2ee/wrap`, {
            seatId: s.seatId, epoch: sec.epoch, pubHash: s.pubHash, ...w, sig,
          });
        }
        if (changed) setRoomSecrets(roomId, sec);

        // Certify each seat's signing key under the label shown on this screen.
        const certs: E.SenderCert[] = [];
        for (const s of dir.seats) {
          const label = labelsRef.current[s.seatId];
          if (!s.signPub || !label) continue;
          const want = `${sec.attestPub}|${s.seatId}|${label}|${s.signPub}`;
          const c = s.cert;
          if (c && c.label === label && c.signPub === s.signPub && issued.current.has(`${want}|${c.sig}`)) {
            certs.push(c);
            continue;
          }
          if (c && c.label === label && c.signPub === s.signPub && await E.verifySenderCert(sec.attestPub, dir.roomCode, c)) {
            issued.current.add(`${want}|${c.sig}`);
            certs.push(c);
            continue;
          }
          const cert = await E.issueSenderCert(sec.attestPriv, dir.roomCode, s.seatId, label, s.signPub);
          await apiJson("POST", `/api/facilitator/rooms/${roomId}/e2ee/cert`, cert);
          issued.current.add(`${want}|${cert.sig}`);
          certs.push(cert);
        }
        await absorb(certs, sec.attestPub, dir.roomCode);
        await publish(sec, dir.roomCode, false);
      } catch {
        if (alive) setState((s) => (s.status === "ready" ? s : { ...s, status: "error" }));
      } finally {
        busy.current = false;
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [roomId, active]);

  return state;
}

/* ── Encrypted chat stream ── */

export type ChatLine =
  | {
      seq: number; name: string; text: string; sentAt: number; verified: boolean;
      /** Certified sender, only when verified. */
      from: number | "facilitator" | null;
      /** Sent from this tab (its signature was made here) or certified as this seat. */
      mine: boolean;
    }
  | { seq: number; unreadable: true };

export function useEncryptedChat(opts: {
  crypto: CryptoState; channel: string | null; getUrl: string; postUrl: string;
  label: string; facilitatorName: string; extraBody?: Record<string, unknown>;
}) {
  const { crypto, channel, getUrl, postUrl, label, facilitatorName, extraBody } = opts;
  const [lines, setLines] = useState<ChatLine[]>([]);
  const plain = useRef(new Map<number, { epoch: number; m: E.ChatPlain }>());
  const verdicts = useRef(new Map<number, { v: E.ChatVerdict; at: number }>());
  const firstSeqBySig = useRef(new Map<string, number>());
  const sentSigs = useRef(new Set<string>()); // signatures made in this tab, memory only
  const firstMineSeq = useRef(new Map<string, number>());
  const cryptoRef = useRef(crypto);
  cryptoRef.current = crypto;

  useEffect(() => {
    if (!channel) return;
    let alive = true;
    const poll = async () => {
      const c = cryptoRef.current;
      try {
        const raw = await apiJson<{ seq: number; epoch: number; iv: string; ct: string; channel: string }[]>("GET", getUrl);
        const out: ChatLine[] = [];
        for (const m of raw) {
          let p = plain.current.get(m.seq);
          if (!p) {
            // Unreadable lines are retried every poll, so a newly unwrapped key applies.
            const key = c.keyForEpoch(m.epoch, channel);
            try {
              if (key) plain.current.set(m.seq, p = { epoch: m.epoch, m: await E.openMessage(key, channel, m) });
            } catch { /* wrong key or tampered */ }
          }
          if (!p) { out.push({ seq: m.seq, unreadable: true }); continue; }
          // Failed checks are retried when a new certificate arrives.
          let cached = verdicts.current.get(m.seq);
          if (!cached || (!cached.v.ok && cached.at !== c.rosterVersion)) {
            const v = await E.verifyChat(p.m, channel, p.epoch, {
              attestPub: c.attestForEpoch(p.epoch) ?? c.attestPub, roster: c.roster, facilitatorName,
            });
            cached = { v, at: c.rosterVersion };
            verdicts.current.set(m.seq, cached);
          }
          let ok = cached.v.ok;
          // A copied ciphertext replays a genuine signature; only the first copy counts.
          if (ok && p.m.sig) {
            const first = firstSeqBySig.current.get(p.m.sig) ?? m.seq;
            firstSeqBySig.current.set(p.m.sig, Math.min(first, m.seq));
            if (Math.min(first, m.seq) !== m.seq) ok = false;
          }
          const from = ok && cached.v.ok ? cached.v.from : null;
          // A line counts as ours if it is certified as us, or carries a signature
          // this tab made (first copy only, so a replay does not pose as ours).
          let sentHere = false;
          if (p.m.sig && sentSigs.current.has(p.m.sig)) {
            const first = firstMineSeq.current.get(p.m.sig) ?? m.seq;
            firstMineSeq.current.set(p.m.sig, Math.min(first, m.seq));
            sentHere = Math.min(first, m.seq) === m.seq;
          }
          const mine = (from !== null && c.signer !== null && from === c.signer.from) || sentHere;
          out.push({
            seq: m.seq, text: String(p.m.text ?? ""), sentAt: Number(p.m.sentAt) || 0, verified: ok,
            name: cached.v.ok ? cached.v.name : String(p.m.label ?? "?").slice(0, 120),
            from, mine,
          });
        }
        if (alive) setLines(out);
      } catch { /* locked or offline */ }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [channel, getUrl, crypto.epoch, crypto.status, crypto.rosterVersion]);

  const send = async (text: string) => {
    if (!channel) throw new Error("No channel");
    const key = crypto.keyForEpoch(crypto.epoch, channel);
    if (!key || crypto.status !== "ready" || !crypto.signer) throw new Error("Waiting for the room key");
    const s = crypto.signer;
    const mine = s.from === "facilitator" ? null
      : (crypto.roster.get(s.from) ?? []).filter((c) => c.signPub === s.pub).at(-1);
    const body: E.ChatBody = {
      from: s.from, label: s.from === "facilitator" ? facilitatorName : mine?.label ?? label,
      text: text.slice(0, 2000), sentAt: Date.now(),
    };
    const signed = await E.signChat(s.priv, channel, crypto.epoch, body);
    if (signed.sig) sentSigs.current.add(signed.sig);
    const sealed = await E.sealMessage(key, crypto.epoch, channel, signed);
    await apiJson("POST", postUrl, { ...sealed, ...(extraBody ?? {}) });
  };

  return { lines, send };
}

/* ── Role attestations, checked in this browser ── */

export type Attestation = { role: string; inviteHash: string; sig: string; pub: string } | null;
export type AttestResult = "verified" | "earlier-key" | "invalid" | "none";

export function useAttestations(
  seatsList: { id: number; claimedRole: string; attestation?: Attestation }[] | undefined,
  crypto: CryptoState,
): Record<number, AttestResult> {
  const [out, setOut] = useState<Record<number, AttestResult>>({});
  const sig = JSON.stringify((seatsList ?? []).map((s) => [s.id, s.attestation?.sig ?? null])) + crypto.attestPub;
  useEffect(() => {
    if (!seatsList || !crypto.roomCode) return;
    let alive = true;
    (async () => {
      const res: Record<number, AttestResult> = {};
      for (const s of seatsList) {
        const a = s.attestation;
        if (!a) { res[s.id] = "none"; continue; }
        const ok = a.role === s.claimedRole &&
          await E.verifyAttestation(a.pub, E.attestationMessage(crypto.roomCode!, a.role, a.inviteHash), a.sig);
        res[s.id] = !ok ? "invalid" : a.pub === crypto.attestPub ? "verified" : "earlier-key";
      }
      if (alive) setOut(res);
    })().catch(() => {});
    return () => { alive = false; };
  }, [sig, crypto.roomCode]);
  return out;
}
