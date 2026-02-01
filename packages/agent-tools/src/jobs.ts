import { enqueueDecompositionJob } from '@wofi/indexer'
import type {
  DecompositionEnqueueInput,
  DecompositionEnqueueResult,
  ToolContext
} from './types.js'

function requireNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required`)
  }
}

export async function enqueueDecomposition(
  ctx: ToolContext,
  input: DecompositionEnqueueInput
): Promise<DecompositionEnqueueResult> {
  requireNonEmpty(input.idea_id, 'idea_id')
  requireNonEmpty(input.profile_id, 'profile_id')

  const opts: { opts?: Record<string, unknown>; force?: boolean } = {}
  if (input.opts !== null && input.opts !== undefined) opts.opts = input.opts
  if (input.force !== null && input.force !== undefined) opts.force = input.force

  return await enqueueDecompositionJob(ctx.pool, input.idea_id, input.profile_id, opts)
}
