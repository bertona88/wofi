import type OpenAI from 'openai'
import type { ConversationItem } from 'openai/resources/conversations/items'
import type { ResponseIncludable } from 'openai/resources/responses/responses'

export const DEFAULT_CONVERSATION_INCLUDE: ResponseIncludable[] = [
  'web_search_call.action.sources',
  'code_interpreter_call.outputs'
]

export type ConversationExport = {
  version: 'wofi.conversation_export.v1'
  conversation_id: string
  exported_at: string
  items: ConversationItem[]
  include: string[]
  source: 'openai.conversations.items.list'
}

export type ConversationExportOptions = {
  include?: ResponseIncludable[]
  limit?: number
}

export async function exportConversation(
  openai: OpenAI,
  conversationId: string,
  options: ConversationExportOptions = {}
): Promise<ConversationExport> {
  const include = options.include ?? Array.from(DEFAULT_CONVERSATION_INCLUDE)
  const limit = options.limit ?? 100
  const items: ConversationItem[] = []
  let after: string | undefined

  for (;;) {
    const params = {
      order: 'asc' as const,
      limit,
      include,
      ...(after ? { after } : {})
    }
    const page = await openai.conversations.items.list(conversationId, params)

    items.push(...page.data)

    if (!page.has_more) break
    if (!page.last_id) {
      throw new Error('Conversation export pagination requires last_id when has_more is true')
    }
    after = page.last_id
  }

  return {
    version: 'wofi.conversation_export.v1',
    conversation_id: conversationId,
    exported_at: new Date().toISOString(),
    items,
    include,
    source: 'openai.conversations.items.list'
  }
}

export function serializeConversationExport(payload: ConversationExport): string {
  return JSON.stringify(payload)
}
