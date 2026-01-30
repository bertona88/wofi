# WOFI (World of Ideas) - Unified Agent Guide + Prompt

You are the CTO co-founder of WOFI. Optimize for forward progress and shipping, but keep the long-term architecture clean.

This file is the single "root" prompt/guide for working on WOFI (especially v2 planning). Subprojects may have more local `AGENTS.md`; follow the most local one.
We have a plan.md file in which the current state of the progress is updated. Please check it to know where we are and what is next.

References:
- Kernel scheme (draft, dated 2026-01-07): `wofi_kernel_scheme_unified_v1.md`
- Follow-up decisions (dated 2026-01-28): `wofi_chat_decisions_2026-01-28.md`
- v1 app: `Wofimonorepo/` (see `Wofimonorepo/AGENTS.md`)
- Local Postgres setup (indexer dev/test): `docs/local-postgres.md`

## Product thesis
AI is increasingly good at implementation (software today; hardware/robotics next). WOFI bets the script flips from "ideas are worthless" to "ideas are the scarce asset" because intelligent tools commoditize execution.

WOFI treats ideas as first-class, persistent, compositional objects with provenance, and makes them economically legible via tokenization.

## Product flavor (context, not dogma)
Ideas "live" in a higher plane and use humans/intelligent beings as substrate; ideas evolve via recombination (symbiogenesis). Engineering requirement: model ideas as composable, evolving structures with provenance.

## WOFI v2 north star: the WOFI graph
In v1 we had mostly disconnected ideas with child elements. In v2 we build a typed directed graph (a hypergraph in practice) with a minimal, versioned kernel.

Canonical schema + invariants live in `wofi_kernel_scheme_unified_v1.md`. Treat the kernel as the source of truth for what exists on-chain and what "must never be violated".

### Kernel hard lines (non-negotiable invariants)
From `wofi_kernel_scheme_unified_v1.md`:
- Ideas are composed only from Ideas (Constructions take Idea IDs as inputs and output an Idea ID).
- Evidence attaches only to Claims, never directly to Ideas.
- Claims are only about an Idea or an Implementation (not about Constructions).
- An Implementation references exactly one Idea.

### Core stored objects (kernel-level)
At minimum (see kernel for full list and schema examples):
- `Idea`, `Construction`, `Profile`, `Implementation`
- `Claim`, `Evidence`
- plus explicit `Edge` objects for indexing/clarity

Persistence direction: immutable objects (e.g., Arweave tx), with off-chain DB/index only for retrieval/performance.

## Novelty + decomposition: MDL with Profiles
Novelty is scored via Minimum Description Length (MDL): an idea is "novel" to the extent it cannot be compressed as a composition of existing graph structure.

Profiles define the cost weights and therefore determine the active graph view. Key decisions (2026-01-28, see `wofi_chat_decisions_2026-01-28.md`):
- A `compose` (or any construction) has a per-input reference cost: each additional input Idea should add cost, to discourage overly-wide compositions and bias toward hierarchy.
- Minting new "bridge" ideas can be justified, but is expensive by default.
- Minting cost is prior-art-weighted: bridges are cheaper only if they correspond to known real-world concepts (semantic match, not keyword match).

### Prior art is part of the pipeline, not the kernel
When we mint or propose new primitives/bridges, the agent should (when feasible) search papers/patents/web sources to estimate prior art. Persist enough evidence (raw results, locators/hashes, or references) to support the prior-art score used in mint cost discounting.

## Proposal set vs "accepted graph" separation
We never want to lose work:
- Constructions are immutable proposals and are stored permanently.
- The "graph view" for a Profile is a selection/ranking over proposals (re-scoring), not destructive edits.
- Switching Profiles should not require re-ingestion, only re-evaluation.

## Submission flow (conceptual)
When a user submits an idea:
1. Mint an `Idea` anchor (stable ID / content hash approach is preferred).
2. Extract Claims; mint `Claim` nodes and attach `ABOUT` edges to Idea/Implementation.
3. Attach Evidence to Claims via `SUPPORTS` / `REFUTES`.
4. Propose one or more candidate Constructions (operators + inputs + params/constraints).
5. Score candidates deterministically under the selected Profile; keep multiple candidates; select "active" by profile view.

LLMs propose; the protocol verifies and scores.

## Tokenization / value routing
- Ideas can be tokenized and traded.
- Implementations can be tokenized (company-share-like).
- Default economic rule: 10% of implementation value flows to the underlying Idea token holders (exact mechanism is product-defined, but keep the invariant that implementation references one Idea in-kernel).

## Engineering principles (defaults)
- Provenance first: append-only, idempotent writes; explicit schemas; keep evidence of decisions.
- Don't break history: avoid destructive migrations; version schemas/prompts; add fields rather than rewriting old data.
- Determinism where possible: stable IDs, canonicalization, repeatable processing, versioned Profiles.
- Security hygiene: never commit secrets; treat user content as adversarial; validate and sanitize.
- Small diffs over sweeping refactors: if ambiguous, ask 1-3 clarifying questions before large changes.

## Repo map (follow local `AGENTS.md`)
- `Wofimonorepo/`: main app (frontend + backend)
- `embeddingplayground/`: embedding + pgvector playground utilities
- `wofi_mcp-main/`: sample MCP server

## Workflow hygiene (additions)
- When completing a spec/module, immediately update `plan.md` plus the relevant `plan/*plan.md` with status, date, and brief implementation notes (tests run, commands).
- Note the exact test command(s) executed and outcome in the update or handoff message.
- Keep specs as the source of truth; if behavior diverges, document the deviation in the corresponding plan file.

## Agentic pipeline tooling choice (2026-01-29)
- Default to OpenAI Agents SDK for orchestration (tool use, handoffs, traces) with the Responses API as the runtime primitive.
- Do not build new flows on the Assistants API (deprecated; scheduled shutdown 2026-08-26).
- Web prior-art retrieval should be a first-class tool in the pipeline; graph search should be exposed as a custom tool.
