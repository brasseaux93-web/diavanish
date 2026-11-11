# Diavanish

Privacy-first facilitated dialogue. Facilitators run structured sessions and record agreed outcomes; participant chat is ephemeral and is not kept as a transcript.

The product name is **Diavanish**. The project site is [diavanish.org](https://diavanish.org). Self-hosted instances use their own domains.

## What it does

- **Facilitated dialogue rooms:** Create and schedule rooms, set agendas, manage participant invitations and admission, and guide sessions through timed speaking turns and stages.
- **Participant privacy controls:** Choose anonymous or open-name participation, use pseudonyms and recovery keys, and optionally require role proof.
- **Outcome review:** Draft, revise, approve, and release structured entries; track follow-up commitments; and create summaries participants can verify and download.
- **Audit and retention:** Keep a hash-chained, content-free audit log, seal approved outcome ledgers with fingerprints, and purge expired room and guest-session data.
- **Administration:** Review facilitator applications, manage facilitator access and platform settings, and view security events and aggregate counts.

> **Privacy model:** Chat is end-to-end encrypted in the browser and relayed by the server as ciphertext from memory only. Sign-in codes are sent by email. Roles are signed on the facilitator's device and checked in each participant's browser. No independent audit has been published yet. Read [THREAT_MODEL.md](THREAT_MODEL.md) before using Diavanish with real people.

## Documents

- [SELF_HOSTING.md](SELF_HOSTING.md): Docker, environment variables, what is on disk
- [SECURITY.md](SECURITY.md): reporting vulnerabilities, current protections
- [THREAT_MODEL.md](THREAT_MODEL.md): who is protected from whom, and known limits
- [AUDIT_SCOPE.md](AUDIT_SCOPE.md): brief for an independent auditor
- [GRANTS_AND_PILOTS.md](GRANTS_AND_PILOTS.md): funders, pilot partners, sequence
- [PILOT_PLAYBOOK.md](PILOT_PLAYBOOK.md): running a first pilot with mediators
- [FLOWS.md](FLOWS.md): main flows and checks

Licensed under [AGPL-3.0](LICENSE).

## Stack

- **Language:** TypeScript (with CSS)
- **Client:** React 18, Vite, Wouter, TanStack Query, Tailwind CSS, and Radix UI/shadcn-style components
- **Server:** Node.js, Express 5, and TypeScript
- **Persistence:** SQLite via `better-sqlite3` and Drizzle ORM; schemas are defined in `shared/schema.ts`
- **Validation and UI utilities:** Zod, React Hook Form, and Lucide React

## Project layout

```text
client/
  index.html              HTML entry point
  src/
    App.tsx               Hash-based routes and app providers
    pages/                Admin, facilitator, participant, and verification screens
    components/           Shared and UI components
    hooks/                Reusable React hooks
    lib/                  Query client, translations, and utilities
    index.css             Global styles and Tailwind layers
server/
  index.ts                Express startup, middleware, and dev/production setup
  routes.ts               API routes for admin, facilitators, participants, and public verification
  storage.ts              SQLite access, sessions, audit, retention, and ledger helpers
  vite.ts                 Vite middleware for development
  static.ts               Built-client static serving in production
shared/
  schema.ts               Drizzle SQLite schema and shared inferred types
script/
  build.ts                Builds the client and bundled server
 drizzle.config.ts        Drizzle Kit configuration (SQLite database: ./data.db)
 vite.config.ts           Vite client build and path aliases
 package.json             Scripts and dependencies
```

## Requirements

- Node.js 22 or newer (24 LTS is what the Docker image and CI use)
- npm

## Run locally

Requires Node.js 22 or newer. The Docker image, `.nvmrc` and the reproducible CI job use Node 24 LTS.

```bash
npm install
npm run db:push
npm run dev
```

`npm run dev` sets `APERTURE_DEMO=1`, so the one-click demos for every role are available locally. Anywhere else demos are **off** unless you set `APERTURE_DEMO=1`, and in production (`NODE_ENV=production`, which includes `npm start` and the Docker image) they also need `APERTURE_DEMO_IN_PRODUCTION=1`; see [SELF_HOSTING.md](SELF_HOSTING.md#demo-mode).

Open the URL printed by the server (the default port is `5000`). The app reads `PORT` if set; otherwise it listens on `0.0.0.0:5000`. Development mode runs the Express API and Vite client together. SQLite data is stored in `data.db` in the project root.

The database schema must be created with `npm run db:push` before starting the server for the first time. The server seeds initial platform settings on first boot. When `APERTURE_ADMIN_EMAIL` is set, that address becomes the first administrator; when it is not set (local development), a built-in administrator record (`admin@diavanish.org`) is seeded instead. Always set `APERTURE_ADMIN_EMAIL` on a real deployment.

## Build and check

```bash
npm run check
npm test
npm run build
npm start
```

`npm start` applies versioned migrations in `migrations/` (`dist/migrate.cjs`) and then serves the production build. Local development can still use `npm run db:push`; production and Docker use `npm run db:migrate` (idempotent, safe on databases previously created with `db:push`).

`npm run build` writes the production client and server bundle under `dist/`; `npm start` serves the production build. `npm run test:prod` runs a few checks against that bundle (for example that `/api/demo/*` is a 404 in production by default). For screenshots against a production build, start it with `APERTURE_DEMO=1 APERTURE_DEMO_IN_PRODUCTION=1` on a throwaway database. Set `PORT` as needed in the deployment environment. Sign-in also needs mail delivery configured; see [SELF_HOSTING.md](SELF_HOSTING.md).

## Database

Drizzle Kit is configured in `drizzle.config.ts` to use `shared/schema.ts` and the local SQLite database `./data.db`.

```bash
npm run db:push
```

This applies the current schema to the local database (convenient while developing). Production and the Docker image run `npm run db:migrate` instead, which applies `migrations/0000_baseline.sql`, `0001_ledger_v2.sql` and `0002_purged_at.sql` in order and is safe to repeat. A database that was created with `db:push` is detected, journaled, and left intact. Back up `data.db` before performing database or deployment changes. See [docs/ledger-v2.md](docs/ledger-v2.md#migrations).

## Ledger v2

Rooms keep a structured record per agenda item (problem, positions, evidence, options, agreements, conditions, open questions). Every item needs each seat's consent with a support level, under the room's sealing threshold. The seal covers the record, the locked outcome and the follow-through, and a print-ready proposal brief is typeset from the sealed record only. Rooms are created at one of three tiers (bilateral, working council, plenary) with server-enforced seat caps. See [docs/ledger-v2.md](docs/ledger-v2.md). Enclaves are a design note only: [docs/design/enclaves.md](docs/design/enclaves.md).

## Routes at a glance

The client uses hash-based routes, including `#/` for the landing page, `#/admin` for administrator sign-in, `#/facilitate` for the facilitator portal, `#/join` for joining a room, `#/p` for the participant room, and `#/verify` for public verification. The server exposes the corresponding `/api` endpoints; public sealed-ledger and non-retention checks are available under `/api/public/`.

## Current limitations

- Sessions, live chat ciphertext and room key wraps are kept in process memory, so they do not survive a server restart and are not shared across multiple server instances.
- Sign-in codes need Resend or a mail webhook. With neither configured, sign-in fails closed. `APERTURE_DEV_CODES=1` shows codes in the browser for local testing, and the server refuses to start with it in production.
- Role proof is an ECDSA signature made on the facilitator's device and checked in each participant's browser. It proves the facilitator assigned the role, not the participant's real-world identity.
- Chat lines are signed by their sender and checked against a certificate from the facilitator's device; lines that fail show as "Unverified sender". The facilitator's device can still certify anything. Room keys rotate every 30 minutes while the facilitator's tab is open. See [THREAT_MODEL.md](THREAT_MODEL.md).
- No audio, video, or speech-to-text path is implemented.

Assess these limitations and harden the deployment before treating this build as a production service.
