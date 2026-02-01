import crypto from 'node:crypto'
import os from 'node:os'
import type { Pool, PoolClient } from 'pg'
import { withClient } from './db.js'
import type { Logger } from './types.js'

const DEFAULT_BATCH_SIZE = 1
const DEFAULT_IDLE_MS = 1000

export type DecompositionJobStatus = 'queued' | 'processing' | 'done' | 'failed'

export type DecompositionJob = {
  id: number
  idea_id: string
  profile_id: string
  opts_json: Record<string, unknown> | null
  input_hash: string
  attempts: number
}

export type EnqueueDecompositionResult = {
  idea_id: string
  profile_id: string
  input_hash: string
  enqueued: boolean
}

export type DecompositionWorkerConfig = {
  batchSize: number
  idleMs: number
  workerId: string
}

type DecompositionJobRow = {
  id: number
  idea_id: string
  profile_id: string
  opts_json: Record<string, unknown> | null
  input_hash: string
  attempts: number
}

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return val
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(val).sort()) {
      sorted[key] = (val as Record<string, unknown>)[key]
    }
    return sorted
  })
}

export function hashDecompositionInput(payload: {
  ideaId: string
  profileId: string
  opts?: Record<string, unknown> | null
}): string {
  const hash = crypto.createHash('sha256')
  hash.update('decomposition:v0\n')
  hash.update(`idea:${payload.ideaId}\n`)
  hash.update(`profile:${payload.profileId}\n`)
  hash.update(`opts:${stableStringify(payload.opts ?? null)}`)
  return `sha256:${hash.digest('hex')}`
}

export function loadDecompositionWorkerConfig(
  overrides?: Partial<DecompositionWorkerConfig>
): DecompositionWorkerConfig {
  const batchSize = overrides?.batchSize ?? toInt(process.env.WOFI_DECOMPOSITION_BATCH_SIZE, DEFAULT_BATCH_SIZE)
  const idleMs = overrides?.idleMs ?? toInt(process.env.WOFI_DECOMPOSITION_IDLE_MS, DEFAULT_IDLE_MS)
  const workerId = overrides?.workerId ?? process.env.WOFI_DECOMPOSITION_WORKER_ID ?? os.hostname()
  return { batchSize, idleMs, workerId }
}

async function ensureIdeaExists(client: PoolClient, ideaId: string): Promise<void> {
  const res = await client.query<{ content_id: string }>(
    'SELECT content_id FROM ideas WHERE content_id = $1',
    [ideaId]
  )
  if ((res.rowCount ?? 0) === 0) {
    throw new Error(`idea not found: ${ideaId}`)
  }
}

export async function enqueueDecompositionJob(
  pool: Pool,
  ideaId: string,
  profileId: string,
  opts?: { opts?: Record<string, unknown>; force?: boolean }
): Promise<EnqueueDecompositionResult> {
  const inputHash = hashDecompositionInput({ ideaId, profileId, opts: opts?.opts ?? null })

  await withClient(pool, async (client) => {
    await ensureIdeaExists(client, ideaId)
  })

  const sql = opts?.force
    ? `INSERT INTO decomposition_jobs (idea_id, profile_id, opts_json, input_hash)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (idea_id, profile_id, input_hash)
       DO UPDATE SET status = 'queued', updated_at = now()`
    : `INSERT INTO decomposition_jobs (idea_id, profile_id, opts_json, input_hash)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`

  const res = await pool.query(sql, [ideaId, profileId, opts?.opts ?? null, inputHash])

  return {
    idea_id: ideaId,
    profile_id: profileId,
    input_hash: inputHash,
    enqueued: (res.rowCount ?? 0) > 0
  }
}

async function claimDecompositionJob(
  client: PoolClient,
  workerId: string
): Promise<DecompositionJobRow | null> {
  const res = await client.query<DecompositionJobRow>(
    `WITH next_job AS (
        SELECT id FROM decomposition_jobs
        WHERE status IN ('queued', 'failed')
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE decomposition_jobs
      SET status = 'processing',
          attempts = attempts + 1,
          last_error = NULL,
          claimed_at = now(),
          claimed_by = $1,
          updated_at = now()
      FROM next_job
      WHERE decomposition_jobs.id = next_job.id
      RETURNING decomposition_jobs.id,
                decomposition_jobs.idea_id,
                decomposition_jobs.profile_id,
                decomposition_jobs.opts_json,
                decomposition_jobs.input_hash,
                decomposition_jobs.attempts`,
    [workerId]
  )
  return res.rows[0] ?? null
}

async function markDecompositionJobFailed(
  client: PoolClient,
  jobId: number,
  error: string
): Promise<void> {
  await client.query(
    `UPDATE decomposition_jobs
     SET status = 'failed', last_error = $2, updated_at = now()
     WHERE id = $1`,
    [jobId, error]
  )
}

async function markDecompositionJobDone(client: PoolClient, jobId: number): Promise<void> {
  await client.query(
    `UPDATE decomposition_jobs
     SET status = 'done', last_error = NULL, updated_at = now()
     WHERE id = $1`,
    [jobId]
  )
}

export async function processDecompositionJobs(
  pool: Pool,
  opts?: Partial<DecompositionWorkerConfig> & {
    logger?: Logger
    handler?: (job: DecompositionJob) => Promise<void>
  }
): Promise<number> {
  const logger = opts?.logger
  const config = loadDecompositionWorkerConfig(opts)
  const handler = opts?.handler

  let processed = 0

  for (let i = 0; i < config.batchSize; i += 1) {
    const job = await withClient(pool, async (client) => {
      return await claimDecompositionJob(client, config.workerId)
    })

    if (!job) break

    try {
      if (handler) {
        await handler(job)
      } else {
        logger?.info?.('decomposition job claimed (noop)', {
          jobId: job.id,
          ideaId: job.idea_id,
          profileId: job.profile_id
        })
      }

      await withClient(pool, async (client) => {
        await markDecompositionJobDone(client, job.id)
      })

      processed += 1
    } catch (err: any) {
      const message = err?.message ?? 'decomposition job failed'
      await withClient(pool, async (client) => {
        await markDecompositionJobFailed(client, job.id, message)
      })
      logger?.warn?.('decomposition job failed', { jobId: job.id, error: message })
    }
  }

  return processed
}

export async function runDecompositionWorker(
  pool: Pool,
  opts?: Partial<DecompositionWorkerConfig> & {
    logger?: Logger
    watch?: boolean
    handler?: (job: DecompositionJob) => Promise<void>
  }
): Promise<void> {
  const logger = opts?.logger
  const config = loadDecompositionWorkerConfig(opts)
  const watch = opts?.watch === true

  let processed = 0
  do {
    const nextOpts: Partial<DecompositionWorkerConfig> & {
      logger?: Logger
      handler?: (job: DecompositionJob) => Promise<void>
    } = { ...config }
    if (logger) nextOpts.logger = logger
    if (opts?.handler) nextOpts.handler = opts.handler
    processed = await processDecompositionJobs(pool, nextOpts)
    if (processed === 0 && watch) {
      await new Promise((resolve) => setTimeout(resolve, config.idleMs))
    }
  } while (processed > 0 || watch)
}
