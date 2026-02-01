# Decomposition Pipeline — Post‑Run Notes (2026‑02‑01)

## What happened in the run
- Jobs succeeded but hit failure modes:
  - Evidence edges failed when a single Evidence object was linked to multiple Claims.
  - The run initially exceeded max turns (10), then completed after bumping to 40.
  - One run hit a deadlock on `wofi.mint_claim`.
  - One run saw duplicate `arweave_tx_id` on evidence (devstore tx id collision on retry).
  - One run failed due to a transient OpenAI “Connection error.”

## Changes I would make

1) Enforce **one Evidence per Claim** in code  
   - The indexer enforces a 1:1 Evidence→Claim relationship.  
   - The agent should always mint a fresh Evidence object per Claim even if the URL is the same.  
   - Ideal place: `@wofi/agent-tools` helper (e.g., `mintEvidenceForClaim`) or enforce in the decomposition agent before linking.

2) Raise max turn defaults + add tool‑budget enforcement  
   - Default `maxTurns` should be higher (e.g., 30–40).  
   - Add a tool‑call budget counter inside the agent run (stop and use budget stops if exceeded).  
   - Avoid “Max turns exceeded” on normal decompositions.

3) Serialize minting operations inside a job  
   - Deadlocks occurred during concurrent `mint_claim`.  
   - Use a simple mutex/queue or enforce sequential mint+link calls within a job to avoid transactional lock contention.

4) Graceful fallback for web search failures  
   - If web search fails, proceed with `agent_note` evidence and mark “budget stop.”  
   - This keeps jobs deterministic even when the API is flaky.

5) Persist a job summary artifact  
   - Save a non‑kernel summary (JSON or md) with: job id, idea_id, profile_id, minted object ids, evidence URLs, and errors.  
   - Easier debugging and reproducibility than scanning stdout.

## Implementation pointers
- **Evidence/Claim mapping**: see `packages/indexer/src/ingest.ts` where Evidence→Claim is enforced.
- **Agent run options**: use `run(agent, prompt, { maxTurns })` and a tool‑call budget guard.
- **Concurrency**: keep `mint_*` and `link_edge` tool calls strictly sequential per job.
