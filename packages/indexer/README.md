## @wofi/indexer

PostgreSQL mirror + indexer + backfill for immutable kernel objects (Module A4).

### Commands

- `npm run migrate` — apply SQL migrations
- `npm run sync -- --from-outbox` — ingest from `outbox` into typed tables
- `npm run backfill -- --type wofi.idea.v1 --from 2025-01-01T00:00:Z` — Arweave backfill
- `npm run replay -- --content-id sha256:...` — re-run typed expansion for a single object
- `npm run seed` — insert a small local test graph (unsigned objects)
- `npm run embed -- --watch` — process embedding jobs (pgvector)
- `npm run decompose -- --watch` — process decomposition jobs (noop worker)

### Configuration

- `DATABASE_URL` (required)
- `ARWEAVE_GATEWAY_URL` (default `https://arweave.net`)
- `WOFI_INDEXER_ALLOW_UNSIGNED` (`true` to skip signature checks)
- `WOFI_INDEXER_BATCH_SIZE` (default `50`)
- `WOFI_INDEXER_CONCURRENCY` (default `1`)
- `WOFI_INDEXER_MIGRATIONS_DIR` (override migrations path)
- `WOFI_INDEXER_SKIP_PGVECTOR` (`true` to skip pgvector migration, useful in tests)
- `OPENAI_API_KEY` or `WOFI_OPENAI_API_KEY` (required for embeddings)
- `WOFI_EMBEDDING_MODEL` (default `text-embedding-3-small`)
- `WOFI_EMBEDDING_DIMENSIONS` (default `1536`)
- `WOFI_EMBEDDING_MAX_CHARS` (default `8000`)
- `WOFI_EMBEDDING_BATCH_SIZE` (default `1`)
- `WOFI_EMBEDDING_IDLE_MS` (default `1000`)
- `WOFI_EMBEDDING_WORKER_ID` (default hostname)
- `WOFI_DECOMPOSITION_BATCH_SIZE` (default `1`)
- `WOFI_DECOMPOSITION_IDLE_MS` (default `1000`)
- `WOFI_DECOMPOSITION_WORKER_ID` (default hostname)

### Outbox expectation

The sync worker expects an `outbox` table with at least:
- `content_id` (text)
- `canonical_json` (json/jsonb)
- `arweave_tx_id` or `tx_id` (text, nullable)
- `status` (text)
- `attempts` (int)
- `last_error` (text)
- `created_at` / `updated_at` (timestamptz)

### Notes

- Objects are always mirrored into the `objects` table, even when validation fails.
- Typed expansion is idempotent (`ON CONFLICT DO NOTHING`).
- Missing dependencies land in `ingest_deferred` and are retried automatically after batches.

### Development

```
npm -w @wofi/indexer run migrate
npm -w @wofi/indexer run seed
npm -w @wofi/indexer run sync -- --from-outbox
```
