# Main flows

## Entry → role pages
- Start: #/
- Steps: enter an invite code, or use Sign in → Administrator / Facilitator / Participant; click "Verify a sealed ledger"
- Expect: admin sign-in, facilitator portal, join page, verify page

## Admin sign-in
- Start: #/admin
- Steps: email admin@diavanish.org → Email me a code → enter the 6-digit code (shown on screen only with `APERTURE_DEV_CODES=1`) → Sign in
- Expect: #/admin/console, tabs Settings, Facilitators, Compliance, Outcomes, Security; Compliance shows "Chain intact"

## Facilitator sign-in
- Start: #/facilitate
- Steps: email → Email me a code → enter the 6-digit code → Sign in
- Expect: #/facilitate/rooms list; open room shows Floor/Record/Board/Seats/Follow-through/Summary/Seal tabs

## Participant join + recover
- Start: #/join
- Steps: invite code → lookup → pseudonym → role → 18+ → Join → recovery key → Enter room
- Expect: #/p with room; "Recover a seat" restores with code + pseudonym + key

## Room features
- Stage/timer, input lock, caucus thread, summary save/verify/request-changes/lock, exports (md, ledger json, ics), seal → destruction cert, verify page recompute

## Language
- Nav dropdown labelled in English: English, French, Spanish, Arabic. Arabic switches to RTL with IBM Plex Sans Arabic

# Requested change checks
- Header has a visible "Sign in" control on every page when signed out (Administrator, Facilitator, Participant, Recover seat)
- Facilitator portal opens on sign-in, not on the application form
- Language switch renders Arabic correctly (no letter-spacing, Arabic font, right-to-left layout)
- Surfaces are plain: hairline rules instead of boxed cards, no grain or decorative texture, readable contrast
- Logical navigation: role-aware nav links + breadcrumbs (Rooms › Room), back links
- "Run demo" button for each role: Administrator, Facilitator, Participant, Verifier — each lands signed in on seeded sample data
- Demo banner visible during a demo with "Exit demo"
- Raw downloads (ics, md, ledger, my data) use API base so they work on deployed link

# Privacy and trust checks
- Sign-in: code arrives by email (Resend or webhook); with no mail configured, request-code returns 503. `APERTURE_DEV_CODES=1` shows the code with a warning
- Wrong code 5 times burns it; unknown emails get the same response as known ones
- Participant joins with a role-bound invite (case and spaces ignored), role field is locked, waiting screen breathes until admitted
- A waiting, removed, banned or departed seat gets 403 from `/api/participant/chat`: the relay serves ciphertext to admitted seats only
- A removed or banned participant sees "Your seat in this room has ended" and can still export their data or ask for erasure; an erased seat sees a plain explanation (403 `seat_ended`)
- A dropped connection shows "Connection lost. Trying again." in the room and does not sign anyone out; only a refused session (401/403/404) leaves the room
- After admit: participant and facilitator safety codes match; "Role attested" shows; floor chat decrypts in the browser; `/api/participant/chat` returns only `{epoch, iv, ct}`
- Each key wrap carries a facilitator signature over the seat's key hash; a bad signature makes the participant refuse the key
- Caucus messages flow both ways only between facilitator and that seat
- Chat lines show the sender name from the facilitator's certificate; a line signed by the wrong seat, relabelled, or replayed shows "Unverified sender"
- Removing a seat, or the epoch passing 30 minutes, starts a new key epoch; earlier lines stay readable in open tabs and the safety code does not change
- An invite with a forged role signature is refused (400)
- Demo rooms show "not end-to-end" and demos are off unless `APERTURE_DEMO=1` (production also needs `APERTURE_DEMO_IN_PRODUCTION=1`); off means `/api/demo/*` is a 404 and the demo buttons are hidden
- Mobile 375px: no horizontal scroll; language button collapses to an icon
