# Local Postgres (WOFI Indexer) — Setup + Test URL

This captures the local Postgres setup used for indexer testing so we don't lose it.

## What we installed
- Homebrew `postgresql@16` (keg-only)
- `pgvector` extension (required for embeddings search)

## Start the database service
```bash
brew services start postgresql@16
```

## Create the local test database
```bash
/opt/homebrew/opt/postgresql@16/bin/createdb wofi_indexer_test
```

## Enable pgvector in the database
```bash
psql postgres://$(whoami)@localhost:5432/wofi_indexer_test -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

## Test connection URL
Use this for local dev/test:
```
postgres://$(whoami)@localhost:5432/wofi_indexer_test
```

## Indexer commands (examples)
```bash
DATABASE_URL=postgres://$(whoami)@localhost:5432/wofi_indexer_test npm run indexer:migrate
DATABASE_URL=postgres://$(whoami)@localhost:5432/wofi_indexer_test npm run indexer:seed
DATABASE_URL=postgres://$(whoami)@localhost:5432/wofi_indexer_test npm run indexer:sync -- --from-outbox
```

## Notes
- Postico 2 is just a client; it does not run Postgres.
- If you want `psql` in PATH, add:
  ```bash
  echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc
  ```
