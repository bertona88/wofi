# How decomposition works

This document specifies the normative workflow for *decomposition agents* in WOFI. A decomposition agent receives a target Idea and proposes one or more Constructions that explain it as a composition of other Ideas, while attaching epistemic objects (Claims + Evidence) that justify both the high-level novelty and any “stop points”.

The goal is to grow a reusable library of Ideas where:

- Ideas are first-class, persistent objects.
- Meaning is structural: an Idea’s meaning is given by how it composes from other Ideas.
- Truth/credence is separate: it lives in Claims supported/refuted by Evidence.
- Decompositions are additive: future agents can refine any part without editing history.

---

## Kernel objects you are allowed to write

### Idea (`wofi.idea.v1`)
An Idea is “the thing being talked about”. Ideas can be false, speculative, incomplete, or purely conceptual.

Minimal fields: title, kind, summary, tags.

### Construction (`wofi.construction.v1`)
A Construction is a typed hyperedge that derives an output Idea from input Ideas using a kernel operator.

Allowed kernel operators:

- `compose`: build X from parts.
- `specialize`: add constraints/context to narrow.
- `generalize`: relax constraints/context to broaden.
- `analogize`: transfer structure across domains (explicit mapping in params).
- `bundle`: group without implying derivation.
- `refine`: incremental improvement / alternate decomposition of an existing Idea.

Important: the output Idea may already exist. This is how you add alternate decompositions later.

### Claim (`wofi.claim.v1`)
Claims carry truth/likelihood. In decomposition, they serve two roles:

1) Claims about the target idea (e.g., what the paper asserts).
2) Claims about decomposition decisions (e.g., “this leaf is well-known”).

Claims are *ABOUT an Idea* (or an Implementation). Claims are never ABOUT a Construction.

### Evidence (`wofi.evidence.v1`)
Evidence objects point to external sources (DOI, URL, standard, textbook, etc.) and SUPPORT/REFUTE Claims.

---

## Core principles for decomposition agents

1) **Prefer reuse over minting.** Search for existing Idea nodes before creating new ones.

2) **Make Ideas atomic enough to reuse.** A node should capture one mechanism, constraint, protocol, or conceptual move—small enough to appear in many decompositions.

3) **Keep decompositions hierarchical.** Avoid flat lists when a substructure is meaningful.

4) **Stop points are annotations, not hard walls.** When you stop expanding, you must explain why, and you must leave the door open for future refinement.

5) **Never “edit” the past.** If you think an existing decomposition is wrong or shallow, add a new Construction that refines it.

---

## Step-by-step workflow

### Step 0 — Inputs
You receive:

- `target_idea_id` (or text to mint one)
- a `profile_id` (cost model + scoring rules)
- any provided sources (paper DOI, PDF, links, user notes)

### Step 1 — Mint (or confirm) the target Idea anchor
If the target Idea does not exist, mint it as an Idea node with:

- a short title
- a one-paragraph summary describing *what it is*, not whether it is true
- optional tags

### Step 2 — Extract mandatory Claims about the target
From the submission text/sources, mint Claims ABOUT the target Idea. These are not decomposition claims; they are “what is being asserted”.

Attach Evidence (DOI/URL/etc.) that SUPPORTS those Claims.

### Step 3 — Retrieve candidate building blocks
Before minting new Ideas, search the existing graph for:

- synonymous labels
- close concepts
- known mechanisms/components

If a close match exists, reuse it and add clarifying text in the Construction constraints/params if needed.

### Step 4 — Propose one or more candidate decompositions
Produce one or more Construction candidates that derive the target Idea.

Guidance:

- Use `compose` for “X is built from parts A, B, C”.
- Use `specialize` for “X is A under constraints/context C”.
- Use `analogize` for “X is mapped from A in another domain” (include mapping).
- Use `bundle` if the target is inherently a set of co-present ideas.
- Use `refine` when you are improving/adding structure to an *existing* Idea or decomposition.

A good decomposition is:

- structurally explanatory (shows why the idea is what it is)
- reusable (inputs are not overly specific unless needed)
- minimal (does not invent extra parts)

### Step 5 — Mint missing intermediate Ideas (only when necessary)
If the decomposition requires a component that truly does not exist, mint it.

When minting new Ideas:

- write a definition-like summary (1–4 sentences)
- avoid baking in the current paper’s specifics unless the node is truly paper-specific
- keep names canonical and include common synonyms in tags (optional extension)

### Step 6 — Decide stopping points and attach “well-known” Claims
At some point you will stop decomposing leaves. When you stop, you must annotate the leaf.

#### The “well-known stop” pattern
You attach a Claim ABOUT the leaf Idea with claim_text of the form:

> “This Idea is well-known/common knowledge in domain D (stop point for decomposition under profile P).”

Use `claim_kind: "credence"` unless you have a binary, operational criterion.

Then attach Evidence that SUPPORTS the Claim, for example:

- Wikipedia or Wikidata entry (URL)
- textbook or standard (ISBN/URL)
- review paper or classic reference (DOI)
- reputable encyclopedia/handbook

This stop claim means:

- “cheap enough to use as a primitive for now”
- “further decomposition is optional and can be done later”

It does *not* mean the Idea is irreducible.

### Step 7 — Persist Constructions + edges
For each accepted Construction candidate:

- write the Construction object (operator, inputs with roles, optional params, constraints)
- ensure required edges exist:
  - each input Idea → `INPUT_OF` → Construction
  - Construction → `OUTPUT_OF` → output Idea

### Step 8 — Iterate to reduce residual
If the decomposition feels hand-wavy, introduce intermediate Ideas or split a leaf.

Use `refine` when you are adding a “better explanation” without changing the output Idea.

---

## Future refinement: how agents continue decomposition later

A key kernel feature is that a Construction may output an already-existing Idea. This is how the graph stays immutable but continues to deepen.

### Pattern A — Add a deeper decomposition for an existing leaf
Suppose you previously stopped at leaf `I_maragoni` with a “well-known” claim.

Later, a new agent can add:

- a new Construction `C_new` with operator `compose` (or `refine`)
- inputs: Ideas that explain `I_maragoni`
- output: the existing `I_maragoni`

This creates an alternate / deeper decomposition path without deleting the earlier stop claim.

### Pattern B — Turn an over-broad leaf into a hierarchy (without breaking references)
If a leaf was too broad, do not rename it into something else.

Instead:

- keep the broad leaf as the canonical “parent”
- mint one or more specialized children
- add Constructions that connect them:
  - `specialize(parent, constraints) -> child`
  - or `generalize(child) -> parent`

Then, future decompositions can choose the appropriate granularity.

### Pattern C — Competing decompositions coexist
Two decompositions can disagree. That is fine.

- Keep both Constructions.
- If needed, add Claims about which one is better supported, more general, or more accurate.

---

## Practical stopping criteria (recommended)

Stop expanding a node when at least one condition holds:

1) **Standardization**: it is widely taught and named, with canonical references.
2) **Diminishing returns**: further decomposition does not reduce residual enough to justify extra nodes under the current Profile.
3) **Cross-domain stability**: the concept is stable across contexts (not tied to the current example).
4) **Agent budget**: time/cost limits; in this case, mark the stop explicitly as “budget stop” (not “well-known”).

Always add a stop Claim plus Evidence when you stop.

---

## Evidence guidelines

- Prefer primary or canonical sources where possible (standards, textbooks, seminal papers, reputable encyclopedias).
- Use Evidence objects as reusable anchors: many Claims can point to the same Evidence.
- Keep locators stable when possible (DOI over URL; archived URLs over ephemeral pages).

---

## Quality checklist for a decomposition

A decomposition is good when:

- Inputs are each reusable in other contexts.
- The structure is hierarchical rather than a flat bag of parts.
- Leaves are explicitly annotated with why you stopped.
- Claims and Evidence separate “what is asserted” from “how we chose to represent it”.
- A future agent can pick any leaf and continue decomposition without breaking anything.

---

## Minimal examples

### Example: a “well-known” stop claim

```json
{
  "type": "wofi.claim.v1",
  "schema_version": "1.0",
  "content_id": "sha256:...",
  "claim_text": "Marangoni flow is well-known/common knowledge in fluid dynamics (stop point under profile P_v0).",
  "claim_kind": "credence",
  "created_at": "...",
  "author": {"kind": "pubkey", "value": "..."}
}
```

Evidence could be a URL or a DOI:

```json
{
  "type": "wofi.evidence.v1",
  "schema_version": "1.0",
  "content_id": "sha256:...",
  "kind": "url",
  "locator": "https://en.wikipedia.org/wiki/Marangoni_effect",
  "created_at": "...",
  "author": {"kind": "pubkey", "value": "..."}
}
```

### Example: later refinement of the same leaf

```json
{
  "type": "wofi.construction.v1",
  "schema_version": "1.0",
  "content_id": "sha256:...",
  "profile_id": "P_v0",
  "operator": "compose",
  "inputs": [
    {"idea_id": "I_surface_tension_gradient", "role": "driver"},
    {"idea_id": "I_free_surface_or_interface", "role": "interface"},
    {"idea_id": "I_viscous_flow_response", "role": "response"}
  ],
  "params": {},
  "constraints": {"assumptions": ["continuum regime"], "scope": "low-Re typical microfluidics"},
  "created_at": "...",
  "author": {"kind": "pubkey", "value": "..."}
}
```

Output edges point to the existing `I_maragoni` Idea.

