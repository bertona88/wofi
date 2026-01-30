## @wofi/indexer

PostgreSQL mirror + indexer + backfill for immutable kernel objects (Module A4).

### Commands

- `npm run migrate` — apply SQL migrations
- `npm run sync -- --from-outbox` — ingest from `outbox` into typed tables
- `npm run backfill -- --type wofi.idea.v1 --from 2025-01-01T00:00:Z` — Arweave backfill
- `npm run replay -- --content-id sha256:...` — re-run typed expansion for a single object
- `npm run seed` — insert a small local test graph (unsigned objects)

### Configuration

- `DATABASE_URL` (required)
- `ARWEAVE_GATEWAY_URL` (default `https://arweave.net`)
- `WOFI_INDEXER_ALLOW_UNSIGNED` (`true` to skip signature checks)
- `WOFI_INDEXER_BATCH_SIZE` (default `50`)
- `WOFI_INDEXER_CONCURRENCY` (default `1`)
- `WOFI_INDEXER_MIGRATIONS_DIR` (override migrations path)

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
