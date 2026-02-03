# Module B6 Plan — Submission API + Normalization (Intake Agent)
*Date: 2026-01-31*  
*Status: IN PROGRESS (draft persistence + conversation control implemented; gating + prior-art checks pending)*

Scope: Module **6** from `plan.md` (“Submission API + Normalization”), implemented as the **user-facing intake agent** pipeline described in `[[idea_pipeline_v_0.md]]`.

Non-goals:
- Decomposition algorithm details (that is Module B9; see `[[how_decomposition_works.md]]`).
- Profile scoring / active graph materialization (Module C).

Primary deliverable: a agent service (or package) that runs an intake workflow and, upon acceptance, mints:
- `wofi.submission.v1`
- `wofi.idea.v1`
- `SUBMITTED_AS` edge (`Submission → Idea`)
- (optional) extracted `Claim`/`Evidence` derived from the submission conversation, linked with `DERIVED_FROM` edges

---

## Contract: one conversation → zero-or-one submission

Invariants (from `[[idea_pipeline_v_0.md]]`):
- Conversations are **draft mode by default**.
- **One submission per conversation**.
- After a successful mint, the conversation is **closed** and cannot be reopened.
- Any “refinement” later is a **new submission** (new `Idea` anchor).

---

## Proposed runtime architecture (Agents SDK)

### Agents
- `IntakeAgent` (primary): runs the state machine A→B→C→D.
- `NoveltyCheckAgent` (sub-agent or tool): does quick “already exists?” checks; can be run as:
  - `asTool()` helper for the primary agent, or
  - an explicit `run()` call for deterministic gating.
- `InjectionGuardrailAgent` (guardrail): cheap model used as input guardrail to detect manipulation/drift.

Reference examples:
- Deterministic gating: `external/openai-agents-js/examples/agent-patterns/deterministic.ts`
- Guardrails: `external/openai-agents-js/examples/agent-patterns/input-guardrails.ts`
- HITL: `external/openai-agents-js/examples/agent-patterns/human-in-the-loop.ts`

### Tools (minimum)
From `[[idea_pipeline_v_0.md]]` (adapt names to actual code later):

Retrieval:
- `wofi.search_ideas(query, k, filters?)`
- `wofi.get_idea(idea_id)`
- Hosted tool: `web_search` (Agents SDK hosted tools) for quick prior-art check

Draft control:
- `draft.set_final(idea_draft)` (per-conversation ephemeral state)
- `conversation.stop(reason_code, user_message, next_action?)` (hard stop)

Minting:
- `wofi.mint_submission(conversation_export, metadata)` → `submission_id`
- `wofi.mint_idea(idea_draft)` → `idea_id`
- `wofi.link_edge(rel="SUBMITTED_AS", from=submission_id, to=idea_id)`
- Optional:
  - `wofi.mint_claim(...)`, `wofi.mint_evidence(...)`
  - `wofi.link_edge(rel="DERIVED_FROM", from=claim_id|evidence_id, to=submission_id)`

Background:
- `decomposition.enqueue(idea_id, profile_id)`

Security:
- `security.flag_prompt_injection(conversation_id, signals)`
- `security.block_conversation(conversation_id, reason_code)`

---

## Intake state machine (implementation plan)

### State A — Drafting ✅
Goal: converge on a decomposable “final draft”.

Implementation notes:
- Use structured output for the draft (even if user sees natural language).
- Keep the agent on-topic with “drift nudge → drift stop” logic.
- Persist latest proposed draft via `draft.set_final(...)` on each stable iteration.

### State B — Final draft proposed ✅
Goal: explicit user agreement.

Implementation notes:
- The agent produces a canonical draft object (see `[[idea_pipeline_v_0.md]]` §4).
- Require the user to confirm; if user edits, loop back to drafting.

### State C — Qualification (agent-gated)
Goal: decide accept/reject.

Implementation notes:
- Run two retrieval passes:
  - WOFI similarity search (internal)
  - web search (external) for obvious prior art
- Deterministic gate:
  - acceptance should come with a structured “why accepted” payload (for tracing + later audits)
  - rejection should include closest WOFI matches (if any)

### State D — Submit + close ✅
Goal: mint kernel objects + enqueue decomposition.

Implementation notes:
- Wrap the entire mint step in one trace span and treat it as “transaction-like”:
  - mint submission
  - mint idea
  - link edges
  - enqueue decomposition
- Make minting idempotent by `content_id`:
  - if `Idea` already exists, reuse and link a new Submission, or reject as duplicate (decision needed)

---

## Data formats (initial)

### `IdeaDraft` (structured output)
Start from `[[idea_pipeline_v_0.md]]` §4.

Required:
- `title: string`
- `summary: string`
- `kind: string`
- `tags?: string[]`

Optional:
- `claims?: { claim_text: string; about: { type: "idea"; id?: string } }[]` (exact shape TBD)
- `evidence?: { kind: "url"|"doi"|...; locator: string; stance?: "supports"|"refutes"; claim_ref?: ... }[]`

### `ConversationExport` (for `wofi.submission.v1`)
Open question: what goes into the on-chain submission payload:
- full transcript vs pointer + hash
- include model/tool traces or only user-visible messages

---

## Acceptance criteria

- ✅ Can run an end-to-end intake flow and deterministically produce either:
  - `rejected` with reasons and suggested redirects, or
  - `accepted` with minted `Submission`, minted `Idea`, `SUBMITTED_AS` edge, and a queued decomposition job.
- ✅ Enforces “one submission per conversation” and closes the conversation after mint.
- ⏳ Uses guardrails to hard-stop on prompt injection attempts.
- ⏳ Emits traces for each run (`workflow_name` includes `intake`).

---

## QA 

- What is the exact rejection UX: do we “stop conversation” always, or allow continued discussion without minting?

we stop the conversation calling the specific function

If a user submits an idea already in WOFI, we politely refer to that node id.
We dont need human in the loop.
  
We persist `draft.set_final(...)` state in Conversations API metadata (or response-chain metadata when using `previous_response_id`)

---

## Conversation API usage (current)

We use OpenAI Conversations API as the durable state store for the intake flow:
- Create (or resume) a conversation and pass `conversationId` into every run.
- Store small state pointers in conversation `metadata`:
  - `wofi_state`, `wofi_draft_rev`, `wofi_draft_hash`, `wofi_draft_updated_at`, `wofi_submission_id`, `wofi_idea_id`, `wofi_closed_at`, `wofi_close_reason`
- Draft payloads are stored off-conversation in `devstore/intake-drafts/<conversationId>/latest.json` to avoid metadata size limits.
- The intake agent checks `wofi_state`; if `closed`, it blocks tool execution and requires a new conversation for new submissions.

Key constraints:
- Metadata is limited to 16 key/value pairs (64-char keys, 512-char values).
- Conversations persist items without the 30-day TTL applied to standalone Responses.

---

## Test plan

- Unit: state machine transitions; draft schema validation; idempotency rules.
- Integration: stubbed `wofi.search_ideas` + stubbed `web_search`; confirm accept/reject gating.
- Integration: mint flow calls `@wofi/kernel/@wofi/store/@wofi/indexer` as expected.

---

## Implementation notes (2026-02-01)

- Added `@wofi/intake-agent` package with conversation-backed state, draft persistence, and explicit `conversation.stop` tooling.
- Drafts are persisted to a local draft store (`devstore/intake-drafts` by default) with metadata pointers stored on the OpenAI conversation.
- Intake agent wraps `wofi.mint_submission` / `wofi.mint_idea` to enforce one-submission-per-conversation and to record IDs in conversation metadata.
- CLI entrypoint: `npm -w @wofi/intake-agent run intake-agent` (requires `DATABASE_URL` + OpenAI env).
- Tests: `npm -w @wofi/intake-agent run build`

## Implementation notes (2026-02-02)

- Added conversation export helper to store full transcript (including tool items) as JSON in `wofi.submission.v1` with `mime_type: application/json`.
- Added novelty gate (LLM-based) that runs internal `wofi.search_ideas` + hosted `web_search` before minting; duplicates/rejections close the conversation without minting.
- Added prompt-injection input guardrail that blocks and closes the conversation on detection.
- Default decomposition profile id set to `profile.default.v1`.
- Tests: `npm -w @wofi/intake-agent test`
