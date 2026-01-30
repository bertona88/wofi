# Module A4 Plan — PostgreSQL Mirror + Indexer + Backfill
*Date: 2026-01-29*  
*Status: IMPLEMENTED (2026-01-29) — see `specs/003-high-moduleA4-postgres-mirror-indexer.md`.*

Scope: Module A4 from `[[plan/moduleAplan.md]]`.

Goal: maintain a fast, queryable mirror of all immutable objects plus typed tables for graph queries.

---

## Postgres schema (minimum)

1) `objects` (append-only audit + raw storage)
- `content_id` (pk)
- `wofi_type`
- `schema_version`
- `canonical_json` (text/jsonb)
- `created_at`
- `author_pubkey`
- `signature_json` (jsonb)
- `arweave_tx_id` (unique nullable)
- `ingested_at`
- `ingest_status` (`ok` | `failed`)
- `ingest_error` (text nullable)

2) Typed tables (query-optimized)
- `ideas`
- `constructions`
- `construction_inputs`
- `construction_outputs`
- `claims`
- `evidence`
- `submissions`
- `implementations`
- `profiles`
- `edges` (optional, but helpful)

Indexes (baseline):
- `objects(wofi_type, created_at)`
- `objects(arweave_tx_id)`
- `construction_inputs(input_idea_id)`
- `construction_outputs(output_idea_id)`
- `claims(about_id)`
- `evidence(claim_id)`

---

## Indexer pipeline

Write path (outbox pattern):
- `outbox(content_id, canonical_json, status, attempts, last_error, created_at, updated_at)`
- Worker:
  1) pull pending outbox rows
  2) write to Arweave via store (A3)
  3) update `objects.arweave_tx_id`
  4) ingest/expand into typed tables

Ingestion rules:
- Validate schema + invariants (A1) + signature (A2) before typed expansion.
- Always store raw into `objects`; mark `ingest_status` and error details.

---

## Backfill (rare but required)

Backfill job requirements:
- Can rebuild typed tables from Arweave tags:
  - query by `wofi:type` and optional time windows
  - fetch payloads
  - validate + insert into `objects`
  - expand typed tables
- Checkpointing:
  - `backfill_checkpoints(source, wofi_type, cursor, updated_at)`
- Resumable and idempotent:
  - keyed by `content_id`
  - safe to rerun without duplicating rows

Acceptance criteria:
- Starting from empty Postgres, backfill reaches parity with available Arweave dataset.
- Failures are logged with enough detail to debug and retry.

---

## Implementation notes (2026-01-29)

- Added `packages/indexer` with migrations, ingestion/backfill workers, and CLI entrypoints.
- Enforced schema + invariant + signature validation on ingest, with deferred retries for missing refs.
- Typed expansion writes to `ideas`, `constructions`, `claims`, `evidence`, `implementations`, `profiles`, and `edges` with idempotent inserts.
- Tests: not run (not executed in this environment).

Update (2026-01-30):
- Added `submissions` typed table + indexes, ingestion expansion, and backfill type for `wofi.submission.v1`.
- Tests: `npm -w @wofi/indexer test`.
