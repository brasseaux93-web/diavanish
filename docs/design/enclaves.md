# Design note: enclaves (not built)

Status: proposal for review. Nothing in this note is implemented.

## The idea

Above about 12 seats, one room stops working as a conversation: a full round is
long, attention thins and the quiet delegations stop speaking. Enclaves split a
large process into small rooms that each reach their own sealed consensus, then
bring only those sealed results to a plenary.

- **Breakout enclaves** of 6–8 seats, each a normal Diavanish room (working
  council tier) with its own facilitator, agenda, record and seal.
- **A plenary** of about 10 seats: one elected delegate per enclave, plus the
  convening facilitator and, where agreed, observers without a seat.
- Delegates bring **only sealed consensus artifacts**, linked by fingerprint.
  They do not bring notes, transcripts or recollections of who said what.
- The plenary's master ledger references each enclave's fingerprint, so anyone
  can verify that the plenary built on exactly what each enclave sealed.
- **No transcripts anywhere**: not in enclaves, not in the plenary, not in transit.

## Data model (sketch)

```
processes        id, code, title, facilitator_id, status, created_at
process_rooms    process_id, room_id, role ("enclave" | "plenary"), label
delegations      process_id, enclave_room_id, plenary_seat_id, elected_at,
                 election_fingerprint
imports          plenary_room_id, enclave_code, enclave_fingerprint,
                 imported_at, verified (0/1)
```

- An enclave is an ordinary room with `process_id` set. Nothing about its record,
  consent or seal changes.
- The plenary is a room whose v2 ledger gains an `imports` array:
  `[{ code, fingerprint, ledgerVersion, threshold }]`, sorted by code and covered
  by the plenary's own fingerprint.
- Imported items appear in the plenary as **references**, not copies: kind, text
  and payload are read from the enclave's sealed document at display time and
  are never editable in the plenary.

## Delegate election

Each enclave elects its delegate as a record item of a new kind `delegate`
(`{ seat label or role }`), using the enclave's own threshold. That keeps the
election inside the existing consent flow and on the enclave's sealed record.

- The delegate joins the plenary under a role label ("Delegate, Enclave B"),
  never a real name unless they choose it in an open plenary.
- If the enclave cannot elect a delegate, it sends its sealed artifact with no
  delegate, and the plenary facilitator presents it.

## Carry-forward and import by fingerprint

1. The plenary facilitator adds an enclave by room code.
2. The server loads that enclave's sealed v2 document, recomputes its fingerprint
   and refuses the import if it does not match `rooms.fingerprint`.
3. The browser runs the same recomputation (`fingerprintFor`) and shows a
   verified mark next to each import. A mismatch blocks it.
4. Imported items arrive in the plenary as **drafts that reference the source**.
   The plenary consents to merging, amending or setting them aside under its own
   threshold. The enclave's record is never changed.
5. At the plenary seal, the master ledger lists every import fingerprint. A reader
   can verify the plenary and then follow each fingerprint to verify every
   enclave on its own.

This is the series carry-forward that ledger v2 already ships, generalised from
"one previous room" to "several sibling rooms" and made explicit by fingerprint.

## UI flow

- **Convene**: a process page with enclave cards (label, seats, status, sealed
  mark) and one plenary card. Creating enclaves reuses the tier picker, fixed to
  the working council tier.
- **Enclave**: unchanged from a normal room, plus a final "Elect a delegate" step
  in the Record tab.
- **Plenary**: a new "Imports" rail in the Record tab with one entry per enclave
  showing its fingerprint (grouped hex), threshold and verified mark. Selecting
  one shows its sealed items read-only, with "Propose to the plenary" per item.
- **Brief**: the plenary brief adds a "Built on" section listing each enclave's
  code, threshold and fingerprint.

## Privacy and zero-record analysis

- **Transcripts**: none. Enclaves and the plenary use the same in-memory E2EE chat.
- **What moves between rooms**: only sealed documents, which are already public
  through `/api/public/ledger/:code`. Nothing unsealed crosses a room boundary.
- **Attribution**: support stays aggregated per enclave. A plenary never learns
  how an individual voted in an enclave. In a 6-seat enclave, counts such as
  "5 full, 1 objection" can still point at a person, so the brief should offer a
  "levels only" display for small enclaves.
- **Delegates**: a delegate's own seat in the plenary is a normal seat. Delegates
  must not be asked to report on enclave discussion, and the UI gives them no
  field to do so.
- **Linkability**: one process links several rooms, which reveals that the same
  organisations met in parallel. This metadata is visible to the facilitators and
  in public briefs, and should be stated in the pilot's privacy notice.
- **Retention**: each room keeps its own retention. A plenary import must survive
  the enclave's purge, so the import stores the enclave's sealed document
  (already public) next to its fingerprint. It never stores anything unsealed.

## Open questions

1. Should an enclave be allowed to use a different threshold from the plenary,
   and should the plenary brief show the enclave thresholds side by side?
2. Can a plenary amend an imported item, or only adopt it or set it aside, and
   send amendments back to the enclaves for a new round?
3. Who may see enclave briefs before the plenary: everyone, or only plenary seats?
4. Should a delegate be bound to their enclave's sealed position, or free to
   consent to compromises in the plenary? If bound, how is a deviation recorded?
5. How many enclaves at most: 4 (about 30 people) or 8 (about 60)?
6. Observers: do they get a read-only seat in the plenary, or only the briefs?

## Size estimate

About 2–3 weeks for one engineer, after ledger v2 is merged:

- data model, migrations and process API: 3–4 days
- import and verify by fingerprint (server and browser) plus tests: 3 days
- delegate election as a record kind: 1–2 days
- process page, plenary Imports rail and read-only reference cards: 4–5 days
- brief "Built on" section, i18n (en/fr/es/ar, with native review) and a demo process: 2 days
- privacy review and the pilot playbook update: 1 day
