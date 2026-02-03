import test from 'node:test'
import assert from 'node:assert/strict'
import type OpenAI from 'openai'
import { exportConversation, serializeConversationExport } from '../src/conversation-export.js'

test('exportConversation paginates and preserves include', async () => {
  const calls: Array<{ conversationId: string; params: any }> = []
  const pages = [
    {
      data: [{ id: 'item_1', type: 'message', role: 'user', content: [], status: 'completed' }],
      has_more: true,
      last_id: 'item_1'
    },
    {
      data: [
        { id: 'item_2', type: 'message', role: 'assistant', content: [], status: 'completed' },
        { id: 'item_3', type: 'message', role: 'user', content: [], status: 'completed' }
      ],
      has_more: false,
      last_id: 'item_3'
    }
  ]

  const openai = {
    conversations: {
      items: {
        list: async (conversationId: string, params: any) => {
          calls.push({ conversationId, params })
          const page = pages.shift()
          if (!page) throw new Error('No page left')
          return page
        }
      }
    }
  } as unknown as OpenAI

  const payload = await exportConversation(openai, 'conv_123', {
    include: ['web_search_call.action.sources'],
    limit: 2
  })

  assert.equal(payload.conversation_id, 'conv_123')
  assert.equal(payload.items.length, 3)
  assert.deepEqual(payload.include, ['web_search_call.action.sources'])
  assert.equal(calls.length, 2)
  const firstCall = calls[0]!
  const secondCall = calls[1]!
  assert.equal(firstCall.conversationId, 'conv_123')
  assert.equal(firstCall.params.order, 'asc')
  assert.equal(firstCall.params.limit, 2)
  assert.equal(firstCall.params.after, undefined)
  assert.equal(secondCall.params.after, 'item_1')

  const serialized = serializeConversationExport(payload)
  const parsed = JSON.parse(serialized)
  assert.equal(parsed.version, 'wofi.conversation_export.v1')
})
