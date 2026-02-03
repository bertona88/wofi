# @wofi/decomposition-agent — Agent Guide

This package runs the decomposition agent worker that consumes `decomposition_jobs` and persists Ideas/Claims/Evidence/Constructions/Edges via `@wofi/agent-tools`.

## Purpose
- Execute Module B9 decomposition pipeline using Agents SDK + Responses API.
- Retrieve external evidence via `web_search`.
- Reuse existing ideas via `wofi.search_ideas` (hybrid text + vector).

## Key files
- `src/decomposition-agent.ts`: agent configuration + tool wiring.
- `src/worker.ts`: worker wrapper for the indexer queue.
- `src/cli.ts`: CLI entrypoint.

## CLI
Run the worker:
```
DATABASE_URL=postgres://$(whoami)@localhost:5432/wofi_indexer_test \
npm -w @wofi/decomposition-agent run worker -- --watch
```

## Environment
- `WOFI_DECOMPOSITION_MODEL` (or `OPENAI_MODEL`)
- `WOFI_DECOMPOSITION_REASONING` (`minimal|low|medium|high`)
- `WOFI_DECOMPOSITION_MAX_TURNS` (default `30`)
- `WOFI_DECOMPOSITION_BUDGET_MS` (default `300000`)
- `WOFI_WEB_SEARCH_ALLOWED_DOMAINS` (comma-separated allowlist)
- `WOFI_WEB_SEARCH_CONTEXT_SIZE` (`low|medium|high`)
- `WOFI_DEFAULT_PROFILE_ID` (used by enqueueing agents)

## Invariants
- Claims attach only to Ideas or Implementations (`ABOUT` edge).
- Evidence attaches only to Claims (`SUPPORTS`/`REFUTES` edge).
- Constructions take Idea IDs as inputs and output an Idea ID.

## Testing
- `npm -w @wofi/decomposition-agent run build`
