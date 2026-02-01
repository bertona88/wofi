import type { ClaimBundle, ConstructionRecord, IdeaRecord, SubmissionRecord } from '@wofi/query'
import type { ObjectStore } from '@wofi/store'
import type { Pool } from 'pg'
import type { IngestResult, Logger as IndexerLogger } from '@wofi/indexer'

export type ToolContext = {
  store: ObjectStore
  pool: Pool
  logger?: IndexerLogger
  allowUnsigned?: boolean
}

export type MintResult = {
  content_id: string
  tx_id: string
  already_existed: boolean
  ingest: IngestResult
}

export type IdeaDraftInput = {
  title: string
  kind: string
  summary?: string | null
  tags?: string[] | null
  metadata?: Record<string, unknown> | null
  created_at?: string | null
}

export type SubmissionInput = {
  conversation_export: string
  mime_type?: string | null
  context?:
    | {
        client?: 'web' | 'cli' | 'api' | null
        language?: string | null
        ui_version?: string | null
      }
    | null
  created_at?: string | null
}

export type ClaimInput = {
  claim_text: string
  claim_kind: 'binary' | 'credence'
  resolution?:
    | {
        criteria: string
        resolve_by?: string | null
      }
    | null
  metadata?: Record<string, unknown> | null
  created_at?: string | null
}

export type EvidenceInput = {
  kind: string
  locator: string
  hash?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string | null
}

export type ConstructionInput = {
  operator: 'compose' | 'specialize' | 'generalize' | 'analogize' | 'bundle' | 'refine'
  inputs: Array<{
    idea_id: string
    role?: string | null
    metadata?: Record<string, unknown> | null
  }>
  profile_id?: string | null
  params?: Record<string, unknown> | null
  constraints?: Record<string, unknown> | null
  created_at?: string | null
}

export type EdgeLinkInput = {
  rel:
    | 'INPUT_OF'
    | 'OUTPUT_OF'
    | 'IMPLEMENTS'
    | 'ABOUT'
    | 'SUPPORTS'
    | 'REFUTES'
    | 'ATTESTS'
    | 'SUBMITTED_AS'
    | 'DERIVED_FROM'
  from_id: string
  to_id: string
  created_at?: string | null
}

export type SearchIdeasResult = {
  items: SearchIdeasItem[]
  total: number
  note?: string
}

export type GetIdeaInput = {
  idea_id: string
}

export type GetIdeaResult = IdeaRecord

export type GetConstructionInput = {
  construction_id: string
}

export type GetConstructionResult = ConstructionRecord

export type GetClaimBundleInput = {
  target_id: string
  target_type?: 'idea' | 'implementation' | null
}

export type GetClaimBundleResult = ClaimBundle

export type GetSubmissionInput = {
  submission_id: string
}

export type GetSubmissionResult = SubmissionRecord

export type DecompositionEnqueueInput = {
  idea_id: string
  profile_id: string
  opts?: Record<string, unknown> | null
  force?: boolean | null
}

export type DecompositionEnqueueResult = {
  idea_id: string
  profile_id: string
  input_hash: string
  enqueued: boolean
}

export type SearchIdeasInput = {
  query: string
  limit?: number | null
  mode?: 'hybrid' | 'text' | 'vector' | null
  model?: string | null
  dimensions?: number | null
}

export type SearchIdeasItem = {
  id: string
  title: string | null
  kind: string | null
  summary: string | null
  tags: unknown | null
  created_at: string | null
  author_pubkey: string | null
  distance: number | null
  score: number | null
  source: 'text' | 'vector' | 'hybrid'
}
