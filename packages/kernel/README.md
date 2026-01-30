## @wofi/kernel

Kernel schema, canonicalization, `content_id` hashing, and invariant validation for WOFI v2.

### Commands

- `npm run build` — build TypeScript to `dist/`
- `npm run typecheck` — type-check without emitting
- `npm run test` — build then execute node-based tests (`node --test dist/test/**/*.js`)

### Public API

- `canonicalize(obj: unknown): Uint8Array` — JSON Canonicalization Scheme bytes
- `contentId(obj: unknown): string` — `sha256:<hex>` over canonical content bytes (computed after stripping transport fields)
- `getObjectType(obj: unknown): string` — returns `type` or throws `SCHEMA_INVALID`
- `validateSchema(obj: unknown): void` — JSON Schema validation for known kernel types
- `validateInvariants(obj: unknown, ctx?: ValidationContext): void` — kernel invariants (local + referential)
- `normalizePubkey(input: string | Uint8Array): string` — normalize pubkey to base64url (accepts hex/base64/base64url)
- `signObject(obj, privateKey): Signed<T>` — validates, ensures `created_at`, computes `content_id` if missing, and returns new object with `author` + `signature`
- `verifyObjectSignature(obj, opts?): void` — verifies Ed25519 signature (throws `SIGNATURE_MISSING` / `SIGNATURE_INVALID` / `AUTHOR_INVALID`; `allowUnsigned` bypasses)

### Signing usage

```ts
import { signObject, verifyObjectSignature } from '@wofi/kernel'

const privKey = Uint8Array.from([...Array(32).keys()]) // example only; load from secure source
const idea = { type: 'wofi.idea.v1', schema_version: '1.0', title: 'x', kind: 'concept', summary: '...', created_at: '2026-01-07T00:00:00Z' }

const signed = await signObject(idea, privKey)
await verifyObjectSignature(signed) // throws if invalid; pass { allowUnsigned: true } for dev/backfill
```

See `specs/001-high-moduleA1-kernel-schema-canonicalization.md` for detailed requirements.
