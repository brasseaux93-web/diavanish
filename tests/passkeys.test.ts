import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { SoftwarePasskey } from "./helpers/software-passkey";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(tmpdir(), "aperture-passkeys-"));
process.env.APERTURE_DB = path.join(dir, "pk.db");
process.env.APERTURE_DEMO = "0";
execSync("npx drizzle-kit push --force", { env: process.env, stdio: "ignore" });

let base = "";
let server: Server;
let S: typeof import("../server/storage");
let schema: typeof import("../shared/schema");

before(async () => {
  const express = (await import("express")).default;
  S = await import("../server/storage");
  schema = await import("../shared/schema");
  const { registerRoutes } = await import("../server/routes");
  const app = express();
  app.use(express.json());
  await registerRoutes(null, app);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ message: err.message }));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.closeAllConnections();
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(token: string | null, method: string, url: string, body?: unknown) {
  const r = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json", ...(token ? { "x-aperture-session": token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

function originOf() {
  return base; // http://127.0.0.1:<port>
}
function rpIDOf() {
  return "127.0.0.1";
}

test("auth-methods advertise passkeys and email codes by default", async () => {
  const r = await call(null, "GET", "/api/public/auth-methods");
  assert.equal(r.status, 200);
  assert.equal(r.body.passkey, true);
  assert.equal(r.body.emailCode, true);
  assert.equal(r.body.oidc.enabled, false);
});

test("a signed-in administrator can register a software passkey and then sign in with it", async () => {
  const admin = S.db.insert(schema.admins).values({ email: "ops@agency.example", createdAt: Date.now() }).returning().get();
  const session = S.createSession("admin", admin.id);
  const device = new SoftwarePasskey();

  const opts = await call(session, "POST", "/api/auth/passkey/register/options");
  assert.equal(opts.status, 200, opts.body?.message);
  assert.ok(opts.body.challenge);
  assert.equal(opts.body.rp.id, rpIDOf());

  const attestation = device.register({
    challenge: opts.body.challenge,
    origin: originOf(),
    rpID: rpIDOf(),
  });
  const saved = await call(session, "POST", "/api/auth/passkey/register/verify", {
    response: attestation, nickname: "Test key",
  });
  assert.equal(saved.status, 200, saved.body?.message);
  assert.equal(saved.body.nickname, "Test key");
  assert.ok(saved.body.credentialId);

  const listed = await call(session, "GET", "/api/auth/passkeys");
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].nickname, "Test key");
  assert.equal(listed.body[0].publicKey, undefined);

  const authOpts = await call(null, "POST", "/api/auth/passkey/authenticate/options");
  assert.equal(authOpts.status, 200);
  const assertion = device.authenticate({
    challenge: authOpts.body.challenge,
    origin: originOf(),
    rpID: rpIDOf(),
  });
  const signedIn = await call(null, "POST", "/api/auth/passkey/authenticate/verify", { response: assertion });
  assert.equal(signedIn.status, 200, signedIn.body?.message);
  assert.equal(signedIn.body.role, "admin");
  assert.ok(signedIn.body.token);
  const me = await call(signedIn.body.token, "GET", "/api/auth/session");
  assert.equal(me.body.email, "ops@agency.example");
});

test("requiring passkeys blocks email-code sign-in for admins", async () => {
  S.db.update(schema.platformSettings).set({ requirePasskey: 1 }).where(eq(schema.platformSettings.id, 1)).run();
  try {
    const methods = await call(null, "GET", "/api/public/auth-methods");
    assert.equal(methods.body.emailCode, false);
    const req = await call(null, "POST", "/api/auth/request-code", { email: "ops@agency.example", role: "admin" });
    assert.equal(req.status, 403);
    const ver = await call(null, "POST", "/api/auth/verify-code", { email: "ops@agency.example", code: "000000", role: "admin" });
    assert.equal(ver.status, 403);
    assert.match(ver.body.message, /passkey/i);
  } finally {
    S.db.update(schema.platformSettings).set({ requirePasskey: 0 }).where(eq(schema.platformSettings.id, 1)).run();
  }
});

test("turning email codes off is a separate switch", async () => {
  S.db.update(schema.platformSettings).set({ emailCodeEnabled: 0, requirePasskey: 0 }).where(eq(schema.platformSettings.id, 1)).run();
  try {
    const req = await call(null, "POST", "/api/auth/request-code", { email: "someone@example.org", role: "facilitator" });
    assert.equal(req.status, 403);
    assert.match(req.body.message, /Email codes/i);
  } finally {
    S.db.update(schema.platformSettings).set({ emailCodeEnabled: 1 }).where(eq(schema.platformSettings.id, 1)).run();
  }
});

