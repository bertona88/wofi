# Module A1 Plan — Kernel Schema + Canonicalization
*Date: 2026-01-29*
*Status: DONE (2026-01-29) — implemented in `packages/kernel` with passing tests.*

Scope: Module A1 from `[[plan/moduleAplan.md]]`.

Goal: define deterministic object encoding + `content_id` + schema/invariant validation for all kernel objects.

References:
- `[[wofi_kernel_scheme_unified_v1.md]]` (canonicalization, object types, invariants)

---

## Decisions (stack + libraries)

- Language/runtime: TypeScript (Node services).
- Canonicalization: JSON Canonicalization Scheme (JCS / RFC 8785).
- Hash: SHA-256 over canonical UTF-8 bytes.
- Schema validation: JSON Schema + `ajv` (strict mode).
- Invariant validation: custom validators (cross-object rules) layered on top of schema.

---

## `content_id` contract

- Input: a kernel object (e.g. `wofi.idea.v1`) without transport-specific wrappers.
- Steps:
  1) Strip `content_id`, `signature`, and null-valued properties recursively before hashing.
  2) Canonicalize via JCS (stable key ordering, no insignificant whitespace).
  3) `content_id = "sha256:" + hex(sha256(canonical_bytes))`.
- Requirement: the same logical object must always yield the same `content_id` across platforms.

---

## Schema set (kernel object types)

Minimum schemas (v1):
- `wofi.idea.v1`
- `wofi.construction.v1`
- `wofi.claim.v1`
- `wofi.evidence.v1`
- `wofi.submission.v1`
- `wofi.implementation.v1`
- `wofi.profile.v1`
- `wofi.edge.v1`
- Optional extensions:
  - `wofi.claim_market.v1`
  - `wofi.attestation.v1`

Schema rules:
- Reject unknown top-level fields by default (unless we decide “extensions allowed” for specific objects).
- Enforce `type` + `schema_version` presence and exact match.

---

## Invariants (must be enforced)

At validation time, enforce:
- Composition invariant:
  - Construction inputs are Idea IDs only.
  - Construction output is an Idea ID.
- Epistemic invariant:
  - Evidence attaches only to Claims (`SUPPORTS` / `REFUTES` target Claim).
- Claim scope invariant:
  - Claims are only about an Idea or an Implementation.
- Implementation reference invariant:
  - Implementation references exactly one Idea.
- Submission provenance invariant:
  - Submission minted before Idea anchor.
  - `SUBMITTED_AS` edges link Submission → Idea.
  - `DERIVED_FROM` edges can link generated objects → Submission.

Notes:
- Some invariants require context (e.g. verifying that referenced IDs exist in the local mirror). Treat these as:
  - **Local invariants**: validate on the object alone.
  - **Referential invariants**: validate during ingestion/indexing when lookups are possible.

---

## Public API (shared package)

Deliverable: a shared TS package (name: `@wofi/kernel`) used by API, indexer, and backfill jobs.

Required exports:
- `canonicalize(obj): Uint8Array`
- `contentId(obj): string`
- `validateSchema(obj): void` (throws structured error)
- `validateInvariants(obj, ctx?): void` (throws structured error)
- `getObjectType(obj): string`

Error model:
- Stable error codes (e.g. `SCHEMA_INVALID`, `INVARIANT_VIOLATION`, `CANONICALIZATION_ERROR`).
- Include `path` (JSON pointer) where possible.

---

## Test vectors (must-have)

- Golden canonicalization fixtures:
  - Input JSON → expected canonical string (see `test/fixtures`).
- Golden `content_id` fixtures:
  - Idea fixture with `content_id`/`signature` stripped in hashing → expected `sha256:...`.
- Invariant tests:
  - Invalid construction input key, invalid edge rel, invalid edge direction with context, implementation with >1 `IMPLEMENTS`.

Acceptance criteria:
- Deterministic `content_id` for fixtures across machines.
- Schema + invariant errors are stable and machine-readable.

Update (2026-01-30):
- Added `wofi.submission.v1` schema + new edge rels `SUBMITTED_AS` / `DERIVED_FROM` with invariant checks.
- Tests: `npm -w @wofi/kernel test`.
