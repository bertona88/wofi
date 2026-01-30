# Spec 002 — Module A3 Immutable Object Store (Arweave + Dev)
*Date: 2026-01-29*  
*Status: SPEC — implementation pending*

## Scope
Provide a single storage layer for immutable kernel objects. Writes are idempotent by `content_id`; reads are addressable by `content_id` and by on-chain transaction id. Targets Arweave in production, filesystem/dev store locally, behind one interface.

References: `plan/moduleA3plan.md`, `plan/moduleAplan.md`, `wofi_kernel_scheme_unified_v1.md`, `plan/moduleA1plan.md`, `plan/moduleA2plan.md`.

## Goals (must)
- Deterministically persist the exact canonical bytes hashed in A1; re-fetch + hash yields identical `content_id`.
- Enforce provenance: schema + invariants + signature verification (A2) on write unless explicitly bypassed for controlled backfill/dev.
- Idempotent writes keyed by `content_id`; duplicate writes return the first tx_id without mutation.
- Tag every stored object with minimal retrieval metadata to power backfill/windowed queries.
- Provide a drop-in dev store with the same interface/signature as the Arweave store.

## Out of scope (for A3)
- Key management/HSM, multi-signer rotation (defer to later security module).
- Encryption at rest (Arweave is public); private payload support deferred.
- Chunked uploads for very large payloads (>1MB) — assume kernel objects stay <256KB.

## Interface (stable contract)
Types are in `@wofi/kernel` + local storage types.

```ts
type StoredObject = unknown // validated kernel object
type PutResult = { content_id: string; tx_id: string; already_existed: boolean }

interface ObjectStore {
  putObject(obj: StoredObject, opts?: { allowUnsigned?: boolean }): Promise<PutResult>
  getObjectByContentId(id: string): Promise<StoredObject | null>
  getObjectByTxId(txId: string): Promise<StoredObject | null>
  hasContentId(id: string): Promise<boolean>
}
```

### Write pipeline (required order)
1. `validateSchema` (A1)  
2. `validateInvariants` (A1)  
3. `verifyObjectSignature` (A2) unless `allowUnsigned` is true (dev/backfill only)  
4. `contentId(obj)` (A1) — must match existing `content_id` if present; else set it  
5. Persist canonical JSON bytes (JCS) with tags

### Idempotency rules
- Key = `content_id`. If exists, return stored `tx_id` and `already_existed=true`. Do **not** overwrite payload or tags.
- Two different signatures on same `content_id` are allowed (content identical); store latest signature alongside? **Kernel invariant**: payload is immutable; therefore store only the first payload; rely on higher layer to audit multiple signatures (not in scope for A3).

## Arweave store design (prod)
- Library: `@ardrive/turbo-sdk` with `ArweaveSigner` (JWK).  
- Payload: canonical UTF-8 bytes of the content object (transport fields stripped in hashing, but payload keeps author/signature/content_id intact as written).  
- Tags (all string):  
  - `wofi:type` (e.g., `wofi.idea.v1`)  
  - `wofi:schema_version` (e.g., `1.0`)  
  - `wofi:content_id` (sha256:...)  
  - `wofi:created_at` (ISO8601)  
  - `wofi:author` (base64url pubkey)  
  - `wofi:profile_id` (optional, when present in object)  
  - `Content-Type: application/json`  
- Endpoint shape (service): `POST /upload` body `{ object }` returns `{ tx_id, content_id }`. Service is stateless; signer comes from env.  
- Pre-flight check: query Arweave (or local LRU cache) for `wofi:content_id` tag; if found, short-circuit with existing `tx_id`.  
- After upload: return Turbo transaction id as `tx_id`.

### Arweave read paths
- `getObjectByContentId`: query by `wofi:content_id` tag; fetch data; parse JSON.  
- `getObjectByTxId`: fetch tx by id; parse JSON; recompute `content_id` for verification.  
- Every read should verify `content_id` matches payload before returning.

## Dev store design (local)
- Location: `./devstore/objects/<content_id>.json` (canonical JSON payload).  
- Index: `./devstore/index.json` mapping `content_id -> tx_id` (tx_id can be deterministic UUID or incremental).  
- Same interface as Arweave store; no network.  
- Reads verify `content_id` before returning.

## Configuration
- `WOFI_STORE_BACKEND`: `arweave` | `dev` (default `dev` for local).  
- Arweave: `ARWEAVE_JWK_PATH`, `ARWEAVE_TURBO_URL` (default `https://up.turbo.net`)  
- Optional: `WOFI_STORE_ALLOW_UNSIGNED=true` for trusted backfill/dev.

## Error model
- Validation errors bubble from A1/A2 (`SCHEMA_INVALID`, `INVARIANT_VIOLATION`, `SIGNATURE_*`, `AUTHOR_INVALID`).  
- Store errors: `STORE_PUT_FAILED`, `STORE_FETCH_FAILED`, `STORE_ID_MISMATCH` (content hash mismatch on read).  
- All errors must include `content_id` when known.

## Observability
- Structured logs per write/read with `content_id`, `tx_id`, `wofi:type`, duration, backend (`dev|arweave`), result (`ok|already_existed|error`).  
- Metrics: counters for writes, cache hits, idempotent hits, failures; histogram for upload latency.

## Test plan (minimum)
- Unit (dev store):  
  - write → read round-trip keeps `content_id`; double write idempotent; `hasContentId` true.  
  - unsigned write rejected unless `allowUnsigned`.  
  - corrupted on-disk payload triggers `STORE_ID_MISMATCH`.  
- Integration (Arweave mock or stub):  
  - Stub Turbo client to capture payload + tags; assert required tags present.  
  - Idempotent re-upload returns first `tx_id`.  
  - Read path verifies hash.  
- Fixture: reuse A1/A2 golden idea with known `content_id`; assert tags.

## Deliverables
- `packages/store` (new) exporting `ObjectStore` interface and two implementations: `ArweaveObjectStore`, `DevObjectStore`, plus factory `createObjectStore(config)`.  
- Tests under `packages/store/test` covering dev backend; Arweave client stubbed.  
- README section documenting env config and usage examples.  
- Update `plan/moduleA3plan.md` and `plan.md` status once implemented.
