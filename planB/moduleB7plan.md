# Module B7 Plan — Claim Extraction
*Date: 2026-01-31*  
*Status: DRAFT (planning)*

Scope: Module **7** from `plan.md` (“Claim Extraction”).

Goal: extract candidate `Claim` objects and `ABOUT` edges from:
- the intake submission conversation (optional at submission time), and
- decomposition pipeline outputs (especially “stop point” claims, and claims ABOUT the target idea).

Hard line reminders:
- Claims are ABOUT an `Idea` or an `Implementation` only.
- Evidence attaches only to Claims.

---

## Inputs → outputs

Inputs:
- `submission_id` (and/or conversation export)
- `idea_id` (the accepted idea anchor)
- optionally `implementation_id` (if the submission is about an implementation)

Outputs:
- `Claim[]` (kernel objects)
- edges:
  - `ABOUT(Claim → Idea|Implementation)`
  - `DERIVED_FROM(Claim → Submission)` when extracted from a submission

---

## Extraction strategy (v0)

### 1) Two-tier extraction
- Tier 1: “obvious claims” extraction (lightweight; high precision).
- Tier 2: “candidate claims” expansion (broader; may include uncertain claims flagged as such).

### 2) Structured output (Agents SDK)
- Use `outputType` (Zod schema) for `ExtractedClaims`.
- Add an output guardrail:
  - validates that each claim targets Idea|Implementation
  - rejects claims that are really about Constructions (“this decomposition is best”) unless rephrased as ABOUT an Idea (e.g., “X is well-known…”)

---

## Claim taxonomy (initial; subject to kernel schema)

We likely need at least:
- `descriptive`: what the idea is / mechanism description
- `predictive`: what it would imply if implemented
- `credence`: “well-known/common knowledge” stop-point claims (see `[[how_decomposition_works.md]]`)
- `normative`: value judgments / goals (optional)

Open question: does `claim_kind` exist in kernel today or is it an extension field?

---

## “Stop point” claims (decomposition interoperability)

We standardize a stop-point claim template (per `[[how_decomposition_works.md]]`):
- Claim ABOUT the leaf Idea
- Text contains:
  - domain context
  - stop rationale (well-known vs budget vs unresolved)
  - profile_id (or profile name) used for the stop decision

We should extract such claims from decomposition outputs and also allow the decomposition agent to mint them directly.

---

## Acceptance criteria

- Given a submission conversation, can extract 0..N claims with:
  - normalized, non-duplicative claim text
  - explicit ABOUT target
  - optional confidence / kind fields (if supported)
- Enforces invariants: no claims ABOUT constructions; no evidence created here.
- Produces deterministic outputs when run against the same frozen inputs (seeded config / deterministic settings where possible).

---

## Open questions

- Do we mint claims at intake time at all, or only during decomposition?
- Do we store “candidate claims” that the user hasn’t explicitly endorsed?
- How do we de-duplicate claims across submissions (text similarity vs canonical form)?
- Do we allow claims about novelty (“This is novel”) or is novelty only an MDL score output?

---

## Test plan

- Unit: schema validation + invariant enforcement.
- Integration: run extraction against fixed fixtures and snapshot the structured output.
