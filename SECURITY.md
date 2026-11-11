# Security policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository (Security → Report a vulnerability). If you cannot use GitHub, email admin@diavanish.org. Please do not open a public issue. We aim to reply within 5 working days and to agree a disclosure date with you, normally within 90 days.

In scope: anything that lets the server, another participant or an outsider read chat, link pseudonyms to people, forge a role, sign in without the emailed code, or alter a sealed ledger without detection. See `THREAT_MODEL.md` for what we already know we do not protect against.

## What Diavanish does today

- Chat is end-to-end encrypted in the browser (WebCrypto: ECDH P-256, HKDF-SHA-256, AES-256-GCM). The server relays ciphertext only. It keeps the most recent lines of each room (up to 200) in memory, never on disk, until the room closes, and serves them to admitted seats only.
- Each room key is made on the facilitator's device and wrapped for each admitted seat. Every wrap is signed by the facilitator's room signing key over the seat's own public-key hash, so the server cannot substitute keys without the participant's browser refusing the room.
- A spoken safety code (hash of the room code and the facilitator's signing key) lets everyone confirm no one swapped that key. It does not change when the room key rotates.
- The room key rotates when a seat is removed or banned, and every 30 minutes while the facilitator's tab is open.
- Every chat line is signed by its sender. The facilitator's device certifies each seat's signing key under the seat's name; lines that fail the check show as "Unverified sender".
- Role claims are ECDSA signatures made on the facilitator's device, bound to a hashed invite, and checked in each participant's browser.
- Sign-in codes are delivered by email only, stored as peppered hashes, compared in constant time, limited to 3 live codes per address and 5 attempts per code.
- No IPs, request bodies or query strings in logs. `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on the API. Fonts are bundled, with no third-party requests.

## Independent audit

No independent audit has been published yet. `AUDIT_SCOPE.md` is the brief we will give an auditor. Until a report is public, treat Diavanish as unaudited.
