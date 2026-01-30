# 001 [HIGH] Module A1 — Kernel Schema + Canonicalization (`@wofi/kernel`)

## Status: COMPLETE

## Summary
Implement the first v2 kernel building block: deterministic JSON canonicalization, `content_id` hashing, JSON Schema validation, and kernel invariant validation for all kernel object types (Ideas, Constructions, Claims, Evidence, Implementations, Profiles, Edges).

This module is the single source of truth for:
- what constitutes a valid kernel object at a given schema version, and
- how `content_id` is derived deterministically across machines/services.

References:
- `wofi_kernel_scheme_unified_v1.md`
- `plan/moduleAplan.md` (A1 section)
- `plan/moduleA1plan.md`

---

## Goals
- Provide a shared TypeScript package `@wofi/kernel` usable by API, indexer, and backfill jobs.
- Deterministic canonicalization and hashing (`content_id`) across platforms.
- Strict schema validation per kernel object type + version.
- Kernel invariant validation (local + referential via optional context).
- Stable, machine-readable error codes and error shapes.

## Non-goals
- Implementing the object store, indexer, or graph query layer (Module A3+).
- Implementing scoring / profiles (Module C).
- Web crawling / prior-art retrieval (Module B10).

---

## Repo placement / package shape
Create a new standalone package at `packages/kernel/`:
- `packages/kernel/package.json` named `@wofi/kernel`
- `packages/kernel/src/` implementation
- `packages/kernel/src/schemas/` JSON Schema files (or TS-embedded equivalents)
- `packages/kernel/test/` (or `src/__tests__/`) with deterministic fixtures

Keep it runnable/testable without requiring any other WOFI module to exist yet.

Workspace conventions (repo root already set up for npm workspaces):
- Add `packages/kernel/tsconfig.json` that `extends` `../../tsconfig.base.json`.
- Ensure `packages/kernel/package.json` defines at least: `test`, `build` (even if it’s a no-op initially), and `typecheck` scripts so root `npm run test|build|typecheck` works via workspaces.

---

## Public API (required exports)

### Canonicalization + hashing
- `canonicalize(obj: unknown): Uint8Array`
  - Returns canonical JSON UTF-8 bytes.
  - MUST use JSON Canonicalization Scheme (JCS / RFC 8785) as the canonical form.
- `contentId(obj: unknown): string`
  - Returns `"sha256:<hex>"`.
  - MUST be deterministic for a given logical object (see `content_id` contract below).

### Type + schema validation
- `getObjectType(obj: unknown): string`
  - Returns `obj.type` if present, else throws `SCHEMA_INVALID`.
- `validateSchema(obj: unknown): void`
  - Validates against JSON Schema for the object’s `type` + `schema_version`.
  - MUST reject unknown top-level fields by default (`additionalProperties: false`) unless explicitly allowed by that schema.

### Invariant validation
- `validateInvariants(obj: unknown, ctx?: ValidationContext): void`
  - Enforces kernel hard lines from `wofi_kernel_scheme_unified_v1.md`.
  - Supports both:
    - **Local invariants**: checkable from the object alone.
    - **Referential invariants**: require lookups (via `ctx`) to verify relationship types/targets.

### Errors
All validators MUST throw structured errors with stable codes:
- `SCHEMA_INVALID`
- `INVARIANT_VIOLATION`
- `CANONICALIZATION_ERROR`
- `UNKNOWN_SCHEMA_VERSION`
- `UNKNOWN_OBJECT_TYPE`

Error shape (minimum):
```ts
type KernelValidationError = Error & {
  code: string
  message: string
  path?: string // JSON pointer when applicable
  details?: unknown
}
```

---

## `content_id` contract

### Canonical bytes input to hashing
`content_id` MUST be computed from the canonical bytes of the object after removing “computed/transport” fields.

Define a single helper used everywhere:
- `toContentObject(obj)` (internal) returns a deep-cloned JSON value with:
  - all object properties with value `null` removed (omit nulls)
  - these keys removed at any nesting depth (computed/transport fields):
    - `content_id`
    - `signature`

Notes:
- This avoids self-referential hashing and makes `content_id` stable regardless of signing.
- Do NOT remove `author` or `created_at` (those are part of the object content in the current kernel examples).
- Undefined is not representable in JSON; ensure your implementation never depends on JS-specific undefined behavior.

### Hash format
- `content_id = "sha256:" + hex(sha256(canonical_utf8_bytes))`
- Hex MUST be lowercase.

---

## Schema set (v1)
Implement schemas for at least:
- `wofi.idea.v1`
- `wofi.construction.v1`
- `wofi.claim.v1`
- `wofi.evidence.v1`
- `wofi.implementation.v1`
- `wofi.profile.v1`
- `wofi.edge.v1`

Optional (stubs are acceptable, but types must be reserved):
- `wofi.claim_market.v1`
- `wofi.attestation.v1`

Schema requirements:
- Enforce `type` (exact match) and `schema_version` (exact match).
- Enforce field types and basic required fields.
- Keep non-kernel “metadata” extensibility explicit:
  - If extensions are needed, prefer a single `metadata` object field (schema: free-form object) rather than allowing unknown top-level keys.

---

## Invariant validation requirements
Implement invariant checks aligned to the kernel hard lines.

### Local invariants (object-only)
- Construction composition invariant (local portion):
  - `wofi.construction.v1.inputs[*]` MUST be objects containing `idea_id` (string).
  - MUST NOT accept `claim_id` / `evidence_id` / etc as input fields.
- Edge relationship constraints (local portion):
  - `wofi.edge.v1.rel` MUST be one of the kernel rels:
    - `INPUT_OF`, `OUTPUT_OF`, `IMPLEMENTS`, `ABOUT`, `SUPPORTS`, `REFUTES`, `ATTESTS`

### Referential invariants (require context)
When `ctx` is provided, enforce:
- Composition invariant (full):
  - `INPUT_OF` edges must be `Idea -> Construction`
  - `OUTPUT_OF` edges must be `Construction -> Idea`
- Epistemic invariant:
  - `SUPPORTS` / `REFUTES` edges must be `Evidence -> Claim`
- Claim scope invariant:
  - `ABOUT` edges must be `Claim -> (Idea | Implementation)`
- Implementation reference invariant:
  - `IMPLEMENTS` edges must be `Implementation -> Idea`
  - Implementations MUST reference exactly one Idea in the active edge set (enforceable when validating an Implementation bundle under `ctx`)

### ValidationContext interface
Define a minimal context interface to support referential checks:
```ts
export type ValidationContext = {
  getObjectTypeById?: (id: string) => string | undefined
  getEdgesByFromId?: (fromId: string) => Array<{ rel: string; to_id: string }>
}
```
If context methods are missing, only local invariants are enforced.

---

## Test vectors (must-have)

### Golden canonicalization fixtures
- Fixtures live under `packages/kernel/test/fixtures/`.
- For each fixture:
  - input JSON (pretty / unordered keys)
  - expected canonical JSON string (exact bytes)

### Golden `content_id` fixtures
- For at least one object per type, assert the exact expected `sha256:<hex>`.
- Include at least one fixture where the input contains `content_id` and/or `signature` fields to prove they are ignored for hashing.

### Invariant tests
- One failing fixture per invariant:
  - invalid rel
  - invalid Construction input shape
  - invalid edge direction/type when `ctx` is provided

---

## Acceptance criteria
- `@wofi/kernel` exists at `packages/kernel/` and is importable from Node/TS consumers.
- `canonicalize()` produces byte-for-byte stable canonical JSON using JCS rules for all golden fixtures.
- `contentId()` matches expected `sha256:<hex>` for all golden fixtures.
- `validateSchema()` rejects:
  - unknown object `type`
  - unknown `schema_version`
  - unknown top-level fields (unless explicitly allowed)
- `validateInvariants()` rejects all failing invariant fixtures with:
  - stable `code`
  - helpful `message`
  - `path` where applicable
- Tests are runnable locally (document the command in `packages/kernel/README.md`).
