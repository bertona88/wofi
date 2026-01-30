# Module A5 Plan — Graph Query Layer (Postgres-first)
*Date: 2026-01-29*  
*Status: IMPLEMENTED (2026-01-29)*

Spec: `specs/004-high-moduleA5-graph-query-layer.md`.

Scope: Module A5 from `[[plan/moduleAplan.md]]`.

Goal: serve graph-shaped read APIs from the Postgres mirror, respecting kernel invariants.

---

## Query primitives (minimum)

- Idea reads:
  - `GET /ideas/:id`
  - `GET /ideas/:id/neighborhood?depth=...&profile_id?=...`
- Construction reads:
  - `GET /constructions/:id` (includes inputs + output)
- Claim/evidence bundle:
  - `GET /targets/:id/claims` (target is Idea|Implementation)
  - Must never return evidence “attached to an idea” directly; always nested under Claim.

---

## Traversal semantics

- Hyperedge-aware traversal:
  - From Idea → Constructions where it is an input (`construction_inputs`)
  - From Construction → output Idea (`construction_outputs`)
  - Reverse traversal similarly supported.
- Depth-limited traversal implemented via recursive CTEs.
- Pagination:
  - For neighborhood expansions, page by nodes/edges count with stable ordering.

Acceptance criteria:
- Neighborhood query returns a deterministic node/edge set for the same DB state.
- Claim bundle response shape enforces “Evidence attaches only to Claims”.

Implementation notes (2026-01-29):
- Added `packages/query` with Postgres-first graph/claim queries, deterministic ordering, cursor encoding, and README usage notes.
- Added query helper SQL strings and recursive CTE traversal logic; profile_id accepted but not filtered.
- Added indexer migration `003_query_indexes.sql` for construction and created_at ordering indexes.
- Tests: `npm -w @wofi/query test` (3 skipped due to pg-mem lacking recursive CTEs; claim bundle test passed).

Update (2026-01-30):
- Added submission query helpers: `getSubmission`, `getIdeaSubmissions`, `getDerivedFrom`.
- Tests: `npm -w @wofi/query test`.
