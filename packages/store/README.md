## @wofi/store

Immutable kernel object store with a dev filesystem backend and an Arweave (Turbo) backend. Implements the Module A3 spec (`specs/002-high-moduleA3-immutable-object-store.md`).

### Commands

- `npm run build` — build TypeScript to `dist/`
- `npm run typecheck` — type-check without emitting
- `npm run test` — build then execute node-based tests (`node --test dist/test/**/*.js`)

### Usage

```ts
import { createObjectStore } from '@wofi/store'

const store = await createObjectStore() // defaults to dev backend
const result = await store.putObject(obj) // validates schema + invariants + signature
const loaded = await store.getObjectByContentId(result.content_id)
```

### Configuration

- `WOFI_STORE_BACKEND`: `dev` (default) or `arweave`
- `WOFI_STORE_ALLOW_UNSIGNED`: `true` to bypass signature verification (dev/backfill only)
- Arweave:
  - `ARWEAVE_JWK_PATH`: path to wallet JWK (required when backend=`arweave`)
  - `ARWEAVE_TURBO_URL`: Turbo upload endpoint (default `https://up.turbo.net`)
  - `ARWEAVE_GATEWAY_URL`: gateway for reads/GraphQL lookups (default `https://arweave.net`)

### Backends

- **DevObjectStore** — persists canonical JSON under `./devstore/objects/<content_id>.json` with `index.json` mapping `content_id -> tx_id`; idempotent by `content_id`.
- **ArweaveObjectStore** — uploads canonical JSON via `@ardrive/turbo-sdk`, tagging with `wofi:*` metadata; idempotent pre-flight check by `content_id` (cache + optional GraphQL lookup). Reads verify `content_id` hash before returning.

