# Module A2 Plan — Signing + Identity Primitives
*Date: 2026-01-29*  
*Status: DONE (2026-01-29) — implemented in `packages/kernel`; tests passing (`npm test --workspace packages/kernel`).*

Scope: Module A2 from `[[plan/moduleAplan.md]]`.

Goal: standardize author identity and object signing so provenance can be verified across ingestion, backfill, and replay — without breaking Module A1 canonicalization/content IDs.

Compatibility note (hard): signing MUST use the exact canonical bytes defined in Module A1 (`@wofi/kernel` JCS canonicalization over the content object with `content_id`/`signature`/nulls stripped). A2 must not introduce alternative canonicalization paths.

References:
- `[[plan/moduleA1plan.md]]` (content_id + canonicalization/invariants already shipped)
- `[[wofi_kernel_scheme_unified_v1.md]]` (kernel objects + invariants)
- `[[wofi_chat_decisions_2026-01-28.md]]` (provenance, proposal-set permanence)

---

## Decisions (cryptography + encoding)

- Algorithm: **Ed25519** (deterministic; 32-byte secret/public).
- Library: **@noble/ed25519** (pure TS/JS, audited; avoid native deps).
- Message to sign: canonical bytes from Module A1 (`canonicalize(toContentObject(obj))`).
- Key encoding:
  - Public keys stored as **base64url (unpadded)**.
  - Accept hex or base64(base64url) as input; `normalizePubkey` returns base64url.
- Signature encoding: **base64url (unpadded)**.
- `author.kind`: fixed to `"pubkey"` for v1; leave room for future kinds.
- `signature.alg`: fixed to `"ed25519"`.

Rationale for base64url: URL/tag friendly, matches Arweave tag constraints, avoids hex inflation.

---

## Object envelope (schema-aligned)

Reuse Module A1 base properties (already in schemas):
- `author`: `{ "kind": "pubkey", "value": "<base64url>" }`
- `signature`: `{ "alg": "ed25519", "value": "<base64url>" }`

Rules:
- `author.value` is the verifying key for `signature.value`.
- `signature` required in production ingest/write paths; optional only in explicit dev/test modes.
- Adding `author`/`signature` MUST NOT change `content_id` (guaranteed because A1 strips them before hashing).
- Do not mutate signed fields post-sign; new versions must be new objects with new `content_id`.

---

## Public API (package-level)

Extend `@wofi/kernel` (no new package) with:
- `normalizePubkey(input: string | Uint8Array): string`  
  - Accept hex/base64/base64url; return base64url string; throw on wrong length.
- `signObject(obj, privateKey, opts?): Signed<T>`  
  - Validates schema + invariants first (A1).  
  - Ensures `created_at` present.  
  - Computes `content_id` if missing.  
  - Adds `author` (pubkey) and `signature`; leaves other fields untouched.  
  - Returns a new object; does not mutate input.
- `verifyObjectSignature(obj, opts?): void`  
  - Checks presence (unless `opts.allowUnsigned === true`).  
  - Recomputes canonical bytes via A1 helpers; verifies Ed25519 signature.  
  - Throws `SIGNATURE_MISSING`, `SIGNATURE_INVALID`, or `AUTHOR_INVALID`.

Error codes (add to `KernelErrorCode`):
- `SIGNATURE_MISSING`
- `SIGNATURE_INVALID`
- `AUTHOR_INVALID`

---

## Operational rules

- **Write path** (API/outbox):
  1) `validateSchema` + `validateInvariants` (A1).
  2) `signObject`.
  3) Persist immutable object (Module A3) keyed by `content_id`.
- **Ingest/backfill**:
  - Verify signature before expanding into typed tables; if missing/invalid, store raw object + failure reason (auditable) and skip typed expansion unless `allowUnsigned` explicitly set for backfills.
- **Idempotency**: `content_id` is independent of signature; two actors signing identical content yield the same `content_id` but different signatures — store latest signature alongside content when present, but never reject on duplicate content_id with a different valid signature (audit both).
- **Key management**: keep signing keys out of repo; allow env-var or KMS/HSM pluggable signer later (non-goal for A2 implementation, but API should not block it).

---

## Acceptance criteria

- Deterministic signing: same object + same key → identical signature bytes/base64url.
- Verification fails on any mutation of content fields (including ordering differences handled via canonicalization).
- `content_id` unchanged after adding `author`/`signature`.
- `verifyObjectSignature` passes for all existing Module A1 fixtures when signed with a known key; fails if signature truncated or key mismatched.
- Schema compatibility: no changes needed to Module A1 schemas; fields align with existing `author`/`signature` definitions.

---

## Test plan (minimum)

- **Golden vector**: fixture with fixed private key + kernel object → expected signature (base64url) + unchanged `content_id`.
- **Mutation**: flip one byte in `summary` → `verifyObjectSignature` throws `SIGNATURE_INVALID`.
- **Missing signature**: unsigned object with `allowUnsigned=false` throws `SIGNATURE_MISSING`; with `allowUnsigned=true` passes through.
- **Pubkey normalization**: hex input == base64url input → same normalized key; wrong length throws `AUTHOR_INVALID`.
- **Content-id stability**: `contentId(obj) === contentId(signObject(obj,...))`.

---

## Deliverables

- Code in `packages/kernel` implementing APIs above (TS + generated d.ts).
- Tests in `packages/kernel/test` covering vectors + mutation + normalization.
- README update documenting signing/verifying usage and dev-mode unsigned toggle.
- (Optional, nice-to-have) small CLI helper script: `npm run sign -- file.json --key <path>` for local signing during development.

---

## Out of scope for A2 (to defer)

- Multi-author signatures, threshold schemes.
- DID support or external key registries.
- Hardware/KMS signer plumbing (design later; keep API open).
