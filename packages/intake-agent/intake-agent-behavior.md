# Intake Agent Behavior (ASCII Schematic)

This document summarizes how the intake agent orchestrates idea submission using
OpenAI Conversations metadata, a local draft store, and agent tools.

```text
User Prompt
   |
   v
CLI (run intake-agent) -----------------------------+
 - create or reuse Conversation                     |
 - ensure state initialized                          |
 - build ToolContext (store + indexer pool)         |
 - create Intake Agent (tools + rules)              |
   |                                                 |
   v                                                 |
Agent Run (Agents SDK + Responses API)              |
   |                                                 |
   |  (All tools except conversation.stop)           |
   +--> ensureOpen() gate -----------------------+   |
   |                                              |   |
   v                                              |   |
Drafting loop                                      |   |
 - refine idea draft                               |   |
 - draft.set_final                                 |   |
     |                                             |   |
     +--> DraftStore.save()                         |  |
           - devstore/intake-drafts/<id>/draft_*    |  |
           - updates latest.json                    |  |
     +--> update Conversation metadata              |  |
           wofi_state = draft | final_proposed      |  |
           wofi_draft_rev/hash/updated_at           |  |
                                                    |  |
Confirmation step                                  |  |
 - ask for explicit user confirmation              |  |
                                                    |  |
On confirmation:                                   |  |
 - wofi.mint_submission  (one per conversation)    |  |
     +--> set wofi_state = accepted                |  |
     +--> store wofi_submission_id                 |  |
 - wofi.mint_idea                                   |  |
     +--> store wofi_idea_id                        |  |
 - wofi.link_edge (SUBMITTED_AS)                    |  |
 - decomposition.enqueue (profile_id)               |  |
                                                    |  |
Close                                                |
 - conversation.stop(reason="submitted")            |
     +--> set wofi_state = closed                   |
     +--> store wofi_closed_at / wofi_close_reason  |
     +--> keep submission_id / idea_id              |
                                                    |
End                                                  |
```

Notes:
- Conversation metadata is the durable state store (keys are `wofi_*` values).
- Drafts are persisted off-conversation; metadata stores only pointers/ids.
- `wofi.mint_submission` is gated to one submission per conversation.
- `conversation.stop` bypasses the open-gate to allow closure even when closed.
- State names: `draft` -> `final_proposed` -> `accepted` -> `closed`
  (other possible terminal states: `rejected`, `duplicate`, `blocked`).
