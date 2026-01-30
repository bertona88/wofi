# WOFI — Unified Kernel Scheme (v1.0)
*Date: 2026-01-07* 
Some later discussed details can be found here [[wofi_chat_decisions_2026-01-28.md]]
*Status: draft, “single-kernel” merge of the original + rewritten schemes*



This kernel defines **what is stored on-chain** (Arweave) and the **minimal ontology** needed for:
- compositional idea graphs (Ideas made of other Ideas),
- epistemics (Claims + Evidence),
- deterministic novelty scoring (MDL via Profiles),
- and optional claim markets (tokenized Claims).

---

## 0) Design goals

- **Composition is identity:** an Idea’s structural meaning comes from its decompositions into other Ideas.
- **Epistemics is separate:** truth/likelihood lives in Claims, supported/refuted by Evidence.
- **Arweave-friendly:** everything persists as small immutable objects.
- **Deterministic scoring:** LLMs propose decompositions; the protocol scores them using a Profile.
- **Credibility is emergent:** no privileged “truth” function in-kernel; credibility accrues via Evidence, attestations, and/or markets.

---

## 1) Kernel invariants (MUST)

### 1.1 Composition invariant
**Ideas are composed only from Ideas.**

- A `Construction` **MUST** take **only Idea IDs** as inputs.
- A `Construction` **MUST** output an **Idea ID**.
- Claims **MUST NOT** appear as `Construction` inputs or outputs.

This is the hard line that prevents “ideas made of claims”.

### 1.2 Epistemic invariant
**Evidence attaches only to Claims, never directly to Ideas.**

- Evidence links use `SUPPORTS` / `REFUTES` edges pointing to a Claim.
- Ideas may still be discussed without any Claims or Evidence.

### 1.3 Claim scope invariant
Claims are assertions **only about an Idea or an Implementation** (not about Constructions).

### 1.4 Implementation reference invariant
An `Implementation` **MUST reference exactly one Idea** (single-idea implementation).

### 1.5 Submission provenance invariant
User-facing submission flows **MUST** mint a `Submission` first, then an `Idea` anchor, then link them with `SUBMITTED_AS`.

`DERIVED_FROM` edges are optional but recommended for agent pipelines (attach to extracted Claims + proposed Constructions at minimum).

---

## 2) Graph model

The kernel is a typed directed graph with *hyperedges* represented by `Construction` nodes.

### 2.1 Node types
Core nodes stored as Arweave transactions:

- `Idea`
- `Construction`
- `Claim`
- `Evidence`
- `Submission`
- `Implementation`
- `Profile`
- `Edge` (atomic edge object)
- `ClaimMarket` (optional, for claim tokenization / markets)
- `Attestation` (optional, for signed opinions / ratings)

### 2.2 Relationship types (edge rels)

**Structural**
- `INPUT_OF` : Idea → Construction
- `OUTPUT_OF`: Construction → Idea
- `IMPLEMENTS`: Implementation → Idea

**Epistemic**
- `ABOUT`    : Claim → (Idea | Implementation)
- `SUPPORTS` : Evidence → Claim
- `REFUTES`  : Evidence → Claim

**Optional (credibility plumbing)**
- `ATTESTS`  : Attestation → (Claim | Evidence)

**Provenance**
- `SUBMITTED_AS` : Submission → Idea
- `DERIVED_FROM` : (Idea | Claim | Construction | Implementation | Evidence) → Submission

---

## 3) Construction operators (kernel set)

`Construction.operator` is a small, versioned, stable set:

1. `compose`  
   General composition: “build X from parts”.
2. `specialize`  
   Add constraints/context to narrow an Idea.
3. `generalize`  
   Relax constraints/context to broaden an Idea.
4. `analogize`  
   Transfer structure across domains (explicit mapping in `params`).
5. `bundle`  
   Group multiple Ideas without implying derivation.
6. `refine`  
   Incremental improvement step (often used with a residual).

Operators beyond this set are extensions and **MUST NOT** be used in kernel Profiles.

---

## 4) Arweave persistence

Each object is a single immutable Arweave transaction.

### 4.1 Canonicalization (for `content_id`)
To enable deterministic hashing:

- Objects are canonicalized as JSON:
  - UTF-8
  - no insignificant whitespace
  - stable key ordering (lexicographic)
  - arrays preserve author order **unless** explicitly specified otherwise
  - omit nulls
- `content_id = "sha256:" + sha256(canonical_json_bytes)`

> If you later formalize canonicalization (e.g., JCS / RFC 8785), keep the same externally visible `content_id` format.

### 4.2 Transaction types
- `wofi.idea.v1`
- `wofi.construction.v1`
- `wofi.claim.v1`
- `wofi.evidence.v1`
- `wofi.submission.v1`
- `wofi.implementation.v1`
- `wofi.profile.v1`
- `wofi.edge.v1`
- `wofi.claim_market.v1` (optional)
- `wofi.attestation.v1` (optional)

---

## 5) Object schemas (illustrative)

### 5.0 Submission (`wofi.submission.v1`)
A Submission stores the raw user input (verbatim) or a pointer to it.

Allowed `payload.kind` values: `inline_utf8` (dev/tests/small text) and `arweave_tx` (prod pointer).

```json
{
  "type": "wofi.submission.v1",
  "schema_version": "1.0",
  "content_id": "sha256:…",
  "payload": {
    "kind": "inline_utf8",
    "value": "User raw submission text…"
  },
  "payload_hash": "sha256:…",
  "mime_type": "text/plain",
  "created_at": "2026-01-30T00:00:00Z",
  "author": {"kind": "pubkey", "value": "…"},
  "context": {
    "client": "web",
    "language": "en",
    "ui_version": "1.0.0"
  }
}
```

### 5.1 Idea (`wofi.idea.v1`)
An Idea is “the thing being talked about”. It does **not** need to be true.

```json
{
  "type": "wofi.idea.v1",
  "schema_version": "1.0",
  "content_id": "sha256:…",
  "title": "Negative feedback control",
  "kind": "concept",
  "summary": "A control strategy where deviations from a setpoint generate opposing corrections…",
  "tags": ["control", "systems"],
  "created_at": "2026-01-07T00:00:00Z",
  "author": {"kind": "pubkey", "value": "…"}
}
```

### 5.2 Construction (`wofi.construction.v1`)
A Construction is a hyperedge that creates an output Idea from input Ideas using a kernel operator.

```json
{
  "type": "wofi.construction.v1",
  "schema_version": "1.0",
  "content_id": "sha256:…",
  "profile_id": "arweave_tx_id_or_content_id",
  "operator": "specialize",
  "inputs": [
    {"idea_id": "…", "role": "base"},
    {"idea_id": "…", "role": "constraint_source"}
  ],
  "params": {
    "mapping": "…"
  },
  "constraints": {
    "assumptions": ["…"],
    "scope": "…"
  },
  "created_at": "2026-01-07T00:00:00Z",
  "author": {"kind": "pubkey", "value": "…"}
}
```

**Required edges**
- for each input: `Idea INPUT_OF Construction`
- for the output: `Construction OUTPUT_OF Idea`

> The output Idea can be minted separately (new node) or pre-exist (alternate decomposition).

### 5.3 Claim (`wofi.claim.v1`)
A Claim is where truth/likelihood lives.

Claims are **only** about an Idea or an Implementation (never about a Construction).

Claims come in two forms:

- **Binary-resolvable**: must have an operational resolution criterion.
- **Continuous credence**: no binary resolution; markets/trust yield a probability-like belief.

```json
{
  "type": "wofi.claim.v1",
  "schema_version": "1.0",
  "content_id": "sha256:…",
  "claim_text": "In population X, intervention Y reduces outcome Z vs control by at least 10%.",
  "claim_kind": "binary",
  "resolution": {
    "criteria": "Pre-registered RCT with primary endpoint Z at T=12 weeks; two-sided p<0.05; effect >= 10%.",
    "resolve_by": "2027-12-31"
  },
  "created_at": "2026-01-07T00:00:00Z",
  "author": {"kind": "pubkey", "value": "…"}
}
```

For continuous credence:

```json
{
  "type": "wofi.claim.v1",
  "schema_version": "1.0",
  "content_id": "sha256:…",
  "claim_text": "Technique A will become the dominant approach in domain B within 5 years.",
  "claim_kind": "credence",
  "created_at": "2026-01-07T00:00:00Z",
  "author": {"kind": "pubkey", "value": "…"}
}
```

**Required edge**
- `Claim ABOUT Idea` *or* `Claim ABOUT Implementation`

### 5.4 Evidence (`wofi.evidence.v1`)
Evidence is a reusable object that can support or refute Claims.

```json
{
  "type": "wofi.evidence.v1",
  "schema_version": "1.0",
  "content_id": "sha256:…",
  "kind": "doi",
  "locator": "10.1038/…",
  "hash": "sha256:…",
  "metadata": {
    "title": "…",
    "year": 2025,
    "authors": ["…"]
  },
  "created_at": "2026-01-07T00:00:00Z",
  "author": {"kind": "pubkey", "value": "…"}
}
```

**Required edge**
- `Evidence SUPPORTS Claim` **or** `Evidence REFUTES Claim`

> Kernel stays minimal: only SUPPORTS/REFUTES. Richer evidence types are extensions.

### 5.5 Implementation (`wofi.implementation.v1`)
Concrete instantiation of an Idea. **Must reference exactly one Idea.**

```json
{
  "type": "wofi.implementation.v1",
  "schema_version": "1.0",
  "content_id": "sha256:…",
  "implements": {"idea_id": "…"},
  "artifact": {"kind": "repo", "value": "…"},
  "metadata": {"status": "prototype"},
  "created_at": "2026-01-07T00:00:00Z",
  "author": {"kind": "pubkey", "value": "…"}
}
```

**Required edge**
- `Implementation IMPLEMENTS Idea`

### 5.6 Profile (`wofi.profile.v1`)
Profiles define:
- kernel primitive set (seed ontology),
- kernel operator costs (MDL weights),
- and deterministic scoring parameters.

```json
{
  "type": "wofi.profile.v1",
  "schema_version": "1.0",
  "content_id": "sha256:…",
  "name": "default",
  "kernel_primitives": ["idea_id:…", "idea_id:…"],
  "operator_cost": {
    "compose": 5.0,
    "specialize": 4.0,
    "generalize": 4.0,
    "analogize": 7.0,
    "bundle": 2.0,
    "refine": 3.0
  },
  "cost_model": {
    "ref_existing_idea": 1.0,
    "mint_new_idea": 20.0,
    "mint_new_construction": 5.0,
    "param_byte": 0.02,
    "residual_byte": 0.05
  },
  "created_at": "2026-01-07T00:00:00Z",
  "author": {"kind": "pubkey", "value": "…"}
}
```

### 5.7 Edge (`wofi.edge.v1`)
Atomic edge object (used for indexing and explicitness).

```json
{
  "type": "wofi.edge.v1",
  "schema_version": "1.0",
  "content_id": "sha256:…",
  "rel": "INPUT_OF",
  "from": {"kind": "idea", "id": "…"},
  "to": {"kind": "construction", "id": "…"},
  "created_at": "2026-01-07T00:00:00Z"
}
```

### 5.8 ClaimMarket (`wofi.claim_market.v1`) — optional but supported
Wraps tokenization / market details for a Claim.

**Design principle:** tokenize the Claim, not the Idea.

```json
{
  "type": "wofi.claim_market.v1",
  "schema_version": "1.0",
  "content_id": "sha256:…",
  "claim_id": "…",
  "market_kind": "binary",
  "settlement": {
    "oracle": {"kind": "governance", "value": "…"},
    "dispute": {"kind": "governance", "value": "…"},
    "expiry": "2027-12-31"
  },
  "asset": {
    "network": "…",
    "contract": "…",
    "token_id": "…"
  },
  "created_at": "2026-01-07T00:00:00Z",
  "author": {"kind": "pubkey", "value": "…"}
}
```

> For `claim_kind = credence`, a market can be “continuous” (LMSR-style, AMM shares, etc.). The kernel does not mandate mechanism.

### 5.9 Attestation (`wofi.attestation.v1`) — optional
A signed statement expressing belief, rating, or review about a Claim/Evidence.

```json
{
  "type": "wofi.attestation.v1",
  "schema_version": "1.0",
  "content_id": "sha256:…",
  "about": {"kind": "claim", "id": "…"},
  "stance": "supports",
  "confidence": 0.7,
  "note": "Looks plausible; evidence quality moderate; would like replication.",
  "created_at": "2026-01-07T00:00:00Z",
  "author": {"kind": "pubkey", "value": "…", "sig": "…"}
}
```

---

## 6) Deterministic novelty (MDL) scoring

MDL scoring is applied to **Idea decompositions** (Constructions), not to Claims.

Given a candidate decomposition of an Idea `D` into inputs `A,B,C` via operator `op`:

```
DL = Σ c_ref(input_idea)
   + c_op(op)
   + c_params(bytes(params, constraints))
   + c_new(nodes minted in this decomposition)
   + c_residual(bytes(unexplained remainder))
```

- Referencing existing Ideas is cheap.
- Minting new primitives is expensive.
- Operator glue and parameters add cost.
- Residual captures what cannot be compressed via the existing library.

**Selection rule:** choose the decomposition with minimum `DL` under the selected Profile.

---

## 7) Credibility model (emergent)

The kernel does not define a single truth function. Credibility may be inferred from:
- quantity/quality of Evidence on Claims,
- reputation / attestations,
- market prices and liquidity,
- time + replication,
- governance outcomes.

**Binary claims** are permitted only when the `resolution.criteria` is operational and checkable.

**Credence claims** are the default for fuzzy, social, or non-operational statements.

---

## 8) Implementation value routing (single-idea)

Because an Implementation references exactly one Idea:
- the Implementation can route value (revenue share / token allocation / royalties) to that Idea’s token holders directly.
- multi-idea attribution is explicitly out of scope for this kernel version.

(If you later allow multi-idea implementations, you’ll need a routing rule tied to a specific Profile + decomposition snapshot.)

---

## 9) Agent pipeline (normative workflow)

When a user submits something:

1. Mint an `Idea` anchor.
2. Extract **Claims** (mandatory).
3. Mint `Claim` nodes and add `ABOUT` edges.
4. Mint `Evidence` nodes for sources and attach via `SUPPORTS` / `REFUTES`.
5. Propose one or more **Construction decompositions** for the Idea:
   - retrieve relevant existing Ideas,
   - propose candidate Constructions (operator + inputs + params),
   - score with Profile MDL proxy,
   - iterate to reduce residual.
6. Persist best-scoring Constructions + edges.

LLMs propose. The protocol verifies and scores.

---

## 10) Governance & versioning

- Kernel operator set changes only via explicit version bump.
- Profiles are versioned and immutable; scoring is deterministic *within a profile*.
- Extensions can add:
  - richer evidence semantics,
  - specialized claim resolution standards,
  - domain-specific profiles,
  - additional market mechanisms,
  - dispute resolution primitives.

---

## 11) Summary of “hard lines”

- Ideas are built from Ideas (Constructions), not from Claims.
- Evidence attaches to Claims, not to Ideas.
- Claims are only about Ideas or Implementations.
- Implementations reference one Idea.
- Operators are small, stable, and versioned.
- Novelty scoring is deterministic (Profile + MDL).
- Credibility is emergent (evidence + markets + social layer).
