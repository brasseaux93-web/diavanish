# Ledger v2: the structured, consented record

Diavanish keeps no transcript. Chat is end-to-end encrypted, relayed in memory and
never written to disk. The only thing a room keeps is what the room itself agreed
to put on the record, and that is what the seal covers.

Ledger v2 replaces the flat list of approved entries with a structured record per
agenda item, adds a support level to every consent, folds the locked outcome
summary and the follow-through commitments into the seal, and typesets a
proposal brief from the sealed record.

## The record

Each agenda item (and a "whole room" bucket) can hold items of seven kinds. An
item is an ordinary `entries` row with a new `kind`, plus a JSON `payload` on the
`entry_versions` row and a one-line text summary. Every field is normalised and
validated in `shared/ledger.ts` (`validateRecord`).

| Kind | Payload |
| --- | --- |
| `problem` | `statement`, `scale` (team · org · community · city · national · regional · global), `affected[]` |
| `position` | `party` (a role or delegation, never a person unless that seat chose its real name in an open room), `wants`, `why` |
| `evidence` | `summary`, `source`, `url` (http(s) only, no credentials, shown as plain text, never fetched) |
| `option` | `title`, `rationale`, `status` (chosen · dropped), `reason` |
| `agreement` | `action`, `owner` (a seat label or role), `deadline` (YYYY-MM-DD), `resources`, `measure` |
| `condition` | `{form: "conditional", accept, provided}` ("we'd accept X if Y") or `{form: "unresolved", point}` |
| `question` | `question`, `research` |

Only the facilitator composes record items (`POST /api/facilitator/rooms/:id/record`).
Participants cannot write record items; they answer them.

## Consent and support

Every record item goes to every admitted seat. Each seat answers for the exact
current version with one of:

- **Full consensus**
- **Consent with reservations**
- **Objection on record**, with an optional short reason (≤ 280 characters) that goes on the record
- **Needs rewording**, which is not consent and asks the facilitator to revise

Revising an item creates a new version and clears every answer.

**What the facilitator sees.** Until every admitted seat has answered an item, the
facilitator sees only how many have answered ("4 of 9 answered"), not who and not
what. The server enforces this: the facilitator API sends no per-seat consent rows
for record items at all, and the tally carries no support, rewording or consenting
figures until the item is complete. The audit log records every answer as the same
action (`record_item_answered`), so it can't reveal what a seat chose either. Once
every seat has answered, the facilitator sees the aggregate: counts in rooms of
seven or more, levels only in smaller rooms (below).

The sealed record keeps only the aggregate and the objection reasons. An objection
carries a name only in an open room where that seat chose its real name. Per-seat
answers on record items are deleted when the room is sealed.

### Levels only in rooms under seven seats

In a small room, "3 full, 1 objection" can point at a person. So rooms with
**fewer than seven admitted seats** show support as levels, never numbers. This
applies everywhere: the participant room, the facilitator Record tab, approve error
messages, the sealed v2 ledger, Verify and the brief.

A levels aggregate is `{ level, withReservations, withObjection, objections }`:

- `level` is the strongest category present: objection, then reservations, then full.
- The two booleans say whether any reservation or objection exists.
- The reasons on record are kept, with duplicates removed.

They are shown as "Full consensus", "Consensus with reservations", "Objection on
record" or "Objection on record, with reservations".

**Which seat count.** Live views use the number of admitted seats at that moment.
The seal fixes the choice from the **admitted seats at the moment of sealing**. That
is the room as it actually stood, not the seat cap: a council room with a cap of 10
but only 5 seats present is sealed as levels. The choice is recorded in the
canonical ledger as `supportDetail: "levels" | "counts"` and covered by the
fingerprint, so verification stays deterministic. Changing the flag, or adding or
removing counts, breaks the match.

**Limit.** Objection reasons are kept because each objector chose to put a reason on
the record. Several distinct reasons still show that several seats objected.

### Sealing thresholds

Each room picks a threshold at creation. It is shown to everyone as a quiet chip,
recorded in the v2 ledger (`room.threshold`), and gates approval of every record item:

1. Every admitted seat must answer. Silence is never consent.
2. *Consenting* = full consensus + consent with reservations.
3. **Full consensus** (`consensus`): every seat consents. One objection or one
   rewording request holds the item.
4. **75% supermajority** (`super75`): `consenting × 4 ≥ seats × 3`.
5. **Two-thirds** (`super66`): `consenting × 3 ≥ seats × 2`.

Integer arithmetic only, so 3 of 4 passes 75% and 2 of 3 passes two-thirds, while
13 of 20 (65%) does not pass two-thirds.

**Objections block only under full consensus.** In 75% and two-thirds rooms an
objection does not block the item. It counts against the share, and once the item
passes the objection stays on the record as dissent: it appears in the brief's
"Conditions and dissent" section, with its reason if one was given. The threshold
picker, the room chip and the Record tab all say so. A room cannot be sealed while any
record item is still awaiting the room: approve it or set it aside first.
The rule lives in `shared/tiers.ts` (`decide`) and is tested per threshold.

### Single-seat labels

A position's party or an agreement's owner may be a role or delegation label that
only one admitted seat holds. In that case the facilitator form shows one quiet,
non-blocking line: "Only one seat holds this label, so it may identify them." The
item can still be proposed.

## Room tiers

Chosen at creation from three cards. The server clamps every value to the tier's range.

| Tier | Seats | Turn | Notes |
| --- | --- | --- | --- |
| Bilateral / crisis cell | 2–6 | 2–3 min, default 2.5 | |
| Working council (default) | 7–12 | 1.5–3 min, default 2 | a full round of about 15–20 minutes |
| Plenary assembly | 13–20 | 1–3 min, default 1.5 | turns are fixed and cannot be extended; a calm note above 16 seats |

The seat cap is enforced on join (waiting + admitted) and on admission. The
full-round estimate is seats × turn. The tier and seat cap are recorded in the v2
ledger. Rooms created before this change have no tier and keep their old behaviour.

## The v2 seal

`ledgerVersion: 2` documents contain the room (code, title, continuesFrom, tier,
seatCap, threshold), `sealedAt`, the approved items (kind, agenda title, author
label, approvedAt, text, payload, aggregate support, carriedFrom), the locked
outcome summary with its confirmation count, and the follow-through commitments
as they stood at the seal.

Canonicalisation (`canonicalJson`) is deterministic:

- object keys are sorted recursively and `undefined` is dropped
- strings are NFC, line endings LF, runs of spaces collapsed, trimmed
- times are ISO-8601 UTC and dates are `YYYY-MM-DD`
- arrays are sorted by id when the document is built

The fingerprint is SHA-256 over those bytes with WebCrypto. The server and the
browser run the same code (`fingerprintFor`). The sealed document is stored in
`rooms.sealed_ledger`, so follow-through statuses can change after the seal
without touching what was sealed.

**v1 seals verify exactly as before.** `fingerprintFor(version, …)` branches on
the version: v1 uses the original row canonical form byte for byte, and v2 uses
the canonical document. The public ledger endpoint returns `ledgerVersion` and,
for v2, `document`.

## Series: continue from a sealed ledger

When creating a room, the facilitator can continue from one of their sealed v2
rooms. Open questions, conditions and unfinished or lapsed commitments are carried
into the new room as **drafts**. Nothing is carried as agreed. Each one needs fresh
consent from the new room. A real name is never carried: a commitment owned by a
seat that showed its real name is carried under that seat's role.

## Proposal brief

`GET /api/public/ledger/:code/brief.html?lang=en|fr|es|ar` returns one standalone
HTML file with inline CSS, embedded fonts (Instrument Serif for solemn lines,
Geist for the rest), a print stylesheet for A4 and Letter, and a "Save as PDF"
button (`window.print()`; `#print` opens the print dialog on load). It is
rendered only from the sealed v2 document, the same content the seal covers. The
JSON export is unchanged. v1 rooms return 404 for the brief.

Sections: the problem, scale and affected parties · positions · evidence · options
weighed · recommendation and agreements · owners and timeline (with follow-through)
· success measures · conditions and dissent · open questions · seal block.

## Migrations

Drizzle migrations now live in `migrations/`:

- `0000_baseline.sql` is the schema on `main` before this change.
- `0001_ledger_v2.sql` is additive only (`ALTER TABLE … ADD`):
  - `consents.support`, `consents.reason`
  - `entries.carried_from`
  - `entry_versions.payload`
  - `rooms.tier`, `seat_cap`, `turn_seconds`, `seal_threshold` (NOT NULL DEFAULT 'consensus'), `ledger_version`, `sealed_ledger`, `continues_from`

The Docker image and `npm start` run `npm run db:migrate` (`dist/migrate.cjs`),
which applies these files with drizzle-orm's migrator. It is idempotent:

- A fresh database receives `0000`, `0001` and `0002`.
- A database created with `npm run db:push` (no `__drizzle_migrations` journal)
  is recognised by its tables and columns, those migrations are recorded as
  applied, and only newer files run. Existing rows are not touched.
- Existing sealed rooms keep `ledger_version` NULL and verify as v1.

`npm run db:push` remains a convenient local shortcut while developing.

## i18n

All new strings are in `shared/ledger-i18n.ts` for en, fr, es and ar, shared by
the app and the server-rendered brief. **fr, es and ar were drafted from the
English and are flagged for native review** (`LEDGER_NEEDS_REVIEW`).
