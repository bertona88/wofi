# Module B9 Plan — Construction Proposal Generator (Decomposition Agents)
*Date: 2026-01-31*  
*Status: DONE (candidate grouping + budget cap implemented, 2026-02-03)*

Scope: Module **9** from `plan.md` (“Construction Proposal Generator”).

Primary reference: `[[how_decomposition_works.md]]` (normative workflow).

Goal: for a newly accepted `Idea`, propose and persist multiple candidate `Construction`s that:
- explain the idea structurally via operators (`compose`, `specialize`, `generalize`, `analogize`, `bundle`, `refine`)
- are hierarchical by default (avoid flat decompositions)
- store *all* candidates (proposal set first)

---

## Job model (async)

Trigger: `decomposition.enqueue(idea_id, profile_id)` from Module B6.

Execution:
- background worker pulls queue items and runs decomposition workflow
- each job writes kernel objects via `@wofi/kernel` + `@wofi/store` + `@wofi/indexer`

---

## Agentic architecture (Agents SDK)

### Agents
- `DecompositionAgent` (primary): produces candidate decompositions.
- `RetrievalAgent` (optional): specialized on “find reusable building blocks in WOFI” (graph search).
- `StopPointAgent` (optional): specialized on deciding when to stop and drafting stop claims + evidence queries.

### Deterministic workflow control
Prefer explicit deterministic orchestration for v0:
- `run(DecompositionAgent, input)` → structured decomposition proposal
- validate + mint outputs
- repeat N times for “3 candidate decompositions”

Reference example: `external/openai-agents-js/examples/agent-patterns/deterministic.ts`

---

## Inputs → outputs

Inputs:
- `target_idea_id`
- `profile_id`
- optional: submission-derived sources (links/DOIs) from `wofi.submission.v1`

Outputs (persisted):
- 0..N new `Idea` objects (only when necessary; reuse preferred)
- 1..N `Construction` objects
- mandatory: “what is being asserted” claims ABOUT the target idea (if sources exist)
- stop-point claims ABOUT leaf ideas + evidence attachments

---

## Decomposition workflow (v0 milestones)

### Milestone 1 — Minimal viable decomposition (single pass)
- Retrieve candidate building blocks:
  - `wofi.search_ideas` queries derived from target summary
- Produce 1 hierarchical decomposition candidate:
  - a tree of operators, flattened into Constructions
- Mint missing intermediate ideas (sparingly)
- Add stop claims for leaves + attach at least one evidence item per stop claim

### Milestone 2 — Multiple candidates (default 3)
- Repeat milestone 1 with diversity prompts / constraints:
  - “more general decomposition”
  - “more mechanistic decomposition”
  - “more minimal decomposition”
- Store all candidates (do not rank here; ranking is Module C)

### Milestone 3 — Refinement on existing nodes
- Support running decomposition on an existing leaf later:
  - output can be an already-existing idea id
  - write `refine` constructions where appropriate

---

## Construction formatting rules (enforced)

- Inputs are Idea IDs only.
- Output is an Idea ID (existing or newly minted).
- Operator is from the kernel allowed list.
- Constraints/params must not smuggle truth claims; those belong in Claims.

---

## Acceptance criteria

- For a submitted idea, the system can persist at least 3 candidate decomposition proposal sets:
  - each set has hierarchical structure
  - each leaf has a stop claim + evidence
  - constructions pass kernel validation + invariants
- Jobs are idempotent:
  - re-running the same job does not create duplicate objects (same content → same content_id)
- Tracing:
  - each job has a trace with the `idea_id`, `profile_id`, and minted object ids in metadata

---

## Open questions

- How do we represent a decomposition “tree” for the UI:
  - reconstruct from Constructions only, or
  - store an additional non-kernel view object for convenience?
- How does the agent decide “mint bridge idea vs reuse existing” (policy + cost hooks)?
- What is the budget/time cap per job, and how do we record “budget stops”?
- Do we allow decomposition to mint claims about novelty, or is novelty strictly a score (Module C)?

---

## Test plan

- Unit: validation of decomposition outputs against kernel invariants.
- Integration: golden fixtures of target ideas → deterministic set of minted objects (with controlled model settings / recorded runs).

---

## Implementation notes (2026-02-01)

- Added `@wofi/decomposition-agent` package with a worker CLI that processes `decomposition_jobs`.
- Worker uses Agents SDK + Responses API with `web_search` tool for evidence retrieval.
- Uses `wofi.search_ideas` (hybrid) for WOFI graph reuse and mints objects via agent tools.
- `web_search` sources are included via model provider data for traceability.
- Tests: `npm -w @wofi/decomposition-agent run build`

## Implementation notes (2026-02-03)

- Added candidate grouping via `wofi.construction.v1.params._decomposition` (`run_id`, `candidate_id`, optional `minted_reason`).
- Enforced 5-minute budget cap (env override: `WOFI_DECOMPOSITION_BUDGET_MS`) with budget-stop claim + agent-note evidence.
- Updated prompts to require reuse-first and distinct candidate styles.
- Added unit tests for instructions/prompt/budget payload.
- Tests: `npm -w @wofi/decomposition-agent test`
