/*
 * Agency sign-in via OpenID Connect. PIV/CAC cards arrive through the
 * agency IdP (Login.gov, Entra, Okta); this app never talks to the card.
 * SAML is not implemented — put an OIDC bridge in front if that is all
 * the agency speaks.
 */
import * as client from "openid-client";
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { admins, facilitators } from "@shared/schema";
import { db, createSession } from "./storage";

type Pending = {
  role: "admin" | "facilitator";
  verifier: string;
  nonce: string;
  redirectUri: string;
  expires: number;
};
type Ticket = { token: string; role: "admin" | "facilitator"; next: string; expires: number };

const pending = new Map<string, Pending>();
const tickets = new Map<string, Ticket>();

function gc() {
  const t = Date.now();
  for (const [k, v] of Array.from(pending.entries())) if (v.expires < t) pending.delete(k);
  for (const [k, v] of Array.from(tickets.entries())) if (v.expires < t) tickets.delete(k);
}

function oidcVal(name: string): string | undefined {
  return process.env["DIAVANISH_OIDC_" + name] || process.env["APERTURE_OIDC_" + name];
}

export function oidcStatus() {
  const enabled = !!(
    oidcVal("ISSUER") &&
    oidcVal("CLIENT_ID") &&
    oidcVal("CLIENT_SECRET")
  );
  return { enabled, name: enabled ? (oidcVal("NAME") || null) : null };
}

function originOf(req: Request) {
  const origin = process.env.DIAVANISH_ORIGIN || process.env.APERTURE_ORIGIN;
  if (origin) return origin.replace(/\/$/, "");
  const host = String(req.get("x-forwarded-host") || req.get("host") || "localhost");
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0].trim();
  return `${proto}://${host}`;
}

function redirectUriOf(req: Request) {
  return oidcVal("REDIRECT_URI") || `${originOf(req)}/api/auth/oidc/callback`;
}

function csv(name: string) {
  const raw = process.env["DIAVANISH_" + name] || process.env["APERTURE_" + name] || process.env[name] || "";
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function claimList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).toLowerCase());
  return String(value).split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

let cached: { key: string; config: client.Configuration } | null = null;

async function configuration(): Promise<client.Configuration> {
  const issuer = oidcVal("ISSUER");
  const clientId = oidcVal("CLIENT_ID");
  const secret = oidcVal("CLIENT_SECRET");
  if (!issuer || !clientId || !secret) {
    const err: any = new Error("Agency sign-in is not configured on this server");
    err.status = 404;
    throw err;
  }
  const key = `${issuer}\n${clientId}`;
  if (cached?.key === key) return cached.config;
  const opts = issuer.startsWith("http://") ? { execute: [client.allowInsecureRequests] } : undefined;
  const config = await client.discovery(new URL(issuer), clientId, secret, undefined, opts);
  cached = { key, config };
  return config;
}

/** Reset cached discovery — used by tests when the stub issuer changes. */
export function resetOidcCache() {
  cached = null;
}

function failRedirect(req: Request, res: Response, code: string, role?: "admin" | "facilitator") {
  const resolved = role || (pending.get(String(req.query.state || ""))?.role) || "admin";
  const next = resolved === "facilitator" ? "/facilitate" : "/admin";
  res.redirect(302, `${originOf(req)}/#/auth/complete?error=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`);
}

export async function oidcStart(req: Request, res: Response) {
  const role = String(req.query.role || "");
  if (role !== "admin" && role !== "facilitator") {
    return res.status(400).json({ message: "role must be admin or facilitator" });
  }
  if (!oidcStatus().enabled) {
    return res.status(404).json({ message: "Agency sign-in is not configured on this server" });
  }
  const config = await configuration();
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState();
  const nonce = client.randomNonce();
  const redirectUri = redirectUriOf(req);
  gc();
  pending.set(state, { role, verifier, nonce, redirectUri, expires: Date.now() + 10 * 60_000 });
  const scope = oidcVal("SCOPES") || "openid email profile";
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });
  res.redirect(302, url.href);
}

export async function oidcCallback(req: Request, res: Response) {
  const state = String(req.query.state || "");
  const rec = pending.get(state);
  if (!rec) return failRedirect(req, res, "expired");
  pending.delete(state);
  try {
    const config = await configuration();
    const currentUrl = new URL(`${originOf(req)}${req.originalUrl}`);
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: rec.verifier,
      expectedState: state,
      expectedNonce: rec.nonce,
    });
    const claims = { ...(tokens.claims() ?? {}) } as Record<string, unknown>;
    if (tokens.access_token && claims.sub) {
      try {
        const info = await client.fetchUserInfo(config, tokens.access_token, String(claims.sub));
        Object.assign(claims, info);
      } catch {
        /* ID token is enough when it already carries the email */
      }
    }
    const email = String(claims.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return failRedirect(req, res, "email", rec.role);
    if (claims.email_verified === false) return failRedirect(req, res, "unverified", rec.role);

    const domains = csv("APERTURE_OIDC_ALLOWED_DOMAINS");
    if (domains.length) {
      const domain = email.split("@")[1] || "";
      if (!domains.includes(domain)) return failRedirect(req, res, "domain", rec.role);
    }

    const roleClaim = oidcVal("ROLE_CLAIM")?.trim();
    if (roleClaim) {
      const have = claimList(claims[roleClaim]);
      const want = rec.role === "admin" ? csv("APERTURE_OIDC_ADMIN_VALUES") : csv("APERTURE_OIDC_FACILITATOR_VALUES");
      if (want.length && !want.some((v) => have.includes(v))) return failRedirect(req, res, "role", rec.role);
    }

    let token: string;
    if (rec.role === "admin") {
      const admin = db.select().from(admins).where(eq(admins.email, email)).get();
      if (!admin) return failRedirect(req, res, "account", rec.role);
      token = createSession("admin", admin.id);
    } else {
      const fac = db.select().from(facilitators).where(eq(facilitators.email, email)).get();
      if (!fac || fac.status !== "active") return failRedirect(req, res, "account", rec.role);
      token = createSession("facilitator", fac.id);
    }
    const ticket = randomBytes(24).toString("hex");
    const next = rec.role === "admin" ? "/admin/console" : "/facilitate/rooms";
    tickets.set(ticket, { token, role: rec.role, next, expires: Date.now() + 60_000 });
    res.redirect(302, `${originOf(req)}/#/auth/complete?ticket=${encodeURIComponent(ticket)}&next=${encodeURIComponent(next)}`);
  } catch (e: any) {
    console.error("OIDC callback failed:", e?.message || e);
    return failRedirect(req, res, "failed", rec.role);
  }
}

export function oidcClaim(ticket: string) {
  gc();
  const rec = tickets.get(ticket);
  if (!rec) {
    const err: any = new Error("That sign-in link has expired. Try again.");
    err.status = 400;
    throw err;
  }
  tickets.delete(ticket);
  return { token: rec.token, role: rec.role, next: rec.next };
}
