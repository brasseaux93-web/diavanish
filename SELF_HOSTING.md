# Self-hosting Diavanish

Diavanish runs as one container with one SQLite file. Chat never touches that file: it is end-to-end encrypted in the browser, and the server relays ciphertext from memory and drops it when a room closes or expires.

The official project site is diavanish.org. Your deployment uses whatever domain you put in front of the container — there is no required hostname.

## Quick start

```sh
cp .env.example .env        # fill in the values below
docker compose up -d --build
```

Put a TLS reverse proxy (Caddy, nginx, Traefik) in front of `127.0.0.1:5000`. Diavanish refuses to trust `X-Forwarded-For` and never logs IP addresses, so the proxy's own access log is the one to turn off or rotate quickly.

The compose file runs the container with a read-only root filesystem, a `/tmp` tmpfs, every capability dropped, and `no-new-privileges`. The SQLite file lives on the `diavanish-data` volume at `/data/aperture.db` — that volume is the only writable path besides `/tmp`.

Equivalent `docker run`:

```sh
docker build -t diavanish .
docker run --name diavanish --restart unless-stopped \
  --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -p 127.0.0.1:5000:5000 \
  -v diavanish-data:/data \
  -e APERTURE_DB=/data/aperture.db \
  -e APERTURE_SECRET="$APERTURE_SECRET" \
  -e APERTURE_ADMIN_EMAIL="$APERTURE_ADMIN_EMAIL" \
  diavanish
```

The image starts by applying versioned migrations (`node dist/migrate.cjs`) and then serves the app. A `HEALTHCHECK` probes `GET /api/public/health`.

## Without Docker

```sh
npm ci && npm run build  # use Node 24 LTS, like the Docker image and .nvmrc
APERTURE_DB=/var/lib/diavanish/diavanish.db npm run db:migrate
APERTURE_DB=/var/lib/diavanish/diavanish.db npm start
```

`npm start` also runs `db:migrate` first, so the middle line is optional if you use `npm start`. Do not run `drizzle-kit push --force` against a live database: it is not how production boots any more, and `--force` can rebuild tables.

## Environment

| Variable | Required | What it does |
|---|---|---|
| `APERTURE_SECRET` | Yes | Long random string. Peppers the hashes of one-time sign-in codes. Without it a random pepper is made at boot, so codes in flight die on restart. |
| `APERTURE_ADMIN_EMAIL` | Yes | First administrator. Added on boot if missing. Sign-in codes for this account go to this mailbox, so it must be one you can read. If it is unset on a fresh database, a built-in local administrator (`admin@diavanish.org`) is created instead, which you do not want on your own host. |
| `RESEND_API_KEY` + `APERTURE_MAIL_FROM` | One delivery method | Sends sign-in codes through Resend. `APERTURE_MAIL_FROM` must be on a domain you verified there. |
| `APERTURE_MAIL_WEBHOOK` (+ `_SECRET`) | One delivery method | POSTs `{to, subject, text}` to your own relay (for example an SMTP bridge inside your network), with `Authorization: Bearer <secret>`. |
| `APERTURE_DEV_CODES=1` | Never in production | Shows the code in the browser. For local testing only. The server refuses to start with it when `NODE_ENV=production`. |
| `APERTURE_DEMO=1` | No (default off) | Turns on the one-click demos. Off unless set to exactly `1`. See [Demo mode](#demo-mode). |
| `APERTURE_DEMO_IN_PRODUCTION=1` | No (default off) | Also required for demos when `NODE_ENV=production`. The server prints a loud warning at startup when both are set. |
| `APERTURE_DB` | No | SQLite path. Default `data.db`. |
| `PORT` | No | Default `5000`. |
| `APERTURE_HSTS=1` | No (default off) | Send `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Turn this on only when every client reaches the app over HTTPS (typically your reverse proxy already adds HSTS; set this if you want Diavanish to send it too). |
| `APERTURE_HSTS_MAX_AGE` | No | Overrides the HSTS max-age in seconds when `APERTURE_HSTS=1`. Default `31536000` (one year). |
| `APERTURE_RP_ID` | No | WebAuthn relying-party ID (usually the hostname, without a port). Defaults to the request host. |
| `APERTURE_ORIGIN` | No | Expected WebAuthn origin, e.g. `https://dialogue.example.org`. Defaults to the request origin. Set this when a reverse proxy would otherwise make the app see `http://127.0.0.1`. Also used to build the OIDC redirect URI. |
| `APERTURE_OIDC_ISSUER` | No | Agency IdP issuer URL (Login.gov, Entra, Okta, …). Required with the client id and secret to turn agency sign-in on. |
| `APERTURE_OIDC_CLIENT_ID` | No | OIDC client id. |
| `APERTURE_OIDC_CLIENT_SECRET` | No | OIDC client secret. |
| `APERTURE_OIDC_REDIRECT_URI` | No | Must match the IdP registration exactly. Defaults to `{origin}/api/auth/oidc/callback`. |
| `APERTURE_OIDC_NAME` | No | Label on the sign-in button, e.g. `Login.gov`. |
| `APERTURE_OIDC_SCOPES` | No | Default `openid email profile`. |
| `APERTURE_OIDC_ALLOWED_DOMAINS` | No | Comma-separated email domains that may sign in, e.g. `state.gov,army.mil`. |
| `APERTURE_OIDC_ROLE_CLAIM` | No | Optional ID-token or userinfo claim (e.g. `groups`) checked against the value lists below. |
| `APERTURE_OIDC_ADMIN_VALUES` | No | Comma-separated claim values that may sign in as an administrator. |
| `APERTURE_OIDC_FACILITATOR_VALUES` | No | Comma-separated claim values that may sign in as a facilitator. |



If no delivery method is set, sign-in fails closed with a 503. It never falls back to showing the code.

## Demo mode

The one-click demos (try any role on sample data) are **off by default**. With demos off, every `/api/demo/*` path returns 404, nothing demo is seeded, the browser hides every demo button (it reads `GET /api/public/config`), and any leftover demo session is refused.

- Local development: `npm run dev` sets `APERTURE_DEMO=1` for you.
- A non-production server: set `APERTURE_DEMO=1`.
- A production build (`NODE_ENV=production`, the Docker image): `APERTURE_DEMO=1` alone is ignored, with a startup note. Demos run only when `APERTURE_DEMO_IN_PRODUCTION=1` is set too, and the server prints a loud warning at every start. Use this for a public trial server that hosts no real rooms.

When demos are on, demo sessions are confined to demo data on the server, whatever the browser sends:

- Demo rooms are the ones under the reserved `demo:` series key. A room the demo facilitator creates is always a demo room. Real facilitators cannot use the `demo:` prefix.
- The demo facilitator can open only demo rooms, see only demo colleagues and hand off only to them. Real facilitators cannot open demo rooms.
- The demo administrator can read a demo-only view of the console (demo facilitators, demo-room counts and audit trail; empty applications, data requests, security events and country list) and is refused (403) on every change: settings, facilitators, applications, countries, data requests and purge. New admin routes are closed to the demo unless they opt in.
- Demo accounts (`demo.*@diavanish.org`) can never sign in with an email code.
- Demo rooms are not end-to-end encrypted: the server holds their keys so one person can try every role on one device. The interface says so.

## Browser security headers

Every response includes:

- `Content-Security-Policy` — production: `default-src 'self'`; `script-src 'self'` (no `unsafe-inline` or `unsafe-eval`; the Vite build emits one hashed module and one hashed stylesheet); `style-src 'self' 'unsafe-inline'` (React `style={…}` attributes and Radix popover/select positioning; Tailwind itself is the hashed CSS file); `img-src 'self' data:`; `font-src 'self'`; `connect-src 'self'`; `frame-ancestors 'none'`; `base-uri 'none'`; `form-action 'self'`; `object-src 'none'`. Development loosens `script-src` (`unsafe-inline` `unsafe-eval`) and `connect-src` (`ws:` `wss:`) so Vite HMR on `/vite-hmr` keeps working.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`
- `Permissions-Policy` denying camera, microphone, geolocation and similar features. `publickey-credentials-create` and `publickey-credentials-get` are allowed on `self` so a later passkey sign-in can work.
- `Strict-Transport-Security` only when `APERTURE_HSTS=1` (see above). The reverse proxy in front of the container is the usual place to set this.

The proposal brief (`/api/public/ledger/:code/brief.html`) is a standalone document and sets its own CSP (`default-src 'none'`, inline styles and a small inline `window.print` script, `data:` fonts). Unknown `/api/*` paths return `{"message":"Not found"}` with status 404, not the single-page app HTML.

## What is on disk

- Process ledger entries the room approved, outcome summaries, seals and destruction certificates.
- Accounts (administrator and facilitator emails), invites stored only as hashes, security events with timestamps rounded to the hour.
- Never: chat, drafts, IP addresses, user agents, room keys.

Back up the SQLite file like any other sensitive record. Retention windows are set in the administrator console.

### What retention removes

Closed and sealed rooms are purged once their retention window has passed. The window is counted from the seal, or from creation for a room that was never sealed. The administrator setting **"Sealed ledgers outlive retention"** (on by default) decides what happens to sealed rooms:

- **On:** the room is reduced to its sealed ledger. The room row keeps its code, title and seal (fingerprint, seal time, audit chain head, destruction certificate) plus the sealed ledger itself. Verify, the proposal brief and the JSON export keep working. For v2 that ledger is the canonical document the fingerprint covers. For v1 rooms the approved rows are frozen into the room row first, byte for byte the rows the v1 fingerprint covers. Everything else for the room is deleted on schedule: seats and sessions, invites, every entry and version (drafts included), consents, agenda, notes, outcome summaries, follow-through, and the free-text purpose and schedule. The room is marked `purged_at`, so later runs leave it alone.
- **Off:** sealed rooms are wiped entirely, like closed ones, and their ledgers stop verifying.

Closed rooms that were never sealed are always wiped. Each purge returns, and writes to the security log, how many rooms were wiped, how many sealed ledgers were kept, and whether the setting was on.

Migration `migrations/0002_purged_at.sql` adds the `rooms.purged_at` column. `npm run db:push` applies it.

## Updating

```sh
git pull && docker compose up -d --build
```

The container applies schema changes at start. Take a copy of the volume first.

## Verifying what your server sends

Each build writes `dist/public/build-manifest.json`, served at `/build-manifest.json`. It lists a SHA-256 hash for every file the browser receives, and one root hash over all of them. Builds are reproducible, so the same commit and Node major version give the same hashes.

To check a running server against a release:

```bash
git checkout v1.2.3      # the release you reviewed
npm ci && npm run build  # use Node 20, like the Docker image
npm run verify -- https://your-host.example.org
```

`verify` doesn't trust the server's manifest. It downloads every file itself and compares it with your build, then exits non-zero on any difference. Tagged releases also attach `build-manifest.json` and `SHA256SUMS`, so reviewers can compare root hashes without building.


## Passkeys

Administrators and facilitators can register a WebAuthn passkey after signing in with an email code, then sign in with that passkey instead. Passkeys are phishing-resistant (the browser talks only to this origin) and satisfy the authenticator NIST requires for privileged access, where an emailed code does not.

In the administrator console, **Settings → Sign-in** can:

- **Require a passkey** for administrators and facilitators. Email codes then return 403 for those roles. Add your own passkey *before* turning this on, or you will lock yourself out.
- **Allow email one-time codes** — turn this off to disable the fallback even when passkeys are not required.

`GET /api/public/auth-methods` tells the sign-in pages which choices to show (`passkey`, `emailCode`, `oidc`).


## Agency sign-in (OIDC)

PIV and CAC smart cards reach Diavanish through the agency's identity provider, not through a card reader in this app. Register a confidential OIDC client at Login.gov, Entra ID, Okta, or the agency IdP, with redirect URI `https://your.hostname/api/auth/oidc/callback`. Then set `APERTURE_OIDC_ISSUER`, `APERTURE_OIDC_CLIENT_ID`, `APERTURE_OIDC_CLIENT_SECRET`, and usually `APERTURE_OIDC_NAME`.

The sign-in page then offers **Sign in with your agency**. After the IdP redirects back, the browser lands on a short completion page that exchanges a one-time ticket for a Diavanish session (the session token is never placed in the address bar as a lasting query string).

Rules, all of them server-side:

1. The IdP must supply a verified email (a claimed `email_verified: false` is refused).
2. If `APERTURE_OIDC_ALLOWED_DOMAINS` is set, the email's domain must be on that list.
3. If `APERTURE_OIDC_ROLE_CLAIM` and the matching value list are set, the claim must contain one of those values.
4. The email must already belong to an administrator or an active facilitator — this server does not open privileged accounts from SSO alone.

Requiring a passkey still only blocks email codes; agency SSO remains available, because the agency IdP is how PIV/CAC (phishing-resistant) sign-in arrives.

### SAML

SAML is not implemented. An agency that only speaks SAML should put an OIDC-to-SAML bridge (Login.gov, Entra, or a dedicated broker) in front of Diavanish.
