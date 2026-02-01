# Plan — Let’s First Build The Agent Tools (WOFI v2)
*Date: 2026-01-31*  
*Status: DRAFT (planning, partial implementation)*

Goal: ship the **minimum tool surface** required to run the Module B pipelines (intake + decomposition) using the **OpenAI Agents SDK** as “normal” function tools first, with a clean path to **MCP** wrappers later.

This plan is intentionally tool-first: agents become “prompted orchestrators” over deterministic, kernel-enforcing primitives.

Related plans:
- `planB/moduleB6plan.md` (intake agent)
- `planB/moduleB9plan.md` (decomposition agents)
- `planB/moduleB8plan.md` (evidence attachment)
- `planB/moduleB10plan.md` (prior-art retrieval artifacts)

---

## Decision (v0)

### Build “normal” tools first (Agents SDK `tool()`)
Rationale: fastest iteration, simplest deployment, easiest to enforce kernel invariants and idempotency.

### Design so they can become MCP tools later
Implementation rule: put all business logic in a **pure domain layer** (no Agents SDK types), then wrap it:
- Wrapper A: Agents SDK `tool()` for in-process agents.
- Wrapper B: MCP server endpoints for cross-process / cross-language tool access.

---

## Tool surface (minimum viable)

### 1) Read tools (internal retrieval)
Backed by `@wofi/query`.

- `wofi.get_idea(idea_id)` — DONE ✅
- `wofi.get_construction(construction_id)` — DONE ✅
- `wofi.get_claim_bundle(target_id)` (Idea|Implementation) — DONE ✅
- `wofi.get_submission(submission_id)` (useful for provenance + decomposition inputs) — DONE ✅
- `wofi.search_ideas(query, k, filters?)` *(implemented: hybrid text + vector)* — DONE ✅

### 2) Write tools (mint + link)
Backed by `@wofi/kernel` + `@wofi/store` + `@wofi/indexer`.

Minting (idempotent by `content_id`):
- `wofi.mint_idea(idea_draft)` — DONE ✅
- `wofi.mint_submission(conversation_export, metadata)` — DONE ✅
- `wofi.mint_claim(claim)` — DONE ✅
- `wofi.mint_evidence(evidence)` — DONE ✅
- `wofi.mint_construction(construction)` — DONE ✅
- `wofi.link_edge(rel, from_id, to_id, meta?)` → `wofi.edge.v1` — DONE ✅

Non-negotiables:
- Validate schema + invariants before writing.
- Enforce kernel hard lines (e.g., evidence attaches only to claims).
- Make writes idempotent, returning `{ content_id, tx_id, already_existed }`.
- v0: allow unsigned objects (skip signatures).
- Write tools should look up referenced IDs before minting/linking to avoid deferred ingest.

### 3) Job tools (async queue)
- `decomposition.enqueue(idea_id, profile_id, opts?)` — DONE ✅
  - v0 can be “DB table + poller”; doesn’t need a full queue product yet.

### 4) External retrieval tools
Use Agents SDK hosted tool(s) where possible:
- `web_search` (hosted) for intake novelty checks + prior-art discovery

Open question: do we need a first-party page fetch/snapshot tool in v0, or can Evidence store locators only?

---

## Packaging / repo layout (proposal)

Create a new workspace package:
- `packages/agent-tools/` — exports:
  - Zod schemas for tool args/results (TODO; v0 uses lightweight runtime checks)
  - domain services (pure functions)
  - Agents SDK tool wrappers (`tool({ ... })`) — DONE ✅

Keep MCP as a later wrapper:
- Option A: `packages/mcp-wofi/` (preferred if we want “official” server)
- Option B: extend `wofi_mcp-main/` (fine for prototyping)

---

## Milestones

### Milestone 0 — Define contracts 
- Finalize tool names + Zod schemas (inputs + outputs).
- Decide “conversation_export” payload format for `wofi.submission.v1` (minimal v0).
- Decide idempotency rules for duplicate ideas:  reject

### Milestone 1 — Write tools: mint + link (core)
- Implement `mint_*` and `link_edge` by composing:
  - `@wofi/kernel` canonicalize/contentId/validate
  - `@wofi/store.putObject`
  - `@wofi/indexer.ingestObject`
- Add “transaction-like” helper for a multi-write flow:
  - intake acceptance: `mint_submission` → `mint_idea` → `link SUBMITTED_AS` → `enqueue decomposition`
  - Status: `mint_*` + `link_edge` implemented in `packages/agent-tools/src/write.ts` (unsigned v0, lookup-first). — DONE ✅
  - Pending: multi-write helper.

### Milestone 2 — Read tools: query wrappers (core)
- Implement wrappers around `@wofi/query` primitives.
- Add a v0 `search_ideas`: Postgres `ILIKE` on title/summary/tags + embedding similarity (pgvector). — DONE ✅
- Embedding pipeline: `embedding_jobs` queue + worker writes `idea_embeddings` (3072-dim, `text-embedding-3-large`).
  - Implemented in `packages/agent-tools/src/read.ts` (hybrid text + vector). — DONE ✅
  - Implemented `get_idea`, `get_construction`, `get_claim_bundle`, `get_submission` wrappers in `packages/agent-tools/src/read.ts`. — DONE ✅

### Milestone 3 — Job tools: decomposition queue (stub but real)
- Add a minimal `decomposition_jobs` table and enqueue tool. — DONE ✅
- Add a worker stub that logs + marks jobs claimed/done (no LLM yet). — DONE ✅

### Milestone 4 — Smoke-run CLI
- Add a simple CLI script that:
  - creates a fake conversation export
  - mints submission+idea+edge
  - enqueues decomposition
  - reads back via query tools

---

## Implementation notes (2026-01-31)
- Implemented `searchIdeas` in `packages/agent-tools/src/read.ts` as hybrid text (ILIKE) + pgvector search with OpenAI `text-embedding-3-large` (3072-dim).
- Added search input/result types in `packages/agent-tools/src/types.ts` and dependencies in `packages/agent-tools/package.json`.
- Fixed `@wofi/store` package entry points so TypeScript resolves its types.
- Tests (reported): `npm -w @wofi/indexer test`, `npm -w @wofi/query test`, `npm -w @wofi/agent-tools test` (pg-mem; recursive CTE tests skipped).
- Implemented Agents SDK tool wrappers in `packages/agent-tools/src/agents.ts` (uses `zod` schemas + `tool()` factory injection).
- Added read tool wrappers for `get_idea`, `get_construction`, `get_claim_bundle`, `get_submission` plus tool schemas in `packages/agent-tools/src/read.ts` + `packages/agent-tools/src/agents.ts`.
- Fixed agent-tools tool schema typing for `exactOptionalPropertyTypes` and optional claim bundle target handling.
- Added decomposition queue: migration + indexer enqueue/worker + agent tool (`decomposition.enqueue`).
- Added prototype intake agent runner (`packages/agent-tools/src/prototype-agent.ts`) using the Agents SDK.
- Tests (this update): `npm -w @wofi/indexer test`, `npm -w @wofi/agent-tools test`.

## Guardrails + approvals (agent runtime)

Decisions to make:
- Which tools require HITL approval in alpha?
  - likely anything that mints on-chain/prod store, or triggers broad web search.
- Which tools should be disabled conditionally?
  - e.g. `mint_*` disabled unless state is “Final draft confirmed”.

---

## Acceptance criteria (for “tools are ready”)

- A single Node process can run:
  - `mint_submission`, `mint_idea`, `link_edge(SUBMITTED_AS)`, `decomposition.enqueue`
  - then read back the objects from Postgres via query wrappers
- Writes are idempotent and invariant-safe.
- Tool interfaces are strict (Zod) and stable enough for agents to target.

---

Notes:
- `packages/agent-tools` lives inside this repo’s `packages/`.
- `decomposition.enqueue` should live in `@wofi/indexer` (DB-first).
