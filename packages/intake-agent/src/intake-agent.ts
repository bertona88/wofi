import { createHash } from 'node:crypto'
import { Agent, tool } from '@openai/agents'
import type { Tool } from '@openai/agents'
import { createAgentTools, type IdeaDraftInput, type ToolContext } from '@wofi/agent-tools'
import type { DraftSetResult, IntakeConversationState } from './types.js'
import { DraftStore } from './draft-store.js'
import { ConversationStateStore } from './conversation-state.js'
import { z } from 'zod'
import OpenAI from 'openai'

const ideaDraftSchema = z.object({
  title: z.string().min(1),
  kind: z.string().min(1),
  summary: z.string().min(1).nullable().optional(),
  tags: z.array(z.string().min(1)).nullable().optional(),
  metadata: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .nullable()
    .optional(),
  created_at: z.string().min(1).nullable().optional()
})

const draftSetSchema = ideaDraftSchema.extend({
  final: z.boolean().nullable().optional()
})

const conversationStopSchema = z.object({
  reason: z.enum(['submitted', 'rejected', 'duplicate', 'blocked', 'closed']).nullable().optional(),
  message: z.string().min(1).nullable().optional(),
  submission_id: z.string().min(1).nullable().optional(),
  idea_id: z.string().min(1).nullable().optional()
})

type DraftSetInput = z.infer<typeof draftSetSchema>
type ConversationStopInput = z.infer<typeof conversationStopSchema>

function normalizeDraft(input: DraftSetInput): IdeaDraftInput {
  return {
    title: input.title,
    kind: input.kind,
    summary: input.summary ?? null,
    tags: input.tags ?? null,
    metadata: input.metadata ?? null,
    created_at: input.created_at ?? null
  }
}

function hashDraft(input: DraftSetInput): string {
  const payload = JSON.stringify(normalizeDraft(input))
  return createHash('sha256').update(payload).digest('hex')
}

export type IntakeAgentOptions = {
  openai: OpenAI
  conversationId: string
  ctx: ToolContext
  draftStore?: DraftStore
  defaultProfileId: string
  model?: string
  debugTools?: boolean
}

export function createIntakeAgent(options: IntakeAgentOptions): {
  agent: Agent<unknown, any>
  tools: Tool[]
  state: ConversationStateStore
} {
  const { openai, conversationId, ctx, defaultProfileId, debugTools } = options
  const stateStore = new ConversationStateStore(openai, conversationId)
  const draftStore = options.draftStore ?? new DraftStore()

  const toolFactory = ((config) => {
    const execute = async (input: unknown) => {
      if (debugTools) {
        console.log(`[tool:${config.name}] input`, JSON.stringify(input))
      }

      if (config.name !== 'conversation.stop') {
        const gate = await stateStore.ensureOpen()
        if (!gate.open) {
          throw new Error('Conversation is closed')
        }
      }

      if (config.name === 'wofi.mint_submission') {
        const state = await stateStore.getState()
        if (state.submissionId) {
          throw new Error('Submission already exists for this conversation')
        }
        const result = (await config.execute(input as never)) as { content_id: string }
        await stateStore.updateState({ state: 'accepted', submissionId: result.content_id })
        return result
      }

      if (config.name === 'wofi.mint_idea') {
        const result = (await config.execute(input as never)) as { content_id: string }
        await stateStore.updateState({ ideaId: result.content_id })
        return result
      }

      return await config.execute(input as never)
    }

    return tool({
      ...(config as any),
      execute,
      strict: true,
      errorFunction: debugTools
        ? (_context: unknown, error: unknown) => {
            console.error(`[tool:${config.name}] error`, error)
            return `Tool ${config.name} failed: ${error}`
          }
        : undefined
    } as any)
  }) as Parameters<typeof createAgentTools>[1]

  const tools = createAgentTools(ctx, toolFactory) as Tool[]

  const draftTool = tool({
    name: 'draft.set_final',
    description: 'Persist the latest idea draft for this conversation.',
    parameters: draftSetSchema,
    strict: true,
    execute: async (input: DraftSetInput): Promise<DraftSetResult> => {
      const gate = await stateStore.ensureOpen()
      if (!gate.open) throw new Error('Conversation is closed')

      const now = new Date().toISOString()
      const hash = hashDraft(input)
      const nextRev = (gate.state.draftRev ?? 0) + 1
      const record = {
        conversation_id: conversationId,
        rev: nextRev,
        hash,
        created_at: now,
        draft: normalizeDraft(input)
      }
      await draftStore.save(record)

      const state = input.final ? 'final_proposed' : 'draft'
      await stateStore.updateState({
        state,
        draftRev: nextRev,
        draftHash: hash,
        draftUpdatedAt: now
      })

      return { rev: nextRev, hash, state, updated_at: now }
    }
  })

  const stopTool = tool({
    name: 'conversation.stop',
    description: 'Close the conversation and prevent further submissions.',
    parameters: conversationStopSchema,
    strict: true,
    execute: async (input: ConversationStopInput): Promise<string> => {
      const now = new Date().toISOString()
      const state = await stateStore.getState()
      const reason = input.reason ?? 'closed'
      const patch: Partial<IntakeConversationState> = {
        state: 'closed',
        closeReason: reason,
        closedAt: now
      }
      const submissionId = input.submission_id ?? state.submissionId
      if (submissionId) patch.submissionId = submissionId
      const ideaId = input.idea_id ?? state.ideaId
      if (ideaId) patch.ideaId = ideaId
      await stateStore.updateState(patch)
      return input.message ?? `Conversation closed (${reason}).`
    }
  })

  tools.push(draftTool, stopTool)

  const agentConfig: ConstructorParameters<typeof Agent>[0] = {
    name: 'wofi_intake_agent',
    instructions:
      'You are the WOFI intake agent. Keep to the intake flow: ' +
      '1) keep refining until a stable draft exists; ' +
      '2) call draft.set_final whenever you reach a stable draft; ' +
      '3) ask for explicit confirmation before minting; ' +
      '4) after confirmation, call wofi.mint_submission, wofi.mint_idea, wofi.link_edge (SUBMITTED_AS), ' +
      `and decomposition.enqueue using profile_id "${defaultProfileId}"; ` +
      '5) call conversation.stop with reason "submitted" and include submission_id and idea_id. ' +
      'Ask at most one clarifying question per turn.',
    tools
  }

  if (options.model) agentConfig.model = options.model

  const agent = new Agent(agentConfig)

  return { agent, tools, state: stateStore }
}
