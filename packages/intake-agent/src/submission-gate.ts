import type { IdeaDraftInput, SubmissionInput } from '@wofi/agent-tools'
import type { DraftStore } from './draft-store.js'
import type { NoveltyDecision } from './novelty-check.js'
import type { ConversationCloseInput, ConversationCloseFn } from './types.js'

export type NoveltyCheckFn = (draft: IdeaDraftInput) => Promise<NoveltyDecision>

export type ExportConversationFn = () => Promise<string>

export type SubmissionExecuteFn = (input: SubmissionInput) => Promise<any>

function buildDuplicateMessage(decision: NoveltyDecision): ConversationCloseInput {
  const best = decision.matched_ideas?.[0]
  if (best?.idea_id) {
    return {
      reason: 'duplicate',
      message: `This idea already exists in WOFI: ${best.idea_id}`,
      idea_id: best.idea_id
    }
  }
  return {
    reason: 'duplicate',
    message: 'This idea appears to already exist in WOFI.'
  }
}

function buildRejectMessage(decision: NoveltyDecision): ConversationCloseInput {
  return {
    reason: 'rejected',
    message: decision.reason
  }
}

export function createSubmissionGate(args: {
  conversationId: string
  draftStore: DraftStore
  closeConversation: ConversationCloseFn
  noveltyCheck: NoveltyCheckFn
  exportConversation: ExportConversationFn
}): (execute: SubmissionExecuteFn) => SubmissionExecuteFn {
  return (execute) => {
    return async (input: SubmissionInput) => {
      const draftRecord = await args.draftStore.loadLatest(args.conversationId)
      if (!draftRecord) {
        throw new Error('No draft found for novelty check')
      }

      const decision = await args.noveltyCheck(draftRecord.draft)
      if (decision.decision === 'duplicate') {
        await args.closeConversation(buildDuplicateMessage(decision))
        throw new Error('Novelty check: duplicate')
      }

      if (decision.decision === 'reject') {
        await args.closeConversation(buildRejectMessage(decision))
        throw new Error('Novelty check: rejected')
      }

      const conversationExport = await args.exportConversation()

      const patchedInput: SubmissionInput = {
        ...input,
        conversation_export: conversationExport,
        mime_type: 'application/json'
      }

      return await execute(patchedInput)
    }
  }
}
