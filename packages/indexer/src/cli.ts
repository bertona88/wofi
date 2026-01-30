#!/usr/bin/env node
import { loadConfig } from './config.js'
import { createLogger } from './logger.js'
import { createPool } from './db.js'
import { runMigrations } from './migrations.js'
import { ingestOutboxBatch, ingestObject } from './ingest.js'
import { backfillFromArweave } from './backfill.js'
import { createArweaveClient } from './arweave.js'
import type { IndexerConfig } from './types.js'

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg) continue
    if (!arg.startsWith('--')) continue
    const [key, value] = arg.slice(2).split('=')
    if (!key) continue
    if (value !== undefined) {
      out[key] = value
    } else {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        out[key] = next
        i += 1
      } else {
        out[key] = true
      }
    }
  }
  return out
}

async function runSync(args: Record<string, string | boolean>): Promise<void> {
  const overrides: Partial<IndexerConfig> = {}
  if (typeof args['batch-size'] === 'string') {
    overrides.batchSize = Number(args['batch-size'])
  }
  const config = loadConfig(overrides)
  const logger = createLogger({ json: args['log-json'] === true })
  const pool = createPool(config.databaseUrl)

  let processed = 0
  do {
    processed = await ingestOutboxBatch(pool, {
      batchSize: config.batchSize,
      allowUnsigned: config.allowUnsigned,
      logger
    })
  } while (processed > 0)

  await pool.end()
}

async function runBackfill(args: Record<string, string | boolean>): Promise<void> {
  const overrides: Partial<IndexerConfig> = {}
  if (typeof args['batch-size'] === 'string') {
    overrides.batchSize = Number(args['batch-size'])
  }
  const config = loadConfig(overrides)
  const logger = createLogger({ json: args['log-json'] === true })
  const pool = createPool(config.databaseUrl)

  const backfillOpts: Parameters<typeof backfillFromArweave>[1] = {
    batchSize: config.batchSize,
    allowUnsigned: config.allowUnsigned,
    gatewayUrl: config.arweaveGatewayUrl,
    logger
  }
  if (typeof args.type === 'string') backfillOpts.type = args.type
  if (typeof args.from === 'string') {
    const parsed = new Date(args.from)
    if (!Number.isNaN(parsed.getTime())) backfillOpts.from = parsed
  }

  await backfillFromArweave(pool, backfillOpts)

  await pool.end()
}

async function runReplay(args: Record<string, string | boolean>): Promise<void> {
  const contentId = typeof args['content-id'] === 'string' ? args['content-id'] : ''
  if (!contentId) {
    throw new Error('--content-id is required for replay')
  }

  const config = loadConfig()
  const logger = createLogger({ json: args['log-json'] === true })
  const pool = createPool(config.databaseUrl)

  const preferArweave = args['from-arweave'] === true
  let canonicalJson: any | null = null
  let txId: string | null = null

  if (!preferArweave) {
    const res = await pool.query<{ canonical_json: any; arweave_tx_id: string | null }>(
      `SELECT canonical_json, arweave_tx_id FROM objects WHERE content_id = $1`,
      [contentId]
    )
    if ((res.rowCount ?? 0) > 0) {
      canonicalJson = res.rows[0]?.canonical_json ?? null
      txId = res.rows[0]?.arweave_tx_id ?? null
    }
  }

  if (!canonicalJson) {
    const arweave = createArweaveClient({ gatewayUrl: config.arweaveGatewayUrl })
    const found = await arweave.lookupTxIdByContentId(contentId)
    if (!found) {
      throw new Error('Content ID not found in Arweave')
    }
    const raw = await arweave.getTransactionData(found)
    if (!raw) {
      throw new Error('Failed to fetch Arweave payload')
    }
    canonicalJson = JSON.parse(raw)
    txId = found
  }

  const result = await ingestObject(
    pool,
    { canonicalJson, contentId, txId },
    { allowUnsigned: config.allowUnsigned, logger }
  )
  logger.info?.('replay result', result as any)
  await pool.end()
}

async function runMigrate(args: Record<string, string | boolean>): Promise<void> {
  const config = loadConfig()
  const logger = createLogger({ json: args['log-json'] === true })
  const pool = createPool(config.databaseUrl)
  await runMigrations(pool, { logger })
  await pool.end()
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  const args = parseArgs(rest)

  switch (command) {
    case 'sync':
      if (!args['from-outbox']) {
        throw new Error('sync requires --from-outbox')
      }
      await runSync(args)
      return
    case 'backfill':
      await runBackfill(args)
      return
    case 'replay':
      await runReplay(args)
      return
    case 'migrate':
      await runMigrate(args)
      return
    default:
      throw new Error('Usage: indexer <sync|backfill|replay|migrate> [--flags]')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
