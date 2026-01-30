# @wofi/query — Graph Query Layer (Postgres-first)

This package provides read-only graph queries for the WOFI Postgres mirror (Module A4).
It exposes typed data-layer functions and SQL helper strings for neighborhood traversal
and claim bundles. All reads are Postgres-first; no Arweave reads in the hot path.

## Install / build (workspace)

```sh
npm -w @wofi/query run build
```

## Usage (API gateway integration sketch)

```ts
import { createPool } from '@wofi/query'
import { getIdea, getIdeaNeighborhood, getClaimBundle } from '@wofi/query'

const pool = createPool(process.env.DATABASE_URL!)

const idea = await getIdea(pool, 'sha256:...')
const graph = await getIdeaNeighborhood(pool, 'sha256:...', {
  depth: 2,
  direction: 'both',
  nodeLimit: 200,
  edgeLimit: 400
})

const claims = await getClaimBundle(pool, 'sha256:...')
```

## SQL helpers

The SQL strings exported from `@wofi/query` are intended for inspection or reuse in
API-layer adapters. They include the recursive CTE for neighborhood traversal and
the ordering keys required for deterministic pagination.

- `NEIGHBORHOOD_WALK_CTE`
- `NEIGHBORHOOD_NODES_SQL`
- `NEIGHBORHOOD_EDGES_SQL`
- `CLAIM_BUNDLE_SQL`

## Response invariants

- Evidence is **only** returned nested under its Claim.
- Graph nodes and edges are deterministically ordered.
- Hyperedge traversal is implemented via `construction_inputs` and `construction_outputs`.

