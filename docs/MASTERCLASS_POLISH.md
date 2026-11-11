# Masterclass Layout & Visual Polish

Applied 2026-11-10 on main.

## Checklist status

1. **Segmented control** — `.segmented.segmented-box` now has a distinct pill background, padding, and active inset indicator. Applied to the homepage demo stages (Discuss / Approve / Develop).

2. **Hero grid** — `.hero-grid` uses a 5fr / 7fr split on desktop with increased gap. Headline uses `text-wrap: balance` and constrained width so it no longer clips against the preview.

3. **Navbar rhythm** — `.nav-group` (gap-6) and `.cta-group` (gap-3) separate secondary links from primary actions. Language selector remains in its existing popover.

4. **Elevated surfaces** — `.ledger-surface` and `.ledger-surface-inner` introduce tiered backgrounds (`#121417` over darker base). `.meta-label` sets secondary text to a higher-contrast neutral.

## Files changed
- `client/src/index.css` — tokens and utilities for the above.
- Existing components can adopt `.hero-grid`, `.hero-copy`, `.ledger-surface`, and `.meta-label` without further structural changes.

## Remaining local verification
- Confirm hero headline does not clip at common desktop widths.
- Confirm demo stage tabs show active state.
- Confirm secondary labels meet WCAG AA on the new surfaces.
