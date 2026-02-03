import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildBudgetStopPayload,
  buildInstructions,
  buildPrompt
} from '../src/decomposition-agent.js'

test('buildInstructions includes grouping and reuse-first guidance', () => {
  const instructions = buildInstructions('profile.default.v1')
  assert.match(instructions, /params\._decomposition/i)
  assert.match(instructions, /reuse-first/i)
  assert.match(instructions, /exactly 3 candidate decompositions/i)
})

test('buildPrompt includes run/candidate ids and budget', () => {
  const prompt = buildPrompt({
    job: {
      id: 12,
      idea_id: 'idea_123',
      profile_id: 'profile.default.v1',
      opts_json: null,
      input_hash: 'sha256:deadbeef',
      attempts: 1
    },
    runId: 'decomp_job_12_a1',
    candidateIds: ['c1', 'c2', 'c3'],
    budgetMs: 300000
  })

  assert.match(prompt, /run_id: decomp_job_12_a1/)
  assert.match(prompt, /candidate_ids: c1,c2,c3/)
  assert.match(prompt, /c1: standard hierarchical decomposition/i)
  assert.match(prompt, /c2: more mechanistic\/causal/i)
  assert.match(prompt, /c3: more minimal/i)
  assert.match(prompt, /budget_ms: 300000/)
})

test('buildBudgetStopPayload formats claim and locator', () => {
  const payload = buildBudgetStopPayload('profile.default.v1', 'Test Idea')
  assert.equal(
    payload.claimText,
    'Budget stop for decomposition under profile profile.default.v1.'
  )
  assert.equal(payload.evidenceLocator, 'budget_stop:Test Idea')
})
