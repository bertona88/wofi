# Module B Plan — Ingestion + Proposal Generation (WOFI 2.0)
*Date: 2026-01-31*  
*Status: DRAFT (planning)*

This document refactors **Module B** from `plan.md` into actionable subplans, grounded in:

- `[[idea pipeline.md]]` (high-level intent + missing decisions)
- `[[idea_pipeline_v_0.md]]` (intake agent state machine + function-call surface)
- `[[how_decomposition_works.md]]` (normative decomposition agent workflow)
- `external/openai-agents-js/` (Agents SDK examples + docs; runtime choice)

Subplans:
- `[[planB/moduleB6plan.md]]` — Submission API + normalization (intake agent)
- `[[planB/moduleB7plan.md]]` — Claim extraction (from submission + decomposition stops)
- `[[planB/moduleB8plan.md]]` — Evidence attachment pipeline (web + user sources)
- `[[planB/moduleB9plan.md]]` — Construction proposal generator (decomposition agents)
- `[[planB/moduleB10plan.md]]` — Prior-art retrieval + scoring artifacts (input to MDL)

**Design guardrails (kernel invariants):**
- Evidence attaches only to Claims (never directly to Ideas).
- Claims are ABOUT an Idea or an Implementation (never about a Construction).
- Constructions take Idea IDs as inputs and output an Idea ID.
- Implementation references exactly one Idea.

**Implementation posture (2026-01-29 decision):**
- Orchestration: OpenAI Agents SDK (JS/TS) + Responses API runtime.
- Avoid Assistants API (deprecated).
- Prior-art retrieval is a first-class tool; graph search is a first-class tool.

---

## Cross-cutting requirements (apply to all B submodules)

### Determinism + provenance
- Every minted kernel object must be:
  - canonicalized (`@wofi/kernel`)
  - content-addressed (`content_id`)
  - signed (if signature is required in the environment)
  - persisted via `@wofi/store` and mirrored via `@wofi/indexer`
- Keep “proposal set vs accepted graph” separation:
  - store all candidate Constructions (do not delete alternatives)
  - profile views select/score; they do not rewrite history

### Agent runtime requirements (Agents SDK)
- Use structured outputs (`outputType`) for all extraction steps that feed writes.
- Use `withTrace()` to group a full intake run (and separately a decomposition job run).
- Prefer small, single-responsibility tools (Agents SDK tools guide).
- Add guardrails where we need cost/safety guarantees (Agents SDK guardrails guide).
- Consider human-in-the-loop approvals for:
  - any tool that triggers irreversible writes, or
  - any expensive web retrieval bursts

### Security / abuse
- Treat user content as adversarial:
  - prompt injection signals → hard-stop path (`conversation.stop` equivalent)
  - rate limits + spam controls (may live in Module F/G but needs hooks here)

### “Conversations are ephemeral” boundary
- Draft conversations can be stored via the OpenAI Conversations API (or response chains with `previous_response_id`), but:
  - only on acceptance do we mint `wofi.submission.v1` and `wofi.idea.v1`
  - one submission per conversation; conversation closes after submission

### Open questions (global)
- What is our initial “novelty” acceptance threshold (heuristic vs learned model)?
- What exact “conversation export” format becomes the `wofi.submission.v1` payload?
- Do we require human approval (HITL) for minting in early alpha?
- What is the first “standard profile_id” to use for decomposition enqueue?
