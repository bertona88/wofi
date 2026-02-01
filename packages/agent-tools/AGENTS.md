# @wofi/agent-tools — Agent Guide

This package provides the tool surface used by WOFI agents (read/write/query/decomposition). It is the shared tool layer for Module B pipelines.

## Purpose
- Expose typed tool wrappers around kernel/store/indexer/query operations.
- Centralize tool schemas for Agents SDK.
- Keep tool contracts stable and kernel-aligned.

## Key files
- `src/agents.ts`: tool schemas + `createAgentTools` factory
- `src/read.ts`: read/query helpers (`wofi.get_*`, `wofi.search_ideas`)
- `src/write.ts`: mint + link helpers (`wofi.mint_*`, `wofi.link_edge`)
- `src/jobs.ts`: background enqueue helpers (`decomposition.enqueue`)
- `src/types.ts`: shared tool I/O types
- `src/prototype-agent.ts`: simple intake runner (demo)

## Tool names (current)
Read:
- `wofi.get_idea`, `wofi.get_construction`, `wofi.get_claim_bundle`, `wofi.get_submission`
- `wofi.search_ideas`

Write:
- `wofi.mint_idea`, `wofi.mint_submission`, `wofi.mint_claim`, `wofi.mint_evidence`, `wofi.mint_construction`
- `wofi.link_edge`

Jobs:
- `decomposition.enqueue`

## Invariants to keep
- Kernel hard lines are enforced in `@wofi/kernel` and must not be bypassed.
- `SUBMITTED_AS` must originate from Submission, `DERIVED_FROM` must target Submission.
- Claims attach only to Ideas or Implementations (not Constructions).
- Implementations reference exactly one Idea.

## Testing
- `npm -w @wofi/agent-tools test`

## Notes
- Use Agents SDK + Responses API (not Assistants API).
- Any tool shape changes must update `planB` docs and associated agent pipelines.
