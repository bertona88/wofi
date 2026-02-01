# @wofi/intake-agent — Agent Guide

This package implements the WOFI Intake Agent (Module B6). It owns the conversation-backed state machine for idea submission intake, draft persistence, and conversation closure.

## Purpose
- Run the B6 intake state machine with the OpenAI Conversations API for durable state.
- Persist idea drafts off-conversation and store only pointers/hashes in conversation metadata.
- Enforce **one submission per conversation** and close conversations after minting.

## Key files
- `src/intake-agent.ts`: agent orchestration + tool wrappers
- `src/conversation-state.ts`: Conversation metadata state store
- `src/draft-store.ts`: local draft persistence (`devstore/intake-drafts`)
- `src/cli.ts`: CLI entrypoint (`npm -w @wofi/intake-agent run intake-agent`)
- `src/types.ts`: shared types

## Conversation metadata keys
- `wofi_state`
- `wofi_draft_rev`
- `wofi_draft_hash`
- `wofi_draft_updated_at`
- `wofi_submission_id`
- `wofi_idea_id`
- `wofi_closed_at`
- `wofi_close_reason`

Metadata constraints (OpenAI): max 16 key/value pairs; keys ≤64 chars; values ≤512 chars. Keep only pointers and small values here.

## Draft persistence
- Drafts are stored in `devstore/intake-drafts/<conversationId>/latest.json`
- Always update conversation metadata after draft writes

## Testing
- Build: `npm -w @wofi/intake-agent run build`

## Notes
- Do not use Assistants API. Use Agents SDK + Responses API with Conversations.
- Any changes to state machine or conversation semantics must update `planB/moduleB6plan.md` and `plan.md`.
