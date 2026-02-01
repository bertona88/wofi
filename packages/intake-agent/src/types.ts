import type { IdeaDraftInput } from '@wofi/agent-tools'

export type IntakeStateName = 'draft' | 'final_proposed' | 'accepted' | 'rejected' | 'closed'

export type ConversationCloseReason = 'submitted' | 'rejected' | 'duplicate' | 'blocked' | 'closed'

export type IntakeConversationState = {
  state: IntakeStateName
  draftRev?: number
  draftHash?: string
  draftUpdatedAt?: string
  submissionId?: string
  ideaId?: string
  closedAt?: string
  closeReason?: ConversationCloseReason
}

export type DraftRecord = {
  conversation_id: string
  rev: number
  hash: string
  created_at: string
  draft: IdeaDraftInput
}

export type DraftSetResult = {
  rev: number
  hash: string
  state: 'draft' | 'final_proposed'
  updated_at: string
}
