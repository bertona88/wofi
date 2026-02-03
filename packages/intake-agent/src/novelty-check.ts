import { Agent, run } from '@openai/agents'
import { z } from 'zod'
import type { IdeaDraftInput } from '@wofi/agent-tools'
import type { Tool } from '@openai/agents'

export const noveltyDecisionSchema = z.object({
  decision: z.enum(['accept', 'reject', 'duplicate']),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable().optional(),
  matched_ideas: z
    .array(
      z.object({
        idea_id: z.string().min(1),
        score: z.number().nullable().optional(),
        title: z.string().nullable().optional()
      })
    )
    .default([]),
  web_results: z
    .array(
      z.object({
        title: z.string().min(1),
        url: z.string().min(1),
        snippet: z.string().nullable().optional()
      })
    )
    .default([])
})

export type NoveltyDecision = z.infer<typeof noveltyDecisionSchema>

const WEB_SEARCH_TOOL: Tool = {
  type: 'hosted_tool',
  name: 'web_search'
}

type NoveltyCheckOptions = {
  model?: string
  conversationId?: string
}

export function buildNoveltyPrompt(draft: IdeaDraftInput): string {
  const lines = [
    'Evaluate novelty for this idea draft.',
    'Use wofi.search_ideas and web_search before deciding.',
    `title: ${draft.title}`,
    `summary: ${draft.summary ?? ''}`,
    `kind: ${draft.kind}`,
    draft.tags?.length ? `tags: ${draft.tags.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')

  return lines
}

export async function runNoveltyCheck(
  draft: IdeaDraftInput,
  tools: Tool[],
  options: NoveltyCheckOptions = {}
): Promise<NoveltyDecision> {
  const toolNames = new Set(
    tools
      .map((tool) => ('name' in tool && typeof tool.name === 'string' ? tool.name : undefined))
      .filter(Boolean) as string[]
  )

  const noveltyTools = toolNames.has('web_search') ? tools : [...tools, WEB_SEARCH_TOOL]

  const agent = new Agent({
    name: 'wofi_novelty_check_agent_v1',
    ...(options.model ? { model: options.model } : {}),
    instructions:
      'You assess novelty for WOFI idea submissions. ' +
      'Call wofi.search_ideas and web_search. ' +
      'Decide: accept if reasonably novel, reject if clearly non-novel, duplicate if it already exists in WOFI. ' +
      'Return matched_ideas from wofi.search_ideas and any web_results you used.',
    outputType: noveltyDecisionSchema as any,
    tools: noveltyTools,
    modelSettings: {
      text: { verbosity: 'low' },
      providerData: {
        include: ['web_search_call.action.sources']
      }
    }
  })

  const prompt = buildNoveltyPrompt(draft)
  const result = await run(agent, prompt, {
    ...(options.conversationId ? { conversationId: options.conversationId } : {})
  })

  if (!result.finalOutput) {
    throw new Error('Novelty check returned no output')
  }

  return result.finalOutput as NoveltyDecision
}
