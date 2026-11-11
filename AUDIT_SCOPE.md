# Independent audit: scope brief

Diavanish asks for a white-box review before any production pilot. The report will be published after a fix window agreed with the auditor.

## Target

The repository at a tagged release, about 8,300 lines of application TypeScript (excluding UI primitives and translations).

## Priority 1: cryptography and key handling

- `shared/e2ee.ts`: primitives, AAD and context binding, wrap-signature message, safety-code derivation (room code + facilitator signing key, independent of the epoch), sender-certificate and chat-signature messages and `verifyChat`.
- `client/src/lib/e2ee-client.tsx`, `client/src/lib/keyring.ts`: epoch rotation on removal and on age (`EPOCH_MAX_AGE_MS`), wrap verification, sender-certificate issuance and the in-memory verified roster, replay handling, which name is displayed for a line, key lifetime in `sessionStorage` and the one-time migration out of `window.name`, sign-out wipe.
- `client/src/lib/translate.ts`, `client/src/components/chat/chat-shell.tsx`: that translation only ever receives already-verified plaintext, uses the browser's on-device Translator/LanguageDetector APIs with no network or server fallback, never triggers a model download itself, and that the displayed name, verified badge and "mine" alignment come from the verified line (or a signature made in this tab), not from claims in the message.
- `server/routes.ts` E2EE endpoints: can the server, or a seat, cause a client to accept a key it should not? Replay of old epochs? Wrap substitution between seats? Can a seat or the server get a chat line displayed under another seat's name, or the facilitator's, without the unverified mark? Can a certificate survive a seat's signing key or name changing?
- `server/demo.ts`: confirm the server-held demo key can never apply to a non-demo room.

## Priority 2: authentication and authorisation

- `server/mailer.ts` and the request-code and verify routes: code entropy, peppered hashing, constant-time comparison, rate and attempt limits, account enumeration through responses or timing.
- Session handling and idle expiry, role checks on every route, invite hashing and role-bound invites, ban and removal paths.

## Priority 3: privacy and metadata

- Logs, headers and error messages: confirm no IP, body, query string or invite token leaks.
- Database contents after a room is sealed and after retention runs.
- Ledger hash chain and destruction certificate: can a sealed record be altered undetected?

## Priority 4: web surface

- XSS in ledger text, pseudonyms and summaries; CSRF (sessions use a header, not cookies); clickjacking given that X-Frame-Options is not set because the app is embedded.
- Dependency review.

## Deliverables

A findings report with severity ratings, a retest after fixes, and a public summary.

## Candidate auditors

- [OTF Security Lab](https://www.opentech.fund/labs/security-lab/), which funds audits for internet-freedom tools through partners such as Cure53, Radically Open Security and 7ASecurity.
- Radically Open Security, a non-profit consultancy.
- Cure53.
