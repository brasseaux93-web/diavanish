import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { startOidcStub } from "./helpers/oidc-stub";

const dir = mkdtempSync(path.join(tmpdir(), "aperture-oidc-"));
process.env.APERTURE_DB = path.join(dir, "oidc.db");
process.env.APERTURE_DEMO = "0";
execSync("npx drizzle-kit push --force", { env: process.env, stdio: "ignore" });

let stub: Awaited<ReturnType<typeof startOidcStub>>;
let base = "";
let server: Server;
let S: typeof import("../server/storage");
let schema: typeof import("../shared/schema");

before(async () => {
  stub = await startOidcStub({ email: "sso.admin@agency.gov" });
  process.env.APERTURE_OIDC_ISSUER = stub.issuer;
  process.env.APERTURE_OIDC_CLIENT_ID = stub.clientId;
  process.env.APERTURE_OIDC_CLIENT_SECRET = stub.clientSecret;
  process.env.APERTURE_OIDC_NAME = "Test Agency";
  delete process.env.APERTURE_OIDC_ALLOWED_DOMAINS;
  delete process.env.APERTURE_OIDC_ROLE_CLAIM;
  delete process.env.APERTURE_OIDC_ADMIN_VALUES;

  const express = (await import("express")).default;
  S = await import("../server/storage");
  schema = await import("../shared/schema");
  const { resetOidcCache } = await import("../server/oidc");
  resetOidcCache();
  const { registerRoutes } = await import("../server/routes");
  const app = express();
  app.use(express.json());
  await registerRoutes(null, app);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ message: err.message }));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.closeAllConnections();
  server?.close();
  await stub?.close();
  rmSync(dir, { recursive: true, force: true });
});

function hop(res: Response) {
  return { status: res.status, location: res.headers.get("location") };
}

async function finishLogin(role: "admin" | "facilitator" = "admin") {
  const start = await fetch(`${base}/api/auth/oidc/start?role=${role}`, { redirect: "manual" });
  assert.equal(start.status, 302, await start.text());
  const idp = hop(start).location;
  assert.ok(idp && idp.startsWith(stub.issuer), idp || "no location");
  const authorized = await fetch(idp!, { redirect: "manual" });
  assert.equal(authorized.status, 302);
  const cb = hop(authorized).location;
  assert.ok(cb && cb.includes("/api/auth/oidc/callback"), cb || "no callback");
  const back = await fetch(cb!, { redirect: "manual" });
  return hop(back);
}

function ticketFrom(location: string | null) {
  assert.ok(location, "expected redirect");
  const hash = location.split("#")[1] || "";
  const q = new URLSearchParams(hash.split("?")[1] || "");
  return { ticket: q.get("ticket"), error: q.get("error"), next: q.get("next") };
}

test("auth-methods advertise the agency when OIDC is configured", async () => {
  const r = await fetch(`${base}/api/public/auth-methods`);
  const body = await r.json();
  assert.equal(body.oidc.enabled, true);
  assert.equal(body.oidc.name, "Test Agency");
});

test("start without a role is rejected", async () => {
  const r = await fetch(`${base}/api/auth/oidc/start`, { redirect: "manual" });
  assert.equal(r.status, 400);
});

test("a known administrator can sign in through the agency IdP", async () => {
  S.db.insert(schema.admins).values({ email: "sso.admin@agency.gov", createdAt: Date.now() }).run();
  stub.setUser({ email: "sso.admin@agency.gov" });
  const done = await finishLogin("admin");
  assert.equal(done.status, 302, done.location || "");
  const { ticket, error } = ticketFrom(done.location);
  assert.equal(error, null, done.location || "");
  assert.ok(ticket);
  const claim = await fetch(`${base}/api/auth/oidc/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  const body = await claim.json();
  assert.equal(claim.status, 200, body.message);
  assert.equal(body.role, "admin");
  assert.equal(body.next, "/admin/console");
  assert.ok(body.token);
  const me = await fetch(`${base}/api/auth/session`, { headers: { "x-aperture-session": body.token } });
  const session = await me.json();
  assert.equal(session.email, "sso.admin@agency.gov");
  const replay = await fetch(`${base}/api/auth/oidc/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  assert.equal(replay.status, 400);
});

test("an email that is not an administrator is refused", async () => {
  stub.setUser({ email: "stranger@agency.gov" });
  const done = await finishLogin("admin");
  const { error, ticket } = ticketFrom(done.location);
  assert.equal(error, "account");
  assert.equal(ticket, null);
});

test("allowed-domain list blocks everyone else", async () => {
  process.env.APERTURE_OIDC_ALLOWED_DOMAINS = "agency.gov";
  try {
    stub.setUser({ email: "sso.admin@outsider.org" });
    // even if we added them as an admin, the domain gate runs first
    S.db.insert(schema.admins).values({ email: "sso.admin@outsider.org", createdAt: Date.now() }).run();
    const done = await finishLogin("admin");
    assert.equal(ticketFrom(done.location).error, "domain");
  } finally {
    delete process.env.APERTURE_OIDC_ALLOWED_DOMAINS;
  }
});

test("role-claim mapping can refuse an otherwise known administrator", async () => {
  process.env.APERTURE_OIDC_ROLE_CLAIM = "groups";
  process.env.APERTURE_OIDC_ADMIN_VALUES = "aperture-admin";
  try {
    stub.setUser({ email: "sso.admin@agency.gov", claims: { groups: ["visitor"] } });
    const denied = await finishLogin("admin");
    assert.equal(ticketFrom(denied.location).error, "role");
    stub.setUser({ email: "sso.admin@agency.gov", claims: { groups: ["aperture-admin", "other"] } });
    const allowed = await finishLogin("admin");
    assert.ok(ticketFrom(allowed.location).ticket);
  } finally {
    delete process.env.APERTURE_OIDC_ROLE_CLAIM;
    delete process.env.APERTURE_OIDC_ADMIN_VALUES;
  }
});
