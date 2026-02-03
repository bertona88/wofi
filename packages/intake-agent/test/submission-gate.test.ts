import test from 'node:test'
import assert from 'node:assert/strict'
import { createSubmissionGate } from '../src/submission-gate.js'

const baseDraft = {
  title: 'Test Idea',
  kind: 'protocol',
  summary: 'A test idea',
  tags: ['test']
}

function createDraftStore() {
  return {
    loadLatest: async () => ({
      conversation_id: 'conv_1',
      rev: 1,
      hash: 'hash',
      created_at: new Date().toISOString(),
      draft: baseDraft
    })
  }
}

test('submission gate blocks duplicates', async () => {
  let executed = false
  let closed: any = null

  const gate = createSubmissionGate({
    conversationId: 'conv_1',
    draftStore: createDraftStore() as any,
    noveltyCheck: async () => ({
      decision: 'duplicate',
      reason: 'duplicate',
      matched_ideas: [{ idea_id: 'idea_123', score: 0.99, title: 'Existing' }],
      web_results: []
    }),
    closeConversation: async (input) => {
      closed = input
      return 'closed'
    },
    exportConversation: async () => JSON.stringify({ ok: true })
  })

  const execute = async () => {
    executed = true
    return { content_id: 'submission_1' }
  }

  const guarded = gate(execute)
  await assert.rejects(() => guarded({ conversation_export: 'x' } as any))
  assert.equal(executed, false)
  assert.equal(closed?.reason, 'duplicate')
  assert.equal(closed?.idea_id, 'idea_123')
})

test('submission gate blocks rejects', async () => {
  let executed = false
  let closed: any = null

  const gate = createSubmissionGate({
    conversationId: 'conv_1',
    draftStore: createDraftStore() as any,
    noveltyCheck: async () => ({
      decision: 'reject',
      reason: 'Not novel',
      matched_ideas: [],
      web_results: []
    }),
    closeConversation: async (input) => {
      closed = input
      return 'closed'
    },
    exportConversation: async () => JSON.stringify({ ok: true })
  })

  const execute = async () => {
    executed = true
    return { content_id: 'submission_1' }
  }

  const guarded = gate(execute)
  await assert.rejects(() => guarded({ conversation_export: 'x' } as any))
  assert.equal(executed, false)
  assert.equal(closed?.reason, 'rejected')
})

test('submission gate allows accept and patches payload', async () => {
  let executed = false
  let captured: any = null

  const gate = createSubmissionGate({
    conversationId: 'conv_1',
    draftStore: createDraftStore() as any,
    noveltyCheck: async () => ({
      decision: 'accept',
      reason: 'Novel enough',
      matched_ideas: [],
      web_results: []
    }),
    closeConversation: async () => 'closed',
    exportConversation: async () => JSON.stringify({ version: 'wofi.conversation_export.v1' })
  })

  const execute = async (input: any) => {
    executed = true
    captured = input
    return { content_id: 'submission_1' }
  }

  const guarded = gate(execute)
  await guarded({ conversation_export: 'x', mime_type: 'text/plain' } as any)
  assert.equal(executed, true)
  assert.equal(captured.mime_type, 'application/json')
  assert.equal(captured.conversation_export, JSON.stringify({ version: 'wofi.conversation_export.v1' }))
})
