# Module A3 Plan — Immutable Object Store (Arweave + Dev Store)
*Date: 2026-01-29*  
*Status: IMPLEMENTED (2026-01-29) — see `specs/002-high-moduleA3-immutable-object-store.md`.*

Scope: Module A3 from `[[plan/moduleAplan.md]]`.

Goal: store and retrieve immutable kernel objects, with idempotent writes keyed by `content_id`.

---

## Notes

- Implemented `packages/store` with `ObjectStore` interface, `DevObjectStore`, `ArweaveObjectStore`, and `createObjectStore` factory.
- Write pipeline: validate schema + invariants, verify signature (unless `allowUnsigned`), compute `content_id`, persist canonical bytes; idempotent by `content_id`.
- Arweave backend uses Turbo client, required `wofi:*` tags, pre-flight idempotency lookup (cache/optional lookup fn/GraphQL), read path verifies hash.
- Dev backend stores canonical JSON under `devstore/objects/<content_id>.json` with `index.json` mapping to deterministic `tx_id`; read verifies hash.
- Tests executed: `npm test -w @wofi/store` (passes dev store round-trip/idempotency, unsigned rejection, corrupted payload mismatch, Arweave stub tags + idempotency + hash verification).
