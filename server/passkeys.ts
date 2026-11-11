/*
 * WebAuthn passkeys for administrators and facilitators.
 * Registration happens after an email-code (or later, SSO) session.
 * Sign-in is phishing-resistant and does not need the email field
 * when the authenticator returns a discoverable credential.
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { Request } from "express";
import { eq, and } from "drizzle-orm";
import { platformSettings, passkeys, admins, facilitators } from "@shared/schema";
import { db, now, createSession } from "./storage";
import { oidcStatus } from "./oidc";

const challenges = new Map<string, { kind: "reg" | "auth"; role?: string; userId?: number; challenge: string; expires: number }>();

function gc() {
  const t = Date.now();
  for (const [k, v] of Array.from(challenges.entries())) if (v.expires < t) challenges.delete(k);
}

function settings() {
  return db.select().from(platformSettings).get()!;
}

export function relyingParty(req: Request) {
  const hostHeader = String(req.get("x-forwarded-host") || req.get("host") || "localhost");
  const host = hostHeader.split(":")[0] || "localhost";
  const rpID = process.env.APERTURE_RP_ID || host;
  const origin = process.env.APERTURE_ORIGIN || `${req.protocol}://${hostHeader}`;
  const rpName = settings().orgName || "Diavanish";
  return { rpID, origin, rpName };
}

export function emailCodeAllowed(role: string): { ok: true } | { ok: false; status: number; message: string } {
  if (role !== "admin" && role !== "facilitator") return { ok: true };
  const s = settings();
  if (!s.emailCodeEnabled) {
    return { ok: false, status: 403, message: "Email codes are turned off on this server" };
  }
  if (s.requirePasskey) {
    return { ok: false, status: 403, message: "This role must sign in with a passkey" };
  }
  return { ok: true };
}

export function authMethods() {
  const s = settings();
  return {
    passkey: true,
    emailCode: !!s.emailCodeEnabled && !s.requirePasskey,
    oidc: oidcStatus(),
  };
}

export function listPasskeys(role: "admin" | "facilitator", userId: number) {
  return db.select().from(passkeys).where(and(eq(passkeys.role, role), eq(passkeys.userId, userId))).all()
    .map(({ publicKey: _pk, ...rest }) => rest);
}

export function deletePasskey(role: "admin" | "facilitator", userId: number, id: number) {
  const row = db.select().from(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.role, role), eq(passkeys.userId, userId))).get();
  if (!row) return false;
  db.delete(passkeys).where(eq(passkeys.id, row.id)).run();
  return true;
}

export async function registrationOptions(req: Request, role: "admin" | "facilitator", userId: number, email: string) {
  const { rpID, rpName } = relyingParty(req);
  const existing = db.select().from(passkeys).where(and(eq(passkeys.role, role), eq(passkeys.userId, userId))).all();
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: email,
    userDisplayName: email,
    userID: new TextEncoder().encode(`${role}:${userId}`),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({
      id: p.credentialId,
      transports: (p.transports ? JSON.parse(p.transports) : []) as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
  gc();
  challenges.set(`reg:${role}:${userId}`, {
    kind: "reg", role, userId, challenge: options.challenge, expires: Date.now() + 5 * 60_000,
  });
  return options;
}

export async function verifyRegistration(
  req: Request,
  role: "admin" | "facilitator",
  userId: number,
  response: RegistrationResponseJSON,
  nickname?: string,
) {
  const pending = challenges.get(`reg:${role}:${userId}`);
  if (!pending || pending.kind !== "reg") {
    const err: any = new Error("Passkey registration expired. Try again.");
    err.status = 400;
    throw err;
  }
  const { rpID, origin } = relyingParty(req);
  const verified = await verifyRegistrationResponse({
    response,
    expectedChallenge: pending.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
  challenges.delete(`reg:${role}:${userId}`);
  if (!verified.verified || !verified.registrationInfo) {
    const err: any = new Error("Could not verify that passkey");
    err.status = 400;
    throw err;
  }
  const cred = verified.registrationInfo.credential;
  const row = db.insert(passkeys).values({
    role, userId,
    credentialId: cred.id,
    publicKey: isoBase64URL.fromBuffer(cred.publicKey),
    counter: cred.counter,
    transports: JSON.stringify(response.response.transports ?? cred.transports ?? []),
    nickname: nickname?.slice(0, 80) || null,
    createdAt: now(),
    lastUsedAt: null,
  }).returning().get();
  const { publicKey: _pk, ...safe } = row;
  return safe;
}

export async function authenticationOptions(req: Request) {
  const { rpID } = relyingParty(req);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
  });
  gc();
  challenges.set(`auth:${options.challenge}`, {
    kind: "auth", challenge: options.challenge, expires: Date.now() + 5 * 60_000,
  });
  return options;
}

export async function verifyAuthentication(req: Request, response: AuthenticationResponseJSON) {
  const credId = response.id;
  const row = db.select().from(passkeys).where(eq(passkeys.credentialId, credId)).get();
  if (!row) {
    const err: any = new Error("Passkey not recognised");
    err.status = 401;
    throw err;
  }
  // The challenge we issued is in clientDataJSON; we stored it keyed by challenge.
  let clientChallenge = "";
  try {
    const raw = Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8");
    clientChallenge = JSON.parse(raw).challenge;
  } catch { /* verified below */ }
  const pending = challenges.get(`auth:${clientChallenge}`);
  if (!pending || pending.kind !== "auth") {
    const err: any = new Error("Passkey sign-in expired. Try again.");
    err.status = 400;
    throw err;
  }
  const { rpID, origin } = relyingParty(req);
  const verified = await verifyAuthenticationResponse({
    response,
    expectedChallenge: pending.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: row.credentialId,
      publicKey: isoBase64URL.toBuffer(row.publicKey),
      counter: row.counter,
      transports: (row.transports ? JSON.parse(row.transports) : []) as AuthenticatorTransport[],
    },
  });
  challenges.delete(`auth:${clientChallenge}`);
  if (!verified.verified) {
    const err: any = new Error("Could not verify that passkey");
    err.status = 401;
    throw err;
  }
  db.update(passkeys).set({
    counter: verified.authenticationInfo.newCounter,
    lastUsedAt: now(),
  }).where(eq(passkeys.id, row.id)).run();

  if (row.role === "admin") {
    const a = db.select().from(admins).where(eq(admins.id, row.userId)).get();
    if (!a) {
      const err: any = new Error("Passkey not recognised");
      err.status = 401;
      throw err;
    }
    return { token: createSession("admin", a.id), role: "admin" as const, next: "/admin/console" };
  }
  const f = db.select().from(facilitators).where(eq(facilitators.id, row.userId)).get();
  if (!f || f.status !== "active") {
    const err: any = new Error("Facilitator rights withdrawn");
    err.status = 403;
    throw err;
  }
  return { token: createSession("facilitator", f.id), role: "facilitator" as const, next: "/facilitate/rooms" };
}
