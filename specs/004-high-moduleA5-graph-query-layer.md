# Spec 004 — Module A5 Graph Query Layer (Postgres-first)
*Date: 2026-01-29*  
*Status: DRAFT*

## Scope
Provide graph-shaped, read-only query APIs backed by the Postgres mirror (Module A4), enforcing kernel invariants in response shape (especially evidence-only-under-claims). Focus on deterministic neighborhood and lineage traversal across Ideas and Constructions, plus a claim/evidence bundle API.

References: `plan/moduleA5plan.md`, `plan/moduleAplan.md`, `wofi_kernel_scheme_unified_v1.md`, `wofi_chat_decisions_2026-01-28.md`, `specs/003-high-moduleA4-postgres-mirror-indexer.md`.

## Goals (must)
- Serve graph reads from Postgres only (no Arweave reads in hot path).
- Hyperedge-aware traversal using `construction_inputs` and `construction_outputs` (Idea ↔ Construction ↔ Idea).
- Deterministic, stable ordering for nodes/edges so the same DB state returns identical results.
- Claim bundle API always nests Evidence under Claims; never attach Evidence directly to Ideas.
- Depth-limited traversal with pagination on nodes/edges and stable cursors.
- Profile-aware parameter accepted (`profile_id`) for forward compatibility (actual filtering happens in Module C).

## Non-goals / deferred
- Profile-specific active graph materialization (Module C).
- Search (text or vector), relevance ranking, or discovery UX.
- Authz, rate limits, multi-tenant filters (handled by API gateway module).
- Caching layer or denormalized materializations beyond minimal SQL views.

## API surface (initial)
These are data-layer functions and the corresponding REST read endpoints (API gateway will call these):

- `getIdea(id)` → `GET /ideas/:id`
- `getConstruction(id)` → `GET /constructions/:id`
- `getIdeaNeighborhood(id, depth, { profileId?, direction? })` → `GET /ideas/:id/neighborhood?depth=...&profile_id?=...&direction?=out|in|both`
- `getIdeaLineage(id, depth, { profileId?, direction })` (optional alias to neighborhood with direction)
- `getClaimBundle(targetId)` → `GET /targets/:id/claims` (target is Idea or Implementation)

## Response shapes (v1)
### Graph response
```
{
  "root": { "type": "idea", "id": "sha256:..." },
  "nodes": [
    { "type": "idea", "id": "sha256:...", "title": "...", "created_at": "..." },
    { "type": "construction", "id": "sha256:...", "operator": "compose", "created_at": "..." }
  ],
  "edges": [
    { "type": "input", "from": "idea:<id>", "to": "construction:<id>", "ordinal": 0, "role": null },
    { "type": "output", "from": "construction:<id>", "to": "idea:<id>" }
  ],
  "page": { "next_cursor": "...", "node_limit": 200, "edge_limit": 400 }
}
```
Notes:
- Nodes are typed by table (`idea`, `construction`).
- Edges are only `input` (idea → construction) and `output` (construction → idea) for A5.
- `from`/`to` are typed ids (`idea:<content_id>` or `construction:<content_id>`) to avoid collisions.

### Claim bundle response
```
{
  "target": { "type": "idea|implementation", "id": "sha256:..." },
  "claims": [
    {
      "id": "sha256:...",
      "claim_text": "...",
      "created_at": "...",
      "evidence": [
        { "id": "sha256:...", "stance": "supports|refutes", "locator": "...", "created_at": "..." }
      ]
    }
  ]
}
```
Constraint: Evidence is only present nested under its Claim. Never return evidence “attached to an idea” directly.

## Data model assumptions (from Module A4)
- `ideas`, `constructions`, `construction_inputs`, `construction_outputs` drive hyperedge traversal.
- `claims` and `evidence` tables support claim bundle responses.
- Optional `edges` table can be ignored in A5 unless used for metadata-only relations.

## Traversal semantics
- Hyperedge-aware expansion:
  - **Outward**: Idea → (construction_inputs by `input_idea_id`) → Construction → (construction_outputs) → Idea.
  - **Inward**: Idea → (construction_outputs by `output_idea_id`) → Construction → (construction_inputs) → Idea.
- `depth` counts hops across edges (Idea → Construction is one hop; Construction → Idea is another). Depth 0 returns just the root node.
- Direction:
  - `out`: only outward expansion.
  - `in`: only inward expansion.
  - `both`: union of in+out edges (dedupe nodes/edges by id).
- Deduplicate nodes and edges by their IDs in the final response; preserve deterministic ordering (see below).

## Deterministic ordering + pagination
- Stable ordering key: `(depth ASC, node_type ASC, created_at ASC, content_id ASC)` for nodes; `(depth ASC, edge_type ASC, from ASC, to ASC, ordinal ASC)` for edges.
- Pagination uses keyset cursors derived from the ordering key. Cursor encodes the last returned row’s ordering tuple.
- Node and edge pagination are independent; default limits: `node_limit=200`, `edge_limit=400` (configurable).

## Query strategy (Postgres)
- Recursive CTEs to expand the graph; one CTE for nodes and another for edges, or a single CTE with edge rows and derived node rows.
- Store a `path`/`visited` set in the CTE to prevent infinite cycles (array of typed IDs).
- Use indexes from Module A4 plus add:
  - `construction_inputs(construction_id)`
  - `construction_outputs(construction_id)`
  - `ideas(created_at)` and `constructions(created_at)` for ordering keys

## Error handling
- Return 404 if the root Idea/Construction/Target does not exist.
- Validate `depth` and `direction`; 400 on invalid params.

## Test plan (minimum)
- Neighborhood traversal returns deterministic node/edge order for same DB state.
- Depth 0 returns only the root node, no edges.
- Direction `out` vs `in` yields expected subgraph for a fixture with known constructions.
- Graph traversal does not introduce cycles on self-referential constructions.
- Claim bundle nests Evidence under Claims only and respects `about_type` constraints.
- Pagination cursors resume correctly without duplicates or gaps.

## Deliverables
- New package `packages/query` (name TBD) exporting typed query functions + SQL helpers.
- SQL view or helper query definitions for neighborhood traversal and claim bundle retrieval.
- API gateway integration notes in `packages/query/README.md` with examples.
- Update `plan/moduleA5plan.md` and `plan.md` status when implemented.
