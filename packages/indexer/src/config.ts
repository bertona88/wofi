import type { IndexerConfig } from './types.js'

const DEFAULT_BATCH_SIZE = 50
const DEFAULT_CONCURRENCY = 1
const DEFAULT_ARWEAVE_GATEWAY = 'https://arweave.net'

function toBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback
  return value.toLowerCase() === 'true' || value === '1'
}

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function loadConfig(overrides?: Partial<IndexerConfig>): IndexerConfig {
  const env = process.env
  const databaseUrl =
    overrides?.databaseUrl ?? env.DATABASE_URL ?? env.WOFI_DATABASE_URL ?? ''

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for @wofi/indexer')
  }

  const allowUnsigned =
    overrides?.allowUnsigned ??
    (toBool(env.WOFI_INDEXER_ALLOW_UNSIGNED, false) ||
      toBool(env.WOFI_STORE_ALLOW_UNSIGNED, false))

  const batchSize = overrides?.batchSize ?? toInt(env.WOFI_INDEXER_BATCH_SIZE, DEFAULT_BATCH_SIZE)
  const concurrency = overrides?.concurrency ??
    toInt(env.WOFI_INDEXER_CONCURRENCY, DEFAULT_CONCURRENCY)

  const arweaveGatewayUrl =
    overrides?.arweaveGatewayUrl ?? env.ARWEAVE_GATEWAY_URL ?? DEFAULT_ARWEAVE_GATEWAY

  const base = {
    databaseUrl,
    allowUnsigned,
    batchSize,
    concurrency,
    arweaveGatewayUrl
  }

  if (overrides?.migrationsDir !== undefined) {
    return { ...base, migrationsDir: overrides.migrationsDir }
  }

  return base
}
