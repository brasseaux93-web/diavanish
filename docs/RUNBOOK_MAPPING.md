# Diavanish Master Rebuild Runbook — Repository Mapping

Version: 1.0  
Date: 2026-11-10  
Status: Phase 2 started

## Summary
The Master Rebuild Runbook (private room, temporary conversation, participant-approved ledger, proposal from approved material) is directionally aligned with the existing codebase. The current implementation is more structured (agenda-item ledger with consent levels, multi-tab facilitator room, tiered rooms) than the simplified three-surface model. Foundational visual and layout changes can proceed without breaking privacy or ledger invariants.

## Mapping

| Runbook requirement | Current location | Gap / action |
|---------------------|------------------|--------------|
| Private room with purpose, conversation, collapsible ledger | `pages/participant-room.tsx`, `pages/facilitator-room.tsx`, `components/room/room-chrome.tsx` | Layout is tab-driven and denser than left-rail / center / right-ledger. Simplified shell added. |
| Accept wording ≠ endorse recommendation | Ledger consent model in `components/ledger/record.tsx` and server | Consent levels exist; surface the distinction more clearly in UI. |
| Guided rounds (Frame → Reflect → Share → Clarify → Explore → Review) | Facilitator floor/board components | Partial stage support; not the exact sequence. |
| Pre-entry disclosures (identity, retention, AI) | `pages/join.tsx` | Present but not exhaustive. Expand. |
| Charcoal base, warm ivory, jade/brass accents | `client/src/index.css` tokens | Updated. |
| Simple global nav (Rooms, Records, Account) | `components/vault.tsx` Shell | Role-aware nav. Align to three items. |
| Conversation expiry under disclosed policy | Server retention + client messaging | Implemented; ensure copy matches behavior. |
| Restricted functions (legal review, incident, retention admin) | Admin console | Present but not separated from participant path as clearly as required. |

## Phased plan

### Phase 1 — Foundations (complete)
- Design tokens aligned to charcoal / warm ivory / restrained jade + brass.
- Atmospheric texture retained.
- Mapping documented.

### Phase 2 — Core session surface (started)
- Added `client/src/components/room/simple-room-shell.tsx`: purpose header, center conversation slot, collapsible ledger, quiet facilitator controls, persistent phase/identity/retention indicators.
- Existing tabbed rooms remain functional. Incremental adoption of the shell is next.

### Phase 3 — Ledger and proposal
- Surface Accept wording vs Support recommendation as distinct actions.
- Keep ledger sections concise (Purpose, Points, Agreement, Unresolved, Next steps).
- Proposal workspace built only from accepted entries.

### Phase 4 — Disclosures and exceptional states
- Complete pre-entry disclosure set.
- Handle disconnect, incomplete review, and closed-without-agreement states.

### Phase 5 — Restricted controls
- Separate legal/identity/incident/retention administration from participant navigation.

No destructive schema changes or authentication rewrites in Phases 1–3.

## Verification
- Token changes and new component committed.
- Full visual and flow verification requires local `npm run dev` after clone.
- Privacy invariants (ephemeral chat, hash-chained audit, no default transcript) remain unchanged.
