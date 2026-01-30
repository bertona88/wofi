import type { Pool } from 'pg'
import { createArweaveClient } from './arweave.js'
import { ingestObject, retryDeferred } from './ingest.js'
import type { BackfillOptions, Logger } from './types.js'

const DEFAULT_TYPES = [
  'wofi.idea.v1',
  'wofi.profile.v1',
  'wofi.construction.v1',
  'wofi.implementation.v1',
  'wofi.claim.v1',
  'wofi.evidence.v1',
  'wofi.submission.v1',
  'wofi.edge.v1'
]

async function getCheckpoint(pool: Pool, source: string, wofiType: string): Promise<string | null> {
  const res = await pool.query<{ cursor: string | null }>(
    `SELECT cursor FROM backfill_checkpoints WHERE source = $1 AND wofi_type = $2`,
    [source, wofiType]
  )
  return res.rows[0]?.cursor ?? null
}

async function updateCheckpoint(pool: Pool, source: string, wofiType: string, cursor: string): Promise<void> {
  await pool.query(
    `INSERT INTO backfill_checkpoints (source, wofi_type, cursor)
     VALUES ($1,$2,$3)
     ON CONFLICT (source, wofi_type) DO UPDATE
       SET cursor = EXCLUDED.cursor, updated_at = now()`,
    [source, wofiType, cursor]
  )
}

function parseFrom(value?: string | Date): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function createdAfter(obj: Record<string, any>, minDate: Date | null): boolean {
  if (!minDate) return true
  const created = obj.created_at ? new Date(obj.created_at) : null
  if (!created || Number.isNaN(created.getTime())) return false
  return created >= minDate
}

export async function backfillFromArweave(
  pool: Pool,
  opts: BackfillOptions & { logger?: Logger; gatewayUrl?: string }
): Promise<void> {
  const logger = opts.logger
  const source = opts.source ?? 'arweave'
  const types = opts.type ? [opts.type] : DEFAULT_TYPES
  const minDate = parseFrom(opts.from)
  const batchSize = opts.batchSize ?? 50

  const client = createArweaveClient(opts.gatewayUrl ? { gatewayUrl: opts.gatewayUrl } : {})

  for (const wofiType of types) {
    let cursor = await getCheckpoint(pool, source, wofiType)
    let keepGoing = true

    while (keepGoing) {
      const list = await client.listTransactions({ type: wofiType, after: cursor, first: batchSize })
      if (list.edges.length === 0) {
        keepGoing = false
        break
      }

      for (const edge of list.edges) {
        const raw = await client.getTransactionData(edge.id)
        if (!raw) continue
        let parsed: Record<string, any>
        try {
          parsed = JSON.parse(raw)
        } catch {
          continue
        }
        if (!createdAfter(parsed, minDate)) {
          cursor = edge.cursor
          await updateCheckpoint(pool, source, wofiType, cursor)
          continue
        }

        const ingestOpts: { allowUnsigned?: boolean; logger?: Logger } = {}
        if (opts.allowUnsigned !== undefined) ingestOpts.allowUnsigned = opts.allowUnsigned
        if (logger) ingestOpts.logger = logger
        const result = await ingestObject(
          pool,
          { canonicalJson: parsed, contentId: parsed.content_id, txId: edge.id },
          Object.keys(ingestOpts).length > 0 ? ingestOpts : undefined
        )
        logger?.info?.('backfill ingest', {
          content_id: result.contentId,
          wofi_type: result.wofiType,
          status: result.status
        })

        cursor = edge.cursor
        await updateCheckpoint(pool, source, wofiType, cursor)
      }

      const retryOpts: { limit: number; allowUnsigned?: boolean; logger?: Logger } = { limit: batchSize }
      if (opts.allowUnsigned !== undefined) retryOpts.allowUnsigned = opts.allowUnsigned
      if (logger) retryOpts.logger = logger
      await retryDeferred(pool, retryOpts)
    }
  }
}
