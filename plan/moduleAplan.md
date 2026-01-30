# Module A Plan — Kernel + Persistence (WOFI 2.0)
*Date: 2026-01-29*

Stack constraints (from session):
- Services: TypeScript/Node.js
- Off-chain index: PostgreSQL
- On-chain blob store: Arweave (sync required)
- Global backfill: not frequent, but must be possible and reliable

This document refines **Module A (Kernel + persistence)** from `plan.md` into concrete choices and responsibilities.

Subplans:
- [[plan/moduleA1plan.md]] — kernel schema, canonicalization, invariants
- [[plan/moduleA2plan.md]] — signing + identity primitives
- [[plan/moduleA3plan.md]] — immutable object store (Arweave + dev)
- [[plan/moduleA4plan.md]] — Postgres mirror + indexer + backfill
- [[plan/moduleA5plan.md]] — graph query layer (Postgres-first)

---

## A1) Kernel schema + canonicalization

**Status:** DONE (2026-01-29) — shipped `packages/kernel` (`@wofi/kernel`) with passing tests.

**Goal:** deterministic `content_id` and invariant validation across all services and indexers.

- Canonicalization: **JCS / RFC 8785** implemented in TS; nulls omitted; transport fields `content_id`/`signature` stripped before hashing.
- `content_id`: `sha256:<hex>` over canonical UTF-8 bytes (`contentId()` helper).
- Validation:
  - JSON Schema per object type (`wofi.idea.v1`, `wofi.construction.v1`, …) via Ajv strict, `additionalProperties: false`.
  - Invariant validators enforce hard lines:
    - Construction inputs are Idea IDs only
    - Evidence attaches only to Claims (`SUPPORTS`/`REFUTES`)
    - Claim `ABOUT` targets `Idea|Implementation` only
    - Implementation references exactly one Idea (checked with context edges)
- Deliverable: shared TS package exporting:
  - `canonicalize(obj): Uint8Array`
  - `contentId(obj): string`
  - `validateSchema(obj): void`
  - `validateInvariants(obj, context?): void`
  - `getObjectType(obj): string`
- Tests: node test runner post-`tsc -b`; fixtures assert canonical string + expected `content_id`; invariant failures covered.

---

## A2) Signing + identity primitives

**Goal:** provenance integrity; every persisted kernel object can be verified.

- Algorithm: **Ed25519**.
- Libraries: `@noble/ed25519` (or libsodium).
- Signature format:
  - Sign the canonical bytes of the object *excluding* signature fields.
  - Store `author` as `{ kind: "pubkey", value: "<hex|base64>" }` (kernel-compatible).
  - Store `signature` as `{ alg: "ed25519", value: "<sig>" }` (kernel extension; keep stable).
- Enforce at ingest: reject objects failing signature verification (except explicit “anonymous/dev mode” environments).

---

## A3) Immutable object store (Arweave + dev store)

**Goal:** immutable, addressable storage for kernel objects with idempotent writes.

- Production: **Arweave** transactions; upload via **Bundlr** (or equivalent) for throughput.
- Development: filesystem-backed blob store (or S3/minio) with the same interface.
- Required tags (minimum):
  - `wofi:type` = `wofi.idea.v1` / `wofi.construction.v1` / …
  - `wofi:schema_version` = `1.0`
  - `wofi:content_id` = `sha256:...`
  - `wofi:created_at` = ISO timestamp
  - `wofi:author` = pubkey fingerprint
  - Optional: `wofi:profile_id` for objects that reference it
- Idempotency rule:
  - “Write” is keyed by `content_id`.
  - If already persisted (tx exists for `content_id`), return existing tx id (or record as duplicate).

---

## A4) Indexer + relational mirror (PostgreSQL)

**Goal:** fast retrieval + deterministic reconstruction of graph state from immutable objects.

Recommended Postgres layout:
- `objects` (raw, append-only)
  - `content_id` (pk), `wofi_type`, `schema_version`, `canonical_json`, `created_at`, `author_pubkey`, `signature`, `arweave_tx_id`, `ingested_at`
- Typed tables (for query speed / integrity)
  - `ideas(content_id, title, kind, summary, tags, created_at, author_pubkey, ...)`
  - `constructions(content_id, operator, profile_id, params_json, constraints_json, created_at, author_pubkey, ...)`
  - `construction_inputs(construction_id, input_idea_id, role, ordinal)` (hyperedge inputs)
  - `construction_outputs(construction_id, output_idea_id)` (single output)
  - `claims(content_id, about_type, about_id, claim_text, resolution_type?, created_at, ...)`
  - `evidence(content_id, claim_id, stance, locator, excerpt_hash?, created_at, ...)`
  - `submissions(content_id, payload_kind, payload_value, payload_hash, mime_type, created_at, ...)`
  - `implementations(content_id, idea_id, metadata_json, created_at, ...)`
  - `profiles(content_id, weights_json, created_at, ...)`
  - `edges(content_id, rel, from_id, to_id, created_at, ...)` (optional but useful for indexing/clarity)

Indexer rules:
- Ingest pipeline is append-only and idempotent:
  - Deduplicate by `content_id`.
  - Validate schema + invariants + signature before writing typed tables.
  - Store raw object in `objects` even if typed expansion fails (but mark status), so failures are auditable.

---

## A5) Graph query layer

**Goal:** provide “graph-shaped” responses while using Postgres as the primary store.

- Start with Postgres-native traversal:
  - Use recursive CTEs to expand neighborhood / lineage.
  - Provide “hyperedge aware” traversals via joins on `construction_inputs`/`construction_outputs`.
- Cache/materialize profile-specific “active graph” separately (Module C) rather than baking it into Module A.
- API contract examples:
  - `getIdea(idea_id)`
  - `getIdeaNeighborhood(idea_id, depth, { profileId? })`
  - `getIdeaLineage(idea_id, { profileId?, direction })`
  - `getClaimBundle(target_id)` (claims + evidence only; never evidence on ideas directly)

---

## Sync with Arweave: operational plan

### Write path (local → Arweave → Postgres)
1) Normalize + canonicalize + compute `content_id`
2) Validate schema + invariants
3) Sign (if required)
4) Enqueue to `outbox` (DB) with idempotency key = `content_id`
5) Worker uploads to Arweave/Bundlr, records `arweave_tx_id`
6) Confirmation worker marks confirmed + triggers ingest into typed tables

### Read path (Postgres-first; Arweave fallback)
- Default reads from Postgres mirror.
- Optional fallback: if object missing, fetch from Arweave by `content_id` tag (slow path) then ingest.

### Global backfill (rare but must work)
- Backfill job:
  - Query Arweave for `wofi:type` tags (optionally per type + date windows).
  - Fetch tx payloads in batches.
  - Validate and ingest into `objects` + typed tables.
  - Track cursor/checkpoints so it can resume.
- Acceptance criteria:
  - Can rebuild an empty Postgres mirror to parity with Arweave dataset.
  - Deterministic: same Arweave set => same `content_id`s + same typed rows.
  - Auditable: logs + counts per type + failure reasons persisted.

---

## Deliverables checklist (Module A)

- TS package for canonicalization + hashing + validation + invariants.
- Arweave/Bundlr client wrapper + dev store adapter with identical interface.
- Postgres schema for `objects` + typed tables + minimal indexes.
- Indexer workers: outbox uploader, confirmer, ingester.
- Backfill job with checkpointing + resumability.

## Verification (2026-01-29)

- `npm test` (runs @wofi/indexer/kernel/query/store) — all passed.
- Note: @wofi/query has 3 skips due to pg-mem lacking recursive CTE support; claim bundle test passed.
- Local Postgres sanity check after seeding: `getIdeaNeighborhood` + `getClaimBundle` returned expected nodes/edges and claim/evidence counts.
- Postgres test run: `DATABASE_URL=postgres://$(whoami)@localhost:5432/wofi_indexer_test npm -w @wofi/query test` — Postgres-backed query tests passed; pg-mem recursion tests remain skipped.
