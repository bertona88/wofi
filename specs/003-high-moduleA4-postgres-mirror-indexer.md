# Spec 003 — Module A4 PostgreSQL Mirror + Indexer + Backfill
*Date: 2026-01-29*  
*Status: IMPLEMENTED (2026-01-29)*

## Scope
Mirror all immutable kernel objects (Ideas, Constructions, Claims, Evidence, Implementations, Profiles, Edges) into PostgreSQL for fast querying, while preserving append-only provenance. Provide ingestion, typed expansion, and backfill/rebuild paths that remain consistent with Modules A1–A3.

References: `plan/moduleA4plan.md`, `plan/moduleAplan.md`, `wofi_kernel_scheme_unified_v1.md`, `wofi_chat_decisions_2026-01-28.md`, `specs/002-high-moduleA3-immutable-object-store.md`, `plan/moduleA1plan.md`, `plan/moduleA2plan.md`.

## Goals (must)
- Keep a lossless raw mirror (`objects` table) keyed by `content_id`, append-only, with ingest status + errors.
- Expand validated raw objects into typed Postgres tables optimized for graph queries (A5) and scoring (Module C).
- Enforce kernel invariants at ingest: schema (A1), invariants (A1), signature (A2); never drop raw data even on failure.
- Idempotent ingestion and backfill keyed by `content_id`; safe to re-run jobs and replay outbox/backfill streams.
- Support full rebuild from Arweave dataset via checkpointed, resumable backfill.

## Non-goals / deferred
- Materialized profile-specific active graphs (Module C covers that).
- Full-text search; vector search (handled by later modules).
- Multi-tenant auth/row-level security (future security module).

## Postgres schema (v1)

### Raw mirror (audit-first)
`objects`
- `content_id` (pk, text)
- `wofi_type` (text, not null)
- `schema_version` (text, not null)
- `canonical_json` (jsonb, not null)
- `created_at` (timestamptz, not null)
- `author_pubkey` (text, not null)
- `signature_json` (jsonb, not null)
- `arweave_tx_id` (text, unique, null)
- `ingested_at` (timestamptz, default now())
- `ingest_status` (enum: `ok`, `failed`)
- `ingest_error` (text, null)

Indexes: `objects(wofi_type, created_at)`, `objects(arweave_tx_id)`.

### Typed tables (query-optimized)
- `ideas(content_id pk, title text, kind text, summary text, tags jsonb, created_at timestamptz, author_pubkey text)`
- `constructions(content_id pk, operator text, profile_id text null, params_json jsonb, constraints_json jsonb, created_at timestamptz, author_pubkey text)`
- `construction_inputs(construction_id text references constructions(content_id) on delete cascade, input_idea_id text, role text null, ordinal int, primary key(construction_id, ordinal))`
- `construction_outputs(construction_id text references constructions(content_id) on delete cascade, output_idea_id text, primary key(construction_id))`
- `claims(content_id pk, about_type text check (about_type in ('idea','implementation')), about_id text, claim_text text, resolution_type text null, created_at timestamptz, author_pubkey text)`
- `evidence(content_id pk, claim_id text references claims(content_id) on delete cascade, stance text check (stance in ('supports','refutes')), locator text, excerpt_hash text null, created_at timestamptz, author_pubkey text)`
- `implementations(content_id pk, idea_id text references ideas(content_id), metadata_json jsonb, created_at timestamptz, author_pubkey text)`
- `profiles(content_id pk, weights_json jsonb, created_at timestamptz, author_pubkey text)`
- `edges(content_id pk, rel text, from_id text, to_id text, created_at timestamptz, author_pubkey text)` (optional but recommended)

Baseline indexes:
- `construction_inputs(input_idea_id)`
- `construction_outputs(output_idea_id)`
- `claims(about_id)`
- `evidence(claim_id)`
- `edges(rel, from_id, to_id)` (btree) + optional `gin` on `(rel, from_id)` for traversals.

### Constraints aligned with kernel invariants
- `construction_inputs.input_idea_id` must reference existing `ideas.content_id` (FK). 
- `construction_outputs.output_idea_id` must reference existing `ideas.content_id`.
- `implementations.idea_id` FK to `ideas.content_id` with `NOT NULL` (single-idea invariant).
- `claims.about_type/about_id` constrained via `check` + partial FKs:
  - `about_type='idea'` → FK to `ideas`.
  - `about_type='implementation'` → FK to `implementations`.
- `evidence.claim_id` FK to `claims` (enforces evidence-to-claim only).
- `construction_inputs.ordinal` unique per `construction_id` to keep stable ordering.

## Ingestion pipeline (write path)
1) **Source**: outbox rows produced by Module A3 uploads (`content_id`, canonical JSON, tx_id optional).
2) **Validation**: `validateSchema` + `validateInvariants` + `verifyObjectSignature` (A1/A2). Failures record `ingest_status='failed'` + `ingest_error`, but still insert raw row into `objects`.
3) **Raw insert**: upsert into `objects` by `content_id` (do nothing on conflict, but update `arweave_tx_id` if null and provided).
4) **Typed expansion** (only when validation succeeds): parse canonical JSON, insert into type-specific tables inside a single transaction; partial failures rollback typed inserts but leave `objects` row.
5) **Idempotency**: on conflict for typed tables, do nothing (content_id unique); pipeline can safely re-run.

Worker behavior:
- Poll `outbox` ordered by `created_at`, batch size configurable; skip rows already marked ingested.
- Backpressure friendly: run with max in-flight; exponential backoff on DB/Arweave errors.
- Structured logs with `content_id`, type, step, duration, result.

## Backfill / rebuild pipeline
- Input: Arweave search by tags (`wofi:type`, optional time windows); fetch payloads in batches.
- Checkpoint table: `backfill_checkpoints(source text, wofi_type text, cursor text, updated_at timestamptz)`.
- Per-object flow mirrors ingestion steps: validation → raw insert → typed expansion (idempotent).
- Resume logic: cursor holds last processed tx or block height; reruns are safe due to content-id conflicts.
- Parity target: starting from empty Postgres, backfill reaches same counts per type as Arweave dataset; mismatches logged and surfaced.

## Idempotency & referential safety
- All inserts keyed by `content_id`; typed tables use deterministic `content_id` from canonical payload.
- Process objects in topological-friendly order during backfill (Ideas → Constructions/Claims/Implementations → Evidence/Edges) to reduce FK failures; if FK fails (missing dependency), park row into `ingest_deferred(content_id, missing_ref, wofi_type, first_seen_at)` for retry once parents land.
- Optional `deferred` retry job scans `ingest_deferred` after each batch.

## Observability & admin
- Metrics: ingest successes/failures per `wofi_type`, ingest latency histogram, backfill throughput, deferred queue depth.
- Logs: structured JSON with `content_id`, `wofi_type`, `stage`, `tx_id`, `error_code` (when present).
- Admin SQL/CLI:
  - `npm run indexer:sync -- --from-outbox` (stream outbox → Postgres)
  - `npm run indexer:backfill -- --type wofi.idea.v1 --from 2025-01-01T00:00Z`
  - `npm run indexer:replay -- --content-id <id>` for a single object.

## Test plan (minimum)
- **Unit (parsers/validators)**: reject malformed JSON; invariant violations trigger `failed` status but raw row stored.
- **DB migration tests**: apply migrations to empty DB; ensure schema + constraints compile; foreign-key cascade/delete behaviors verified.
- **Ingestion integration**: fixture set of valid objects (Idea + Construction + Claim + Evidence + Implementation) → expect typed rows + FKs satisfied; second ingest is no-op (idempotent).
- **Failure paths**: invalid signature → `objects` row with `ingest_status='failed'`, no typed rows; missing referenced idea → row lands in `ingest_deferred`, succeeds after parent inserted.
- **Backfill**: stub Arweave client returning batch of mixed types; cursor saved and used on resume; rerun from same cursor leaves counts unchanged.
- **Content-id consistency**: ingest canonical JSON with different property order → single row by `content_id`.

## Deliverables
- New package `packages/indexer` exporting:
  - DB migrations (SQL) for raw + typed tables + indexes + enums + `ingest_deferred`/`backfill_checkpoints`.
  - Ingestion worker (outbox → Postgres typed tables) with CLI entrypoints noted above.
  - Backfill worker (Arweave → Postgres) with checkpointing and deferred retry support.
  - Shared types/interfaces for typed inserts derived from `@wofi/kernel` schemas.
- Documentation in `packages/indexer/README.md` covering config (`DATABASE_URL`, `ARWEAVE_GATEWAY`, batch sizes, concurrency), failure handling, and how to run sync/backfill locally.
- Update `plan/moduleA4plan.md` and `plan.md` status when implemented.
