# Idea pipeline — user-facing intake agent (v0.1)

This document specifies the **user-facing intake agent** for **entity["company","WOFI","idea hypergraph platform"]**.

The intake agent’s job is to:

- keep the user focused on **idea contribution**,
- extract and refine a **single, well-formed idea draft** from a conversation,
- decide whether the draft is **eligible for submission** (agent-gated),
- mint on-chain objects for provenance + the idea anchor,
- then trigger **asynchronous decomposition** (defined in `how_decomposition_works.md`).

Decomposition logic (constructing hierarchies, stop-point claims, MDL/profile scoring) is intentionally **out of scope** here.

---

## 1) Roles and separation of concerns

### User-facing intake agent (this doc)
**Synchronous, interactive.**

- Refines user input into a *final draft*.
- Performs quick novelty checks (WOFI retrieval + web retrieval).
- Enforces guardrails, drift handling, and prompt-injection termination.
- Submits **one idea per conversation**.

### Decomposition agents (separate doc)
**Asynchronous, background.**

- Produce candidate decompositions (`Construction`s) for the submitted `Idea`.
- Default: generate **3** hierarchical decompositions.
- Store all decompositions; selection/monetization depends on the active Profile.

---

## 2) Conversation model and invariants

### 2.1 Conversation semantics
- Every conversation is **draft mode by default**.
- Conversations that do **not** result in submission remain **ephemeral** (kept only as platform conversations for user continuity; not minted on-chain).
- **One submission per conversation.**

### 2.2 Conversation closure
- Once a submission is minted, the conversation is **closed** and cannot be reopened.
- Any later “refinement” is modeled as a **new idea node** (new submission → new idea anchor).

### 2.3 Guardrails
The intake agent accepts only:
- discussing an existing WOFI idea, or
- producing a new idea draft intended for submission.

Everything else is refused or redirected back to idea contribution.

If the agent detects prompt-injection / manipulation attempts, it terminates the conversation immediately (hard stop).

---

## 3) Intake state machine

### State A — Drafting (default)
Goal: capture the idea in a form that is decomposable.

Agent behavior:
- Ask short, targeted questions.
- Suggest small clarifications.
- If user drifts, nudge back to the draft.
- If drift persists, stop and instruct the user to start a new conversation with a cleaner draft.

### State B — Final draft proposed
The agent produces a structured final draft (see §4) and asks for explicit user agreement.

Rules:
- The agent can iterate the final draft with the user.
- Submission is only allowed once **both** the user and the agent agree the draft is ready.

### State C — Qualification (agent-gated)
The agent evaluates novelty:
- Quick WOFI search for close matches.
- Quick web search for obvious prior art.

Decision:
- **Accept** if “reasonably novel.”
- **Reject** if clearly not novel.
- Speculative ideas are allowed; truth/credence is handled at the claim level later.

### State D — Submit + close
On acceptance:
- Mint `Submission` (provenance).
- Mint `Idea` anchor.
- Link `SUBMITTED_AS`.
- Optionally extract and mint any provided `Claim`/`Evidence` objects (if present in the submission content).
- Enqueue decomposition.
- Close the conversation.

On rejection:
- Stop the conversation (optionally pointing to the closest existing idea(s) as the canonical target).

---

## 4) Final draft schema (minimum)

A final draft is the canonical payload the agent intends to submit as an `Idea`.

**Required fields**
- **Title**: short, canonical.
- **Summary**: 1 paragraph describing what it *is* (not whether it’s true).
- **Kind**: idea category (protocol/mechanism/product/system/market/etc.).
- **Tags**: optional.

**Optional fields (may be included by user, not required)**
- **Claims**: explicit assertions about the idea.
- **Evidence**: sources supporting/refuting claims.

Notes:
- Claims are **not required** to submit an idea.
- If claims/evidence appear in the conversation, the agent may extract them into separate kernel objects.

---

## 5) Qualification policy (current)

### 5.1 Novelty requirement
- If the idea is **clearly already in the graph** (or trivially identical to an existing node), it must not be accepted.
- If it appears **reasonably novel**, it can be accepted.

### 5.2 Speculation policy
- Speculative ideas are acceptable.
- “Truth” is not a gating requirement at submission time.

### 5.3 Authority
- Final authority is **agent-gated**.
- The user can disagree, but cannot force submission through this agent.

---

## 6) On-chain writes and provenance

### 6.1 Objects minted on acceptance
1) `wofi.submission.v1`  
   - payload: the **full multi-turn conversation items** (or a pointer + content hash, depending on storage strategy)
   - metadata: who submitted, timestamps, client/app version

2) `wofi.idea.v1`  
   - fields derived from the final draft schema

3) `SUBMITTED_AS` edge  
   - `Submission → Idea`

### 6.2 Optional derived objects
If the submission content includes claims and evidence, mint:
- `wofi.claim.v1`
- `wofi.evidence.v1`
- `DERIVED_FROM` edges linking these objects back to the `Submission`

---

## 7) Triggering decomposition (hand-off contract)

On successful submission, the intake agent triggers:

- `decomposition.enqueue(idea_id, profile_id)`

Current constraints:
- Default: produce **3** candidate hierarchical decompositions.
- All decompositions are stored; the platform has **one active Profile**, but forks may define others.

(Decomposition algorithm details live in `how_decomposition_works.md`.)

---

## 8) Function-call surface (v0)

These are the minimum function calls the intake agent needs.

### Retrieval
- `wofi.search_ideas(query, k, filters?)` → candidate idea matches
- `wofi.get_idea(idea_id)` → fetch canonical node
- `web.search(query, k, domains?/types?)` → quick prior-art check

### Drafting + control
- `draft.set_final(idea_draft)` → store the proposed final draft for this conversation
- `conversation.stop(reason_code, user_message, next_action?)` → hard stop / close-out

### Submission
- `wofi.mint_submission(conversation_export, metadata)` → submission_id
- `wofi.mint_idea(idea_draft)` → idea_id
- `wofi.link_edge(rel="SUBMITTED_AS", from=submission_id, to=idea_id)`
- `wofi.mint_claim(claim)` → claim_id (optional)
- `wofi.mint_evidence(evidence)` → evidence_id (optional)
- `wofi.link_edge(rel="DERIVED_FROM", from=claim_id|evidence_id, to=submission_id)` (optional)

### Background jobs
- `decomposition.enqueue(idea_id, profile_id)`

### Security / abuse
- `security.flag_prompt_injection(conversation_id, signals)`
- `security.block_conversation(conversation_id, reason_code)`

---

## 9) Open decisions (parked)

- Exact scoring outputs emitted by decomposition (novelty/entropy breakdowns).
- Exact definition of “drift” and the termination thresholds.
- Storage strategy for full conversation payload (inline vs pointer + hash).
- The precise cost model knobs used to enforce strict node minting during decomposition.
