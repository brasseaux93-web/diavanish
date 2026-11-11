# Production readiness

Diavanish can run as a single-container self-hosted service.

## Required before start

1. **Secret** — Replace the default `DIAVANISH_SECRET` with the output of `openssl rand -base64 48`. The server exits if this is missing or still set to `change-me-to-64-random-characters`.
2. **Administrator** — `DIAVANISH_ADMIN_EMAIL=admin@diavanish.org` (the real production administrator address). This becomes the first administrator on first boot.
3. **Email delivery** — either:
   - `RESEND_API_KEY` + `DIAVANISH_MAIL_FROM=Diavanish <no-reply@diavanish.org>`, or
   - `DIAVANISH_MAIL_WEBHOOK` (and optional `DIAVANISH_MAIL_WEBHOOK_SECRET`).

   Without mail, sign-in fails closed. Dev codes (`DIAVANISH_DEV_CODES=1`) are refused in production.
4. **Database** — `DIAVANISH_DB` points to a persistent path. In Docker this is `/data/diavanish.db` (volume-mounted). Back up this file before upgrades.
5. **Origin** — `DIAVANISH_ORIGIN=https://diavanish.org`. Enable `DIAVANISH_HSTS=1` only after HTTPS is confirmed working.

All other values in `.env.example` are the real production configuration. Copy the file to `.env` and change only the secret.

## Startup behaviour

- `NODE_ENV=production` triggers the guard in `server/production-guard.ts`.
- Migrations run automatically (`node dist/migrate.cjs`) before the server starts.
- Health check: `GET /api/public/health` (used by the Docker HEALTHCHECK).
- Unknown `/api/*` returns JSON 404; the SPA never receives API paths.

## Known production limits

These are by design for the current architecture and are not blockers for a single-instance deployment:

- Sessions, live chat ciphertext, and room key wraps are held in process memory. A restart clears them. Multiple instances cannot share them.
- SQLite is the only persistence. Do not run more than one process against the same file.
- No independent security audit has been published. See `AUDIT_SCOPE.md` and `THREAT_MODEL.md`.
- No audio or video path exists.

## Recommended deployment

```bash
# Build and run with Docker (recommended)
docker compose up -d

# Or on a host
export NODE_ENV=production
export DIAVANISH_SECRET="$(openssl rand -base64 48)"
export DIAVANISH_ADMIN_EMAIL=admin@diavanish.org
export RESEND_API_KEY=re_...
export DIAVANISH_MAIL_FROM="Diavanish <no-reply@diavanish.org>"
export DIAVANISH_ORIGIN=https://diavanish.org
npm run build
npm start
```

After first boot, sign in as admin@diavanish.org and review facilitator applications under `/admin/console`.

## Checklist

- [ ] Strong secret set (not the default string) and not committed
- [ ] Admin email set to admin@diavanish.org
- [ ] Mail delivery tested (request a code and receive it at admin@diavanish.org)
- [ ] Database volume persisted and backed up
- [ ] HTTPS terminator in front of the container
- [ ] `DIAVANISH_ORIGIN` set to https://diavanish.org
- [ ] HSTS enabled only after HTTPS is stable
- [ ] Demos left off (or explicitly enabled with `DIAVANISH_DEMO_IN_PRODUCTION=1` if intended)
- [ ] Threat model and retention limits reviewed by the operator
