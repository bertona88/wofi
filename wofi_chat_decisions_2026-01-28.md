# WOFI — Decisions from Chat (2026-01-28)

This note distills the **decisions** we converged on regarding **MDL costs**, **hierarchy**, **prior art**, and **Profile-based graph views**.

---

## 1) Primary objective

- Encourage **hierarchical** decompositions (deep, reusable structure), not flat “wide” compositions.
- Prefer reusing (or minting) **concepts that already exist in the practical world**.
- Avoid minting contrived “bridge” nodes that only exist to help compression.

---

## 2) Cost model: what gets charged

We treat the description length (DL) of a candidate decomposition (Construction) as having (at least) these components:

- **Operator cost**: a fixed cost for using the operator (e.g., `compose`).
- **Per-input reference cost**: **each input Idea referenced adds cost**.
- **Params/constraints cost**: bytes in parameters/constraints contribute.
- **Residual cost**: unexplained remainder contributes.
- **Minting cost**: creating a **new** Idea (e.g., a bridge) is costly, *but* the cost depends on prior art (see below).

**Key decision:** *Yes* — adding each Idea to a `compose` input list is expected to add cost, specifically to discourage overly-wide compositions.

---

## 3) Hierarchy bias (how we make it happen)

- Because each additional parent has a **reference cost**, very wide `compose` nodes become expensive.
- The system is incentivized to introduce **mid-level abstractions** (bridges) *only when justified*.

---

## 4) “Known vs Novel” bridges: prior-art–weighted minting

We want bridge ideas to be cheap **only when they correspond to something already known in the world**, and expensive when they seem newly invented / contrived.

**Decision:** the pipeline uses an AI agent to search **papers, patents, and web sources** to estimate prior art.

- If the agent finds strong prior art for the *concept* → mint cost is **low/moderate**.
- If it finds weak/no prior art → mint cost is **high**.

**Crucial decision:** prior art matching must be **semantic**, not keyword/term matching.
- I.e., if the same concept existed under different names, it still counts as prior art.

---

## 5) Multiple candidate decompositions are preserved (no wasted work)

**Decision:** the agent can produce multiple candidate decompositions for the same Idea and **submit/persist them all**.

- We do **not** discard alternatives at ingestion time.
- Each alternative is a first-class proposal that can be re-scored later.

This ensures that search effort (including prior-art retrieval) is not wasted if we change scoring preferences.

---

## 6) Profiles select the “active graph view”

**Decision:** the chosen **Profile** determines which decompositions are preferred/active.

- Profiles encode the cost weights (operator cost, reference cost, mint cost schedule, residual/param costs).
- Different profiles yield different “best” decompositions and thus different **graph views**.
- Switching profiles should mainly require **re-scoring**, not re-ingesting.

---

## 7) Proposal vs acceptance separation

**Decision:** keep a clean separation:

- `Construction` objects are **immutable proposals** (stored permanently).
- “What the graph looks like” under a given Profile is a **selection/ranking view** over the proposal set.
- We avoid deleting or rewriting historical proposals when profiles change.

---

## 8) Immediate implications for implementation

- Store: **Idea nodes + all candidate Constructions**.
- Compute: Profile-specific scores and maintain a profile-specific set of “active” decompositions.
- Prior art: store retrieval outputs (or hashes/locators) as evidence supporting the **prior-art score** used in minting cost.

---

## 9) Open parameters (not decided yet)

- Exact definition of the **prior-art score** (signals, weighting, thresholds).
- How prior-art retrieval is persisted (e.g., Evidence objects, off-chain index, or both).
- The exact cost curve mapping from prior-art score → mint cost discount.
- Any guardrails against search noise / adversarial prior-art claims.

