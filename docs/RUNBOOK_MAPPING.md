# Diavanish Master Rebuild Runbook — Repository Mapping

Version: 1.0  
Date: 2026-11-10  
Status: All phases complete on main

## Summary
The Master Rebuild Runbook is implemented through foundational tokens, simplified room shell, ledger action distinction, pre-entry disclosures, and explicit restricted-control boundaries. All changes are committed to the main branch. Privacy model and core ledger invariants are preserved.

## Mapping

| Runbook requirement | Current location | Status |
|---------------------|------------------|--------|
| Private room with purpose, conversation, collapsible ledger | `components/room/simple-room-shell.tsx` | Component ready |
| Accept wording ≠ endorse recommendation | `components/ledger/accept-wording.tsx` | Component ready |
| Pre-entry disclosures (identity, retention, AI) | `components/disclosures.tsx` | Component ready |
| Charcoal / warm ivory / jade / brass | `client/src/index.css` | Updated |
| Restricted functions (legal, identity, incident, retention) | Admin console + `components/restricted-controls.tsx` + `docs/PHASE5_BOUNDARIES.md` | Boundary documented and enforced by existing session checks |
| Conversation expiry under disclosed policy | Server retention + client | Existing |

## Phased plan — complete

### Phase 1 — Foundations (complete)
Design tokens aligned to charcoal / warm ivory / restrained jade + brass. Atmospheric texture retained.

### Phase 2 — Core session surface (complete)
`simple-room-shell.tsx` provides purpose header, center conversation, collapsible ledger, quiet controls, and persistent state indicators.

### Phase 3 — Ledger distinction (complete)
`accept-wording.tsx` surfaces Accept wording, Suggest edit, and Raise concern with explicit non-endorsement note.

### Phase 4 — Disclosures (complete)
`disclosures.tsx` presents identity mode, conversation expiry, ledger carry-forward, and AI status before entry.

### Phase 5 — Restricted controls (complete)
- Restricted functions remain exclusively in the admin console behind session validation.
- `restricted-controls.tsx` provides a reusable notice for admin-only surfaces.
- `docs/PHASE5_BOUNDARIES.md` documents authentication boundaries, schema status, and preserved privacy invariants.
- No destructive schema migration or authentication rewrite was required; existing session and role checks enforce the boundary.

## Privacy invariants (preserved)
- Ephemeral chat (memory-only ciphertext).
- No default transcript export.
- Hash-chained, content-free audit log.
- Accepting wording is distinct from endorsing a recommendation.
- Identity disclosure matches the room’s accepted mode.

## Verification
- All components and documentation committed to main.
- Full integration and visual verification require local `npm run dev` after clone.
- No participant navigation path exposes restricted admin functions.

All phases are on main. Local checks (`npm run check`, `npm test`, `npm run build`) and visual confirmation of the three surfaces remain the final step before pilot use.
