import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import * as jose from "jose";

export type StubUser = {
  email: string;
  email_verified?: boolean;
  claims?: Record<string, unknown>;
};

export async function startOidcStub(initial: StubUser) {
  const { publicKey, privateKey } = await jose.generateKeyPair("RS256", { extractable: true });
  const kid = "stub-1";
  const jwk = await jose.exportJWK(publicKey);
  jwk.kid = kid;
  jwk.use = "sig";
  jwk.alg = "RS256";

  const clientId = "aperture-test";
  const clientSecret = "test-secret";
  let user: Record<string, unknown> = flatten(initial);
  const codes = new Map<string, { nonce?: string; challenge: string }>();
  const access = new Map<string, Record<string, unknown>>();
  let issuer = "";

  function flatten(u: StubUser): Record<string, unknown> {
    return {
      email: u.email,
      email_verified: u.email_verified !== false,
      ...(u.claims || {}),
    };
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const json = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
      });
    }
    if (url.pathname === "/jwks") {
      return json(200, { keys: [jwk] });
    }
    if (url.pathname === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri") || "";
      const state = url.searchParams.get("state") || "";
      const nonce = url.searchParams.get("nonce") || undefined;
      const challenge = url.searchParams.get("code_challenge") || "";
      const code = randomBytes(16).toString("hex");
      codes.set(code, { nonce, challenge });
      const loc = new URL(redirectUri);
      loc.searchParams.set("code", code);
      loc.searchParams.set("state", state);
      res.statusCode = 302;
      res.setHeader("location", loc.toString());
      res.end();
      return;
    }
    if (url.pathname === "/token" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      let id = params.get("client_id");
      let secret = params.get("client_secret");
      const hdr = req.headers.authorization;
      if (hdr?.startsWith("Basic ")) {
        const decoded = Buffer.from(hdr.slice(6), "base64").toString("utf8");
        const i = decoded.indexOf(":");
        id = decoded.slice(0, i);
        secret = decoded.slice(i + 1);
      }
      if (id !== clientId || secret !== clientSecret) return json(401, { error: "invalid_client" });
      const rec = codes.get(params.get("code") || "");
      if (!rec) return json(400, { error: "invalid_grant" });
      codes.delete(params.get("code") || "");
      const verifier = params.get("code_verifier") || "";
      const expected = createHash("sha256").update(verifier).digest("base64url");
      if (rec.challenge && expected !== rec.challenge) return json(400, { error: "invalid_grant" });
      const at = randomBytes(16).toString("hex");
      access.set(at, user);
      const now = Math.floor(Date.now() / 1000);
      const payload: Record<string, unknown> = {
        email: user.email,
        email_verified: user.email_verified,
      };
      for (const [k, v] of Object.entries(user)) {
        if (k !== "email" && k !== "email_verified") payload[k] = v;
      }
      if (rec.nonce) payload.nonce = rec.nonce;
      const idToken = await new jose.SignJWT(payload)
        .setProtectedHeader({ alg: "RS256", kid })
        .setIssuer(issuer)
        .setAudience(clientId)
        .setSubject(String(user.email))
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey);
      return json(200, {
        access_token: at,
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken,
      });
    }
    if (url.pathname === "/userinfo") {
      const tok = String(req.headers.authorization || "").replace(/^Bearer /i, "");
      const u = access.get(tok);
      if (!u) { res.statusCode = 401; res.end(); return; }
      return json(200, { sub: u.email, ...u });
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  issuer = `http://127.0.0.1:${port}`;
  return {
    issuer,
    clientId,
    clientSecret,
    setUser(u: StubUser) { user = flatten(u); },
    async close() {
      await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
    },
  };
}
