import OpenAI from 'openai'
import type { ConversationCloseReason, IntakeConversationState, IntakeStateName } from './types.js'

const META_STATE = 'wofi_state'
const META_DRAFT_REV = 'wofi_draft_rev'
const META_DRAFT_HASH = 'wofi_draft_hash'
const META_DRAFT_UPDATED_AT = 'wofi_draft_updated_at'
const META_SUBMISSION_ID = 'wofi_submission_id'
const META_IDEA_ID = 'wofi_idea_id'
const META_CLOSED_AT = 'wofi_closed_at'
const META_CLOSE_REASON = 'wofi_close_reason'

const VALID_STATES: IntakeStateName[] = [
  'draft',
  'final_proposed',
  'accepted',
  'rejected',
  'closed'
]

const VALID_CLOSE_REASONS: ConversationCloseReason[] = [
  'submitted',
  'rejected',
  'duplicate',
  'blocked',
  'closed'
]

function isValidState(value: string | undefined): value is IntakeStateName {
  return Boolean(value && VALID_STATES.includes(value as IntakeStateName))
}

function isValidCloseReason(value: string | undefined): value is ConversationCloseReason {
  return Boolean(value && VALID_CLOSE_REASONS.includes(value as ConversationCloseReason))
}

function normalizeMetadata(metadata: unknown): Record<string, string> {
  if (!metadata || typeof metadata !== 'object') return {}
  const meta = metadata as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string') {
      out[key] = value
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = String(value)
    } else if (typeof value === 'boolean') {
      out[key] = value ? 'true' : 'false'
    }
  }
  return out
}

function parseIntMaybe(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseState(metadata: Record<string, string>): IntakeConversationState {
  const rawState = metadata[META_STATE]
  const state: IntakeStateName = isValidState(rawState) ? rawState : 'draft'
  const closeReasonRaw = metadata[META_CLOSE_REASON]
  const closeReason = isValidCloseReason(closeReasonRaw) ? closeReasonRaw : undefined

  const parsed: IntakeConversationState = { state }
  const draftRev = parseIntMaybe(metadata[META_DRAFT_REV])
  if (draftRev !== undefined) parsed.draftRev = draftRev
  if (metadata[META_DRAFT_HASH]) parsed.draftHash = metadata[META_DRAFT_HASH]
  if (metadata[META_DRAFT_UPDATED_AT]) parsed.draftUpdatedAt = metadata[META_DRAFT_UPDATED_AT]
  if (metadata[META_SUBMISSION_ID]) parsed.submissionId = metadata[META_SUBMISSION_ID]
  if (metadata[META_IDEA_ID]) parsed.ideaId = metadata[META_IDEA_ID]
  if (metadata[META_CLOSED_AT]) parsed.closedAt = metadata[META_CLOSED_AT]
  if (closeReason) parsed.closeReason = closeReason
  return parsed
}

function buildMetadataPatch(patch: Partial<IntakeConversationState>): Record<string, string> {
  const out: Record<string, string> = {}
  if (patch.state) out[META_STATE] = patch.state
  if (patch.draftRev !== undefined) out[META_DRAFT_REV] = String(patch.draftRev)
  if (patch.draftHash !== undefined) out[META_DRAFT_HASH] = patch.draftHash
  if (patch.draftUpdatedAt !== undefined) out[META_DRAFT_UPDATED_AT] = patch.draftUpdatedAt
  if (patch.submissionId !== undefined) out[META_SUBMISSION_ID] = patch.submissionId
  if (patch.ideaId !== undefined) out[META_IDEA_ID] = patch.ideaId
  if (patch.closedAt !== undefined) out[META_CLOSED_AT] = patch.closedAt
  if (patch.closeReason !== undefined) out[META_CLOSE_REASON] = patch.closeReason
  return out
}

function mergeMetadata(
  current: Record<string, string>,
  patch: Record<string, string>
): Record<string, string> {
  return { ...current, ...patch }
}

export class ConversationStateStore {
  private readonly client: OpenAI
  private readonly conversationId: string

  constructor(client: OpenAI, conversationId: string) {
    this.client = client
    this.conversationId = conversationId
  }

  async getMetadata(): Promise<Record<string, string>> {
    const conversation = await this.client.conversations.retrieve(this.conversationId)
    return normalizeMetadata(conversation.metadata)
  }

  async getState(): Promise<IntakeConversationState> {
    const metadata = await this.getMetadata()
    return parseState(metadata)
  }

  async updateState(patch: Partial<IntakeConversationState>): Promise<IntakeConversationState> {
    const current = await this.getMetadata()
    const merged = mergeMetadata(current, buildMetadataPatch(patch))
    const updated = await this.client.conversations.update(this.conversationId, {
      metadata: merged
    })
    return parseState(normalizeMetadata(updated.metadata))
  }

  async ensureInitialized(): Promise<IntakeConversationState> {
    const metadata = await this.getMetadata()
    if (!metadata[META_STATE]) {
      const updated = await this.client.conversations.update(this.conversationId, {
        metadata: { ...metadata, [META_STATE]: 'draft' }
      })
      return parseState(normalizeMetadata(updated.metadata))
    }
    return parseState(metadata)
  }

  async ensureOpen(): Promise<{ open: boolean; state: IntakeConversationState }>{
    const state = await this.getState()
    return { open: state.state !== 'closed', state }
  }
}
