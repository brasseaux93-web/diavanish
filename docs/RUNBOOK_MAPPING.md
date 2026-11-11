# Diavanish Master Rebuild Runbook — Repository Mapping

Version: 1.0  
Date: 2026-11-10  
Status: Phases 1–4 components delivered; Phase 5 remaining

## Summary
The Master Rebuild Runbook is directionally aligned with the existing codebase. Foundational tokens, a simplified room shell, ledger action distinction, and pre-entry disclosures have been added. Existing privacy model and ledger invariants are unchanged.

## Mapping

| Runbook requirement | Current location | Status |
|---------------------|------------------|--------|
| Private room with purpose, conversation, collapsible ledger | `components/room/simple-room-shell.tsx` + existing room pages | Shell available; incremental adoption next |
| Accept wording ≠ endorse recommendation | `components/ledger/accept-wording.tsx` | Component added |
| Pre-entry disclosures (identity, retention, AI) | `components/disclosures.tsx` | Component added |
| Charcoal / warm ivory / jade / brass | `client/src/index.css` | Updated |
| Conversation expiry under disclosed policy | Server + client | Existing; copy alignment ongoing |
| Restricted functions (legal, incident, retention admin) | Admin console | Separation still required |

## Phased plan

### Phase 1 — Foundations (complete)
Design tokens aligned. Atmospheric texture retained. Mapping documented.

### Phase 2 — Core session surface (components ready)
`simple-room-shell.tsx` provides purpose header, center conversation, collapsible ledger, quiet controls, and persistent state indicators. Existing tabbed rooms remain functional.

### Phase 3 — Ledger distinction (component ready)
`accept-wording.tsx` surfaces Accept wording, Suggest edit, and Raise concern, with explicit note that accepting wording does not mean endorsement.

### Phase 4 — Disclosures (component ready)
`disclosures.tsx` presents identity mode, conversation expiry, ledger carry-forward, and AI status before entry.

### Phase 5 — Restricted controls (remaining)
Separate legal review, identity access, incident handling, and retention administration from participant navigation. Requires admin console and permission boundary review.

No destructive schema changes or authentication rewrites have been made.

## Verification
- Components committed and inspectable via GitHub.
- Full integration and visual verification require local `npm run dev` after clone.
- Privacy invariants (ephemeral chat, hash-chained audit, no default transcript) remain unchanged.

## Next actions
1. Import and render `SimpleRoomShell`, `AcceptWordingActions`, and `PreEntryDisclosures` in the live room and join flows.
2. Complete Phase 5 restricted-control separation.
3. Run local checks (`npm run check`, `npm test`, `npm run build`) and verify the three surfaces.
