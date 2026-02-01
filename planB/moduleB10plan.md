# Module B10 Plan — Prior-Art Retrieval + Scoring Artifacts
*Date: 2026-01-31*  
*Status: DRAFT (planning)*

Scope: Module **10** from `plan.md` (“Prior-Art Retrieval + Scoring”).

Important: the *MDL scoring engine* lives in Module C. This module is responsible for:
- semantic prior-art retrieval for concepts (not keywords),
- persisting retrieval artifacts/locators,
- producing a prior-art score + justification trace that can be consumed by scoring.

References:
- `[[wofi_chat_decisions_2026-01-28.md]]` (prior-art-weighted minting discounting)
- `[[idea pipeline.md]]` (intake novelty checks vs true prior-art scoring)

---

## Inputs → outputs

Inputs:
- `idea_id` (or an `IdeaDraft` before minting, if we decide to run it pre-submit)
- optional: candidate “bridge” ideas proposed during decomposition

Outputs:
- persisted Evidence objects for retrieved prior-art sources (locators)
- a `PriorArtAssessment` record (likely off-kernel; stored in Postgres for now) containing:
  - `query_embeddings_hash` / config hash
  - `retrieval_results` (locators + minimal metadata)
  - `score` (0..1 or bucketed)
  - `justification` (short explanation)
  - pointers to traces for auditability

Open question: do we mint a kernel object for `PriorArtAssessment` or keep it off-kernel until stable?

---

## Retrieval approach (v0)

### Phase 1 — Hosted web search baseline
- Use `web_search` to fetch candidate sources.
- Extract concept match evidence via structured output:
  - “this source corresponds to concept X”
- Persist as Evidence objects linked to claims of the form:
  - “Concept X is known prior art in domain D”

### Phase 2 — Semantic retrieval (WOFI + external)
- WOFI: embedding similarity against idea summaries (v0 uses pgvector `idea_embeddings` + embedding_jobs worker in indexer).
- External: semantic queries formulated by the agent using concept descriptors.

---

## Scoring output contract (to Module C)

We need a stable interface consumed by mint-cost scoring:
- `prior_art_score`: higher means “more prior art / more known concept” → cheaper mint (per decisions doc)
- `prior_art_evidence_ids`: Evidence IDs supporting the score
- `prior_art_rationale`: short text for UI/provenance

Open question: exact mapping from score → mint discount curve (belongs in Profile / Module C).

---

## Acceptance criteria

- Can produce a persisted prior-art assessment for a target idea and/or bridge candidates.
- Assessment includes enough artifacts for later auditing (links, hashes, trace ids).
- Outputs are deterministic given identical retrieval results + configs (store config hashes).

---

## Open questions

- What is the initial definition of “semantic match, not keyword match” operationally?
- How do we prevent the agent from over-claiming prior art based on weak evidence?
- Where do we store raw retrieval payloads (privacy/copyright considerations)?
- Do we run prior-art retrieval pre-submit (intake gating) or post-submit (decomposition/scoring)?

---

## Test plan

- Unit: scoring contract shape + config hashing.
- Integration: mocked web search results → stable extracted assessment payload.
