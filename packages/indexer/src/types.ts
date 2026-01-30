export type Logger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void
  info?: (message: string, meta?: Record<string, unknown>) => void
  warn?: (message: string, meta?: Record<string, unknown>) => void
  error?: (message: string, meta?: Record<string, unknown>) => void
}

export type IndexerConfig = {
  databaseUrl: string
  allowUnsigned: boolean
  batchSize: number
  concurrency: number
  arweaveGatewayUrl: string
  migrationsDir?: string
}

export type IngestStatus = 'ok' | 'failed' | 'deferred'

export type IngestResult = {
  contentId: string
  wofiType: string
  status: IngestStatus
  error?: string
  missingRef?: string
}

export type OutboxRow = {
  content_id: string
  canonical_json: unknown
  arweave_tx_id?: string | null
  tx_id?: string | null
}

export type BackfillOptions = {
  type?: string
  from?: Date
  source?: string
  batchSize?: number
  allowUnsigned?: boolean
}

export type SyncOptions = {
  batchSize?: number
  allowUnsigned?: boolean
}

export type ReplayOptions = {
  allowUnsigned?: boolean
  preferArweave?: boolean
}
