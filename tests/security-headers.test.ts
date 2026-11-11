import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  PRODUCTION_CSP, DEVELOPMENT_CSP, BRIEF_CSP, PERMISSIONS_POLICY,
  securityHeaderMap, securityHeaders, apiNotFound, hstsValue,
} from "../server/security-headers";

test("production CSP is strict: self scripts, no unsafe-eval, no framing", () => {
  assert.match(PRODUCTION_CSP, /default-src 'self'/);
  assert.match(PRODUCTION_CSP, /script-src 'self'/);
  assert.doesNotMatch(PRODUCTION_CSP, /unsafe-eval/);
  assert.doesNotMatch(PRODUCTION_CSP, /script-src[^;]*unsafe-inline/);
  assert.match(PRODUCTION_CSP, /style-src 'self' 'unsafe-inline'/);
  assert.match(PRODUCTION_CSP, /img-src 'self' data:/);
  assert.match(PRODUCTION_CSP, /font-src 'self'/);
  assert.match(PRODUCTION_CSP, /connect-src 'self'/);
  assert.doesNotMatch(PRODUCTION_CSP, /connect-src[^;]*https:/);
  assert.match(PRODUCTION_CSP, /frame-ancestors 'none'/);
  assert.match(PRODUCTION_CSP, /base-uri 'none'/);
  assert.match(PRODUCTION_CSP, /form-action 'self'/);
  assert.match(PRODUCTION_CSP, /object-src 'none'/);
});

test("development CSP keeps Vite HMR working", () => {
  assert.match(DEVELOPMENT_CSP, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
  assert.match(DEVELOPMENT_CSP, /connect-src 'self' ws: wss:/);
});

test("brief CSP stays a standalone document and still allows its print script", () => {
  assert.match(BRIEF_CSP, /default-src 'none'/);
  assert.match(BRIEF_CSP, /script-src 'unsafe-inline'/);
  assert.match(BRIEF_CSP, /style-src 'unsafe-inline'/);
  assert.match(BRIEF_CSP, /font-src data:/);
  assert.match(BRIEF_CSP, /frame-ancestors 'none'/);
  assert.match(BRIEF_CSP, /object-src 'none'/);
});

test("HSTS is off unless APERTURE_HSTS=1, and max-age is configurable", () => {
  assert.equal(hstsValue({}), null);
  assert.equal(hstsValue({ APERTURE_HSTS: "0" }), null);
  assert.equal(hstsValue({ APERTURE_HSTS: "1" }), "max-age=31536000; includeSubDomains");
  assert.equal(hstsValue({ APERTURE_HSTS: "1", APERTURE_HSTS_MAX_AGE: "3600" }), "max-age=3600; includeSubDomains");
  assert.equal("Strict-Transport-Security" in securityHeaderMap({ NODE_ENV: "production" }), false);
  assert.equal(
    securityHeaderMap({ NODE_ENV: "production", APERTURE_HSTS: "1" })["Strict-Transport-Security"],
    "max-age=31536000; includeSubDomains",
  );
});

test("the header map carries every required browser policy", () => {
  const h = securityHeaderMap({ NODE_ENV: "production" });
  assert.equal(h["Content-Security-Policy"], PRODUCTION_CSP);
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.equal(h["Referrer-Policy"], "no-referrer");
  assert.equal(h["X-Frame-Options"], "DENY");
  assert.equal(h["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(h["Cross-Origin-Resource-Policy"], "same-origin");
  assert.equal(h["Permissions-Policy"], PERMISSIONS_POLICY);
  assert.match(h["Permissions-Policy"], /camera=\(\)/);
  assert.match(h["Permissions-Policy"], /microphone=\(\)/);
  assert.match(h["Permissions-Policy"], /geolocation=\(\)/);
  // Passkeys (a later change) need these on the same origin; denying them would break WebAuthn.
  assert.match(h["Permissions-Policy"], /publickey-credentials-get=\(self\)/);
});

async function listen(app: express.Express): Promise<{ base: string; server: Server }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server };
}

test("production middleware sets the headers, and unknown /api/* is a JSON 404 not HTML", async () => {
  const app = express();
  app.use(securityHeaders({ NODE_ENV: "production" }));
  app.get("/ok", (_req, res) => res.send("ok"));
  app.use("/api", apiNotFound);
  app.use((_req, res) => res.type("html").status(200).send("<!doctype html><title>spa</title>"));
  const { base, server } = await listen(app);
  try {
    const page = await fetch(`${base}/ok`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("content-security-policy"), PRODUCTION_CSP);
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.equal(page.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(page.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(page.headers.get("permissions-policy"), PERMISSIONS_POLICY);
    assert.equal(page.headers.get("strict-transport-security"), null);

    const missing = await fetch(`${base}/api/definitely-not-a-route`);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await missing.json(), { message: "Not found" });
    assert.equal(missing.headers.get("content-security-policy"), PRODUCTION_CSP);

    const spa = await fetch(`${base}/anything-else`);
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /spa/);

    const brief = express();
    brief.use(securityHeaders({ NODE_ENV: "production" }));
    brief.get("/brief", (_req, res) => {
      res.setHeader("Content-Security-Policy", BRIEF_CSP);
      res.send("<html></html>");
    });
    const b = await listen(brief);
    try {
      const r = await fetch(`${b.base}/brief`);
      assert.equal(r.headers.get("content-security-policy"), BRIEF_CSP);
      assert.notEqual(r.headers.get("content-security-policy"), PRODUCTION_CSP);
    } finally {
      b.server.closeAllConnections();
      await new Promise<void>((resolve) => b.server.close(() => resolve()));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("development middleware sends the looser HMR CSP", async () => {
  const app = express();
  app.use(securityHeaders({ NODE_ENV: "development" }));
  app.get("/", (_req, res) => res.send("ok"));
  const { base, server } = await listen(app);
  try {
    const r = await fetch(base + "/");
    assert.equal(r.headers.get("content-security-policy"), DEVELOPMENT_CSP);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
