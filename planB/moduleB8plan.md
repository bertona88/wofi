# Module B8 Plan — Evidence Attachment Pipeline
*Date: 2026-01-31*  
*Status: DRAFT (planning)*

Scope: Module **8** from `plan.md` (“Evidence Attachment Pipeline”).

Goal: attach Evidence to Claims only, with clear provenance, using:
- web/papers/patents retrieval,
- user-provided sources (URLs, DOIs, PDFs, datasets),
- and “stop point evidence” (e.g., canonical references showing a leaf is well-known).

Hard line reminder: Evidence never attaches directly to Ideas.

---

## Evidence object strategy (v0)

We treat Evidence as:
- reusable anchors (many claims can reference the same Evidence),
- pointer-first (stable locators like DOI preferred),
- append-only (new evidence objects; never edit old ones).

### Evidence kinds (initial)
- `url`
- `doi`
- `isbn` (textbook/handbook)
- `arxiv`
- `patent`
- `dataset` (open question: locator format)

Open question: do we store “excerpts” or only locators + hashes?

---

## Retrieval sources and tools

### Web retrieval
Use Agents SDK hosted tool:
- `web_search` for discovery

Open question:
- Do we also fetch full pages (non-search) via our own scraper tool?
- If yes, how do we store snapshots / content hashes to avoid link rot?

### WOFI-internal retrieval
Evidence de-dup should consult our indexer:
- “do we already have an Evidence object for this locator?”

---

## Pipeline stages

1) **Evidence candidate generation**
   - Input: `Claim`
   - Output: search queries + candidate locators

2) **Candidate scoring / filtering**
   - Prefer primary/canonical sources:
     - standards, textbooks, seminal papers, review articles
   - Reject low-signal sources unless no alternatives exist

3) **Mint Evidence**
   - create `Evidence` objects (idempotent by normalized locator hash)

4) **Link Evidence to Claim**
   - create `SUPPORTS` / `REFUTES` edges

5) **Trace + artifact persistence**
   - persist enough of the retrieval trace to justify later prior-art/credibility decisions

---

## “Stop point evidence” policy

For the “well-known stop” claim pattern (see `[[how_decomposition_works.md]]`):
- we must attach at least one “canonical-ish” reference:
  - Wikipedia/Wikidata (acceptable early, but not ideal long-term)
  - textbook/standard (preferred)
  - review paper (good middle ground)

---

## Acceptance criteria

- Given a claim, the pipeline can attach 1..N evidence items with:
  - stable locator normalization
  - stance (`SUPPORTS`/`REFUTES`)
  - provenance linking back to the job/submission when applicable (`DERIVED_FROM`)
- Never produces an “evidence on idea” representation in storage or query outputs.
- De-duplicates evidence objects across runs.

---

## Open questions

- What is the minimum stored artifact for web search results:
  - just locators + titles + snippets, or
  - full result payload hashes, or
  - archived snapshots?
- How do we handle copyrighted content (PDFs, paywalled pages) in Evidence storage?
- Do we allow user-uploaded PDFs as Evidence objects (and if so, what is the locator)?
- Do we need an “evidence quality” score now, or later (Module D/credibility)?

---

## Test plan

- Unit: locator normalization + content_id determinism.
- Integration: mock web search responses; ensure deterministic Evidence minting + edge creation.

