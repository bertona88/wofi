import { createLogger } from '@wofi/indexer'
import type { DecompositionWorkerConfig } from '@wofi/indexer'
import { runDecompositionAgentWorker } from './worker.js'

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg || !arg.startsWith('--')) continue
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

function parseDomains(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== 'string') return undefined
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return entries.length > 0 ? entries : undefined
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const logger = createLogger({ json: args['log-json'] === true })

  const overrides: Partial<DecompositionWorkerConfig> = {}
  if (typeof args['batch-size'] === 'string') overrides.batchSize = Number(args['batch-size'])
  if (typeof args['idle-ms'] === 'string') overrides.idleMs = Number(args['idle-ms'])
  if (typeof args['worker-id'] === 'string') overrides.workerId = args['worker-id']

  const watch = args.watch === true

  const workerOpts: Parameters<typeof runDecompositionAgentWorker>[0] = {
    logger,
    watch,
    overrides
  }

  if (typeof args.model === 'string') workerOpts.model = args.model
  if (typeof args.reasoning === 'string') {
    workerOpts.reasoningEffort = args.reasoning as 'minimal' | 'low' | 'medium' | 'high'
  }
  if (typeof args['search-context'] === 'string') {
    workerOpts.searchContextSize = args['search-context'] as 'low' | 'medium' | 'high'
  }
  if (typeof args['max-turns'] === 'string') {
    const parsed = Number(args['max-turns'])
    if (Number.isFinite(parsed) && parsed > 0) workerOpts.maxTurns = parsed
  }
  const allowedDomains = parseDomains(args['allowed-domains'])
  if (allowedDomains) workerOpts.allowedDomains = allowedDomains

  await runDecompositionAgentWorker(workerOpts)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
