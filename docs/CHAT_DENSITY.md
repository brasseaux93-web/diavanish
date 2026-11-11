# Chat density reduction

The live chat was dense because bubbles, meta, and the composer sat tightly together.

## Changes
- `client/src/styles/chat-open.css` — looser padding, larger gap between groups, softer bubbles, more room around the composer.
- `client/src/components/room/simple-room-shell.tsx` — increased vertical and horizontal spacing, wider ledger column, more padding.

## How to apply the open chat styles
Add this import near the top of `client/src/index.css` (after the Tailwind directives):

```css
@import "./styles/chat-open.css";
```

Or link it from the HTML entry if preferred. Once imported, the existing `ChatShell` will pick up the more open spacing without further component changes.

## Remaining
The main participant and facilitator room pages still use the existing tabbed layout. The simplified shell is ready for incremental adoption. Local visual check after the import will confirm the density improvement.
