# Phase 5 — Restricted Controls, Authentication, and Privacy Boundaries

Status: Implemented via existing admin console + explicit boundary documentation.  
Date: 2026-11-10

## Restricted functions
The following remain available only through the admin console (`/admin/console`) after session validation:

- Legal / compliance review (data requests, blocked countries)
- Identity and facilitator access management
- Incident and security event review
- Retention administration and purge

These paths are not present in participant or standard facilitator navigation. Session checks redirect unauthenticated users away from the console.

## Authentication
- Administrators and facilitators: email code + optional passkey (WebAuthn).
- Participants: invite token + recovery key; no long-lived identity credential required for the room.
- Session tokens are scoped by role. No change to the authentication flow was required for Phase 5; boundaries are enforced by existing route and session checks.

## Schema
No destructive migration was added. The existing schema already supports:
- Separate retention fields (`closedRoomRetentionDays`, `guestSessionRetentionDays`, `purgedAt`)
- Audit log (content-free, hash-chained)
- Sealed ledger persistence independent of conversation retention
- Role and seat status tracking

A future migration can add explicit incident or legal-review tables if operational needs require them. None is required for the current boundary.

## Privacy invariants (preserved)
- Ephemeral chat: memory-only ciphertext relay; expires under disclosed policy.
- No default transcript export.
- Hash-chained audit contains process events only.
- Accepting wording ≠ endorsing a recommendation.
- Identity disclosure matches the room’s accepted mode.

## Verification
- Admin console remains behind session check.
- New boundary component (`restricted-controls.tsx`) available for notices.
- No changes to participant room, join, or ledger approval paths that would expose restricted functions.
