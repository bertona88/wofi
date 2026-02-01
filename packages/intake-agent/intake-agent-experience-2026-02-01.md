# Intake Agent Experience + Lessons Learned (2026-02-01)

## Context
- Source idea: old WOFI DB entry `idea:6410a156-e0be-45a5-b0a6-d8410376838b` from `database_export.cleaned.json`.
- Intake executed via CLI (`npm -w @wofi/intake-agent run intake-agent`).
- Draft persisted in devstore; submission + idea minted and linked; decomposition enqueued with `profile_id=default`.

## Outcome
- Idea ID: `sha256:9659e87d49c8fce704b84c09d61ab9162868b80d60d59d881820d41f14ff00f5`
- Submission ID: `sha256:ee3b95b6c37bbc0872c95265ce87b424dfe7b98916043af7eff6d70199adc53f`
- Edge: `SUBMITTED_AS` created
- Decomposition job: enqueued (`default` profile)
- Conversation: closed with reason `submitted`

## Chat Transcript

User:
"I want to submit an idea from the old WOFI DB (id 6410a156-e0be-45a5-b0a6-d8410376838b). Title: Mirror Cone Tomographic Volumetric Additive Manufacturing. Kind: hardware/optics/3D-printing. Summary: A volumetric additive manufacturing setup that avoids rotating the resin by using a 45-degree conical mirror surrounding a stationary cylindrical vial; structured light from above (DMD/SLM/DOE or a pre-structured mirror) is redirected into 360-degree azimuthal projections for tomographic curing, potentially high NA and uniform exposure. Tags: volumetric-printing, tomographic, mirror-cone, optics, DMD, SLM. Created_at: 2025-10-18T15:13:13.865405. This is the final draft and I explicitly confirm you should mint the submission + idea now and enqueue decomposition."

Assistant:
"Minted and submitted.

- **Idea ID:** sha256:9659e87d49c8fce704b84c09d61ab9162868b80d60d59d881820d41f14ff00f5
- **Submission ID:** sha256:ee3b95b6c37bbc0872c95265ce87b424dfe7b98916043af7eff6d70199adc53f
- Linked via **SUBMITTED_AS** and decomposition enqueued with profile_id **default**."

## Lessons Learned
- Provide the full finalized draft and explicit confirmation in the first prompt to avoid a clarification turn.
- Intake CLI requires `DATABASE_URL` even when drafts are in devstore; plan to set it upfront.
- Ensure the OpenAI key is available in the environment (sourcing `.env` is sufficient).

## Notes
- Draft was stored via `draft.set_final` before minting, which updated conversation metadata and the local draft store.
- Conversation was closed using `conversation.stop` with reason `submitted`.
