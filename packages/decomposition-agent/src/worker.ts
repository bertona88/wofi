import { createPool, loadConfig, runDecompositionWorker } from '@wofi/indexer'
import type { DecompositionWorkerConfig, Logger } from '@wofi/indexer'
import { runDecompositionJob } from './decomposition-agent.js'

export type DecompositionWorkerOptions = {
  logger?: Logger
  watch?: boolean
  overrides?: Partial<DecompositionWorkerConfig>
  model?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  searchContextSize?: 'low' | 'medium' | 'high'
  allowedDomains?: string[]
  maxTurns?: number
}

export async function runDecompositionAgentWorker(
  opts: DecompositionWorkerOptions = {}
): Promise<void> {
  const config = loadConfig()
  const pool = createPool(config.databaseUrl)

  const runOpts: Parameters<typeof runDecompositionWorker>[1] = {
    ...(opts.overrides ?? {}),
    handler: async (job) => {
      const jobOpts = {
        ...(opts.logger ? { logger: opts.logger } : {}),
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
        ...(opts.searchContextSize ? { searchContextSize: opts.searchContextSize } : {}),
        ...(opts.allowedDomains ? { allowedDomains: opts.allowedDomains } : {}),
        ...(opts.maxTurns ? { maxTurns: opts.maxTurns } : {})
      }
      await runDecompositionJob(pool, job, jobOpts)
    }
  }
  if (opts.logger) runOpts.logger = opts.logger
  if (opts.watch !== undefined) runOpts.watch = opts.watch

  await runDecompositionWorker(pool, runOpts)

  await pool.end()
}
