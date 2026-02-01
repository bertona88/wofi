# WOFI 2.0 — Module Plan
*Date: 2026-01-29*

Current state: Module A1 kernel package implemented and tested (`@wofi/kernel`); Module A2 signing/identity implemented and tested in `@wofi/kernel`; Module A3 immutable object store implemented and tested (`@wofi/store`); Module A4 Postgres mirror/indexer implemented (`@wofi/indexer`). Remaining modules still in planning.

Specs (work queue):
- ~~`specs/001-high-moduleA1-kernel-schema-canonicalization.md` (Module A1)~~ **DONE 2026-01-29**
- ~~`specs/002-high-moduleA3-immutable-object-store.md` (Module A3)~~ **DONE 2026-01-29**
- ~~`specs/003-high-moduleA4-postgres-mirror-indexer.md` (Module A4)~~ **DONE 2026-01-29**
- ~~`specs/004-high-moduleA5-graph-query-layer.md` (Module A5)~~ **DONE 2026-01-29**

Implementation notes (2026-01-29):
- Added `packages/indexer` (migrations, ingestion/backfill workers, CLI scripts).
- Added `packages/query` (graph traversal + claim bundle queries, SQL helpers, deterministic cursor pagination).
- Added indexer migration for query-layer indexes.
- Tests: `npm -w @wofi/query test` (3 skipped: pg-mem lacks recursive CTEs; claim bundle test passed).
- Workspace tests: `npm test` (runs @wofi/indexer/kernel/query/store) — all passed; query has 3 skips due to pg-mem recursive CTEs.
- Postgres sanity pass: `getIdeaNeighborhood` + `getClaimBundle` against local Postgres after seeding; fixed recursive CTE (single-walk LATERAL) and added explicit cursor parameter casts; added `indexer:seed` helper.
- Postgres test run: `DATABASE_URL=postgres://$(whoami)@localhost:5432/wofi_indexer_test npm -w @wofi/query test` — all Postgres-backed query tests passed (pg-mem recursion tests still skipped).

Implementation notes (2026-01-30):
- Added kernel `Submission` object (`wofi.submission.v1`) and edge rels `SUBMITTED_AS` / `DERIVED_FROM` with schema + invariants.
- Indexer: submissions table + ingest expansion + backfill type; Query: submission helpers + tests.
- Tests: `npm -w @wofi/kernel test`, `npm -w @wofi/indexer test`, `npm -w @wofi/query test`.

Planning notes (2026-01-31):
- Refined Module B (“Ingestion + proposal generation”) into subplans in `planB/`, grounded in `idea pipeline.md`, `idea_pipeline_v_0.md`, and `how_decomposition_works.md`.
- Tests: n/a (planning-only change).

Implementation notes (2026-01-31):
- Added pgvector embedding pipeline: `embedding_jobs` + `idea_embeddings` migration, indexer worker, and query `searchIdeasByEmbedding` helper.
- Added indexer CLI `embed` + embedding env config, plus test skip for pgvector migration in pg-mem.
- Implemented agent-tools `searchIdeas` (hybrid text + vector) using OpenAI `text-embedding-3-large`.
- Tests: `npm -w @wofi/indexer test`, `npm -w @wofi/query test`, `npm -w @wofi/agent-tools test` (pg-mem; recursive CTE tests skipped).
- Added agent-tools read wrappers + tool schemas for `get_idea`, `get_construction`, `get_claim_bundle`, `get_submission`.
- Fixed agent-tools tool schema typing for `exactOptionalPropertyTypes` and optional claim bundle target handling.
- Added decomposition queue: migration + indexer enqueue/worker + agent tool (`decomposition.enqueue`).
- Added prototype intake agent runner (`packages/agent-tools/src/prototype-agent.ts`) using the Agents SDK.
- Tests (this update): `npm -w @wofi/indexer test`, `npm -w @wofi/agent-tools test`.

Implementation notes (2026-02-01):
- Added `@wofi/intake-agent` package with OpenAI Conversations-backed state, draft persistence, and explicit `conversation.stop` tooling.
- Intake agent wraps `wofi.mint_submission` / `wofi.mint_idea` to enforce one-submission-per-conversation and to store submission/idea IDs in conversation metadata.
- Added local draft store (`devstore/intake-drafts` by default) keyed by conversation id and draft revision.
- Tests: `npm -w @wofi/intake-agent run build`

Goal: enumerate the major software modules for WOFI 2.0 (kernel-aligned, proposal-set first, profile-based views).

References:
- [[wofi_kernel_scheme_unified_v1.md]] (kernel invariants + object types)
- [[wofi_chat_decisions_2026-01-28.md]] (MDL costs, hierarchy bias, prior art, profile views)
- [[plan/moduleAplan.md]] (concrete stack + Arweave sync/backfill plan for Module A)

---

## Kernel-aligned hard lines (must be enforced everywhere)

- Ideas are composed only from Ideas (Constructions take Idea IDs; output an Idea ID).
- Evidence attaches only to Claims (never directly to Ideas).
- Claims are only about an Idea or an Implementation (never about a Construction).
- An Implementation references exactly one Idea.

---

## Module list (v2.0)

### A) Kernel + persistence

1) **Kernel Schema + Canonicalization**
   - Owns: JSON schema versions, canonicalization rules, `content_id` hashing, invariants.
   - Exposes: `canonicalize(obj)`, `contentId(obj)`, `validate(obj)`.

2) **Signing + Identity Primitives**
   - Owns: author identity model (pubkeys), object signing format, signature verification.
   - Exposes: `sign(obj)`, `verify(obj, sig)`.

3) **Immutable Object Store (On-chain + Dev Store)**
   - Owns: write/read of kernel objects as immutable blobs (Arweave in prod; local FS/minio in dev).
   - Exposes: `put(obj) -> tx_id`, `get(id) -> obj`, `has(id)`.

4) **Indexer + Relational Mirror**
   - Owns: off-chain DB/index for retrieval/performance (append-only ingestion of stored objects).
   - Stores: typed tables for `Idea`, `Construction`, `Claim`, `Evidence`, `Implementation`, `Profile`, `Edge`.

5) **Graph Query Layer**
   - Owns: graph traversal queries (subgraph expansion, lineage/provenance views, neighborhood fetch).
   - Exposes: `getIdeaGraph(idea_id, depth, profile_id?)`, `getClaimBundle(target_id)`.

---

### B) Ingestion + proposal generation

Refined subplans (2026-01-31):
- `[[planB/moduleBplan.md]]` — overview + cross-cutting constraints
- `[[planB/moduleB6plan.md]]` — Submission API + normalization (intake agent)
- `[[planB/moduleB7plan.md]]` — Claim extraction
- `[[planB/moduleB8plan.md]]` — Evidence attachment pipeline
- `[[planB/moduleB9plan.md]]` — Construction proposal generator (decomposition agents)
- `[[planB/moduleB10plan.md]]` — Prior-art retrieval + scoring artifacts

Notes:
- These plans are grounded in `[[idea pipeline.md]]`, `[[idea_pipeline_v_0.md]]`, and `[[how_decomposition_works.md]]`.
- Agent runtime choice: use `external/openai-agents-js/` patterns and docs (Agents SDK + Responses API + Conversation API).

---

### C) Scoring + profile-based views

11) **Profile Manager**
   - Owns: `Profile` objects (weight sets, cost curves, operator costs, per-input reference cost).
   - Exposes: `getProfile(profile_id)`, `listProfiles()`, `diffProfiles(a,b)`.

12) **MDL / Description-Length Scoring Engine**
   - Owns: deterministic scoring for candidate Constructions under a Profile:
     - operator cost
     - per-input reference cost (hierarchy bias)
     - params/constraints cost
     - residual cost
     - minting cost (prior-art weighted)
   - Exposes: `score(construction_id, profile_id) -> score_breakdown`.

13) **Active Graph View Materializer**
   - Owns: selecting the “active” decompositions per profile (view over proposal set).
   - Output: per-profile active edge sets + cached materializations for fast UI queries.

14) **Re-scoring / Re-evaluation Jobs**
   - Owns: recomputing scores and active views when profiles change (no re-ingestion required).

---

### D) Search + retrieval UX primitives

15) **Semantic Search + Similarity**
   - Owns: embedding generation, vector index, semantic match for “similar ideas” and prior-art retrieval.
   - Notes: must support semantic (not keyword) matching for prior-art.

16) **Provenance + Diff Viewer**
   - Owns: explainability surfaces: why an Idea is considered novel (score breakdown, chosen decompositions).
   - Output: “why this decomposition” and “what changed across profiles” views.

---

### E) Implementations + economics

17) **Implementation Registry**
   - Owns: `Implementation` objects (each references exactly one Idea), metadata, status, links.
   - Output: `IMPLEMENTS` edges + implementation-specific Claims.

18) **Tokenization + Value Routing**
   - Owns: idea tokens, implementation tokens, value routing rules (e.g., % flows to Idea holders).
   - Notes: keep kernel invariant (Implementation -> exactly one Idea).

19) **Claim Markets (Optional Kernel Extension)**
   - Owns: claim tokenization/markets (if enabled), resolution criteria plumbing, payouts.
   - Output: `ClaimMarket` objects + market events.

20) **Attestations (Optional Kernel Extension)**
   - Owns: signed opinions/ratings about Claims/Evidence (credibility plumbing).

---

### F) Product surfaces

21) **Core API Gateway**
   - Owns: public API surface (read/write), pagination, auth, rate limits, versioning.
   - Notes: avoid “delete”; prefer superseding via new immutable objects.

22) **Web App (Graph UI)**
   - Owns: Idea submission, graph exploration, claim/evidence views, profile switching, provenance UI.

23) **Admin + Moderation**
   - Owns: anti-spam controls, abuse reporting, content flags, quarantine workflows (off-chain).

---

### G) Operations + developer experience

24) **Jobs + Orchestration**
   - Owns: background processing (extraction, scoring, indexing, re-scoring), retries, idempotency keys.

25) **Observability**
   - Owns: structured logs, metrics, tracing, audit events for object ingestion and scoring decisions.

26) **Security + Key Management**
   - Owns: signing keys, secrets handling, permission model, request validation, provenance integrity.

27) **SDKs + Integrations (incl. MCP)**
   - Owns: typed client SDKs, webhook/event stream, MCP server(s) for “WOFI-aware” agents.

---

## Suggested build order (phases)

### Phase 0 — Local end-to-end (no on-chain)
1) Kernel Schema + Canonicalization
2) Dev Object Store + Indexer + Query Layer
3) Submission API + Claim/Construction proposal generation (store all candidates)
4) Profile Manager + Scoring Engine + Active View materialization
5) Basic Web App: submit + explore + “why this score”

### Phase 1 — Prior art + credibility
6) Prior-Art Retrieval + persisted artifacts
7) Evidence attachment UX + claim bundles
8) Attestations (optional) + credibility surfaces

### Phase 2 — Economics + on-chain
9) Arweave Object Store (prod)
10) Implementation Registry (single-idea invariant) + tokenization/value routing
11) Claim markets (optional)
