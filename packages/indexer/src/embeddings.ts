import crypto from 'node:crypto'
import os from 'node:os'
import OpenAI from 'openai'
import type { Pool, PoolClient } from 'pg'
import { withClient } from './db.js'
import type { Logger } from './types.js'

const DEFAULT_MODEL = 'text-embedding-3-large'
const DEFAULT_DIMENSIONS = 3072
const DEFAULT_MAX_CHARS = 8000
const DEFAULT_BATCH_SIZE = 1
const DEFAULT_IDLE_MS = 1000

export type EmbeddingSpec = {
  model: string
  dimensions: number
  maxChars: number
}

export type EmbeddingWorkerConfig = EmbeddingSpec & {
  apiKey: string
  batchSize: number
  idleMs: number
  workerId: string
}

export type EnqueueEmbeddingResult = {
  idea_id: string
  model: string
  dimensions: number
  input_hash: string
  enqueued: boolean
}

type EmbeddingJobRow = {
  id: number
  idea_id: string
  model: string
  dimensions: number
  input_hash: string
  attempts: number
}

type IdeaEmbeddingSource = {
  title: string | null
  summary: string | null
  kind: string | null
  tags: unknown | null
}

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeText(value: string): string {
  return value.replace(/\u0000/g, '').trim()
}

function normalizeTags(tags: unknown): string[] {
  if (!tags) return []
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => (typeof tag === 'string' ? normalizeText(tag) : ''))
      .filter((tag) => tag.length > 0)
  }
  if (typeof tags === 'string') {
    const normalized = normalizeText(tags)
    return normalized ? [normalized] : []
  }
  if (typeof tags === 'object') {
    try {
      const normalized = JSON.stringify(tags)
      return normalized ? [normalized] : []
    } catch {
      return []
    }
  }
  return []
}

export function buildIdeaEmbeddingInput(idea: IdeaEmbeddingSource): string {
  const parts: string[] = []
  if (idea.title) {
    const title = normalizeText(idea.title)
    if (title) parts.push(`Title: ${title}`)
  }
  if (idea.summary) {
    const summary = normalizeText(idea.summary)
    if (summary) parts.push(`Summary: ${summary}`)
  }
  if (idea.kind) {
    const kind = normalizeText(idea.kind)
    if (kind) parts.push(`Kind: ${kind}`)
  }
  const tags = normalizeTags(idea.tags)
  if (tags.length > 0) {
    parts.push(`Tags: ${tags.join(', ')}`)
  }
  return parts.join('\n')
}

export function hashEmbeddingInput(text: string, spec: { model: string; dimensions: number }): string {
  const hash = crypto.createHash('sha256')
  hash.update(`model:${spec.model}\n`)
  hash.update(`dimensions:${spec.dimensions}\n`)
  hash.update(text)
  return `sha256:${hash.digest('hex')}`
}

export function resolveEmbeddingSpec(overrides?: Partial<EmbeddingSpec>): EmbeddingSpec {
  const model = overrides?.model ?? process.env.WOFI_EMBEDDING_MODEL ?? DEFAULT_MODEL
  const dimensions = overrides?.dimensions ?? toInt(process.env.WOFI_EMBEDDING_DIMENSIONS, DEFAULT_DIMENSIONS)
  const maxChars = overrides?.maxChars ?? toInt(process.env.WOFI_EMBEDDING_MAX_CHARS, DEFAULT_MAX_CHARS)
  return { model, dimensions, maxChars }
}

export function loadEmbeddingWorkerConfig(
  overrides?: Partial<EmbeddingWorkerConfig>
): EmbeddingWorkerConfig {
  const spec = resolveEmbeddingSpec(overrides)
  const apiKey =
    overrides?.apiKey ??
    process.env.WOFI_OPENAI_API_KEY ??
    process.env.OPENAI_API_KEY ??
    ''
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY (or WOFI_OPENAI_API_KEY) is required for embeddings')
  }
  const batchSize = overrides?.batchSize ?? toInt(process.env.WOFI_EMBEDDING_BATCH_SIZE, DEFAULT_BATCH_SIZE)
  const idleMs = overrides?.idleMs ?? toInt(process.env.WOFI_EMBEDDING_IDLE_MS, DEFAULT_IDLE_MS)
  const workerId = overrides?.workerId ?? process.env.WOFI_EMBEDDING_WORKER_ID ?? os.hostname()
  return { ...spec, apiKey, batchSize, idleMs, workerId }
}

function truncateInput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars)
}

function toVectorLiteral(embedding: number[]): string {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Embedding must be a non-empty array')
  }
  for (const value of embedding) {
    if (!Number.isFinite(value)) {
      throw new Error('Embedding contains non-finite values')
    }
  }
  return `[${embedding.join(',')}]`
}

async function fetchIdeaForEmbedding(client: PoolClient, ideaId: string): Promise<IdeaEmbeddingSource | null> {
  const res = await client.query<{
    title: string | null
    summary: string | null
    kind: string | null
    tags: unknown | null
  }>(
    `SELECT title, summary, kind, tags FROM ideas WHERE content_id = $1`,
    [ideaId]
  )
  if ((res.rowCount ?? 0) === 0) return null
  return res.rows[0] ?? null
}

export async function enqueueIdeaEmbedding(
  pool: Pool,
  ideaId: string,
  opts?: Partial<EmbeddingSpec> & { force?: boolean }
): Promise<EnqueueEmbeddingResult> {
  const spec = resolveEmbeddingSpec(opts)
  const idea = await withClient(pool, async (client) => {
    return await fetchIdeaForEmbedding(client, ideaId)
  })
  if (!idea) {
    throw new Error(`idea not found: ${ideaId}`)
  }

  const input = truncateInput(buildIdeaEmbeddingInput(idea), spec.maxChars)
  if (!input) {
    throw new Error('idea embedding input is empty')
  }
  const inputHash = hashEmbeddingInput(input, spec)

  const sql = opts?.force
    ? `INSERT INTO embedding_jobs (idea_id, model, dimensions, input_hash)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (idea_id, model, dimensions, input_hash)
       DO UPDATE SET status = 'queued', updated_at = now()`
    : `INSERT INTO embedding_jobs (idea_id, model, dimensions, input_hash)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`

  const res = await pool.query(sql, [ideaId, spec.model, spec.dimensions, inputHash])

  return {
    idea_id: ideaId,
    model: spec.model,
    dimensions: spec.dimensions,
    input_hash: inputHash,
    enqueued: (res.rowCount ?? 0) > 0
  }
}

async function claimEmbeddingJob(
  client: PoolClient,
  workerId: string
): Promise<EmbeddingJobRow | null> {
  const res = await client.query<EmbeddingJobRow>(
    `WITH next_job AS (
        SELECT id FROM embedding_jobs
        WHERE status IN ('queued', 'failed')
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE embedding_jobs
      SET status = 'processing',
          attempts = attempts + 1,
          last_error = NULL,
          claimed_at = now(),
          claimed_by = $1,
          updated_at = now()
      FROM next_job
      WHERE embedding_jobs.id = next_job.id
      RETURNING embedding_jobs.id,
                embedding_jobs.idea_id,
                embedding_jobs.model,
                embedding_jobs.dimensions,
                embedding_jobs.input_hash,
                embedding_jobs.attempts`,
    [workerId]
  )
  return res.rows[0] ?? null
}

async function markEmbeddingJobFailed(
  client: PoolClient,
  jobId: number,
  error: string
): Promise<void> {
  await client.query(
    `UPDATE embedding_jobs
     SET status = 'failed', last_error = $2, updated_at = now()
     WHERE id = $1`,
    [jobId, error]
  )
}

async function markEmbeddingJobDone(client: PoolClient, jobId: number): Promise<void> {
  await client.query(
    `UPDATE embedding_jobs
     SET status = 'done', last_error = NULL, updated_at = now()
     WHERE id = $1`,
    [jobId]
  )
}

async function updateEmbeddingJobHash(
  client: PoolClient,
  jobId: number,
  inputHash: string
): Promise<void> {
  await client.query(
    `UPDATE embedding_jobs
     SET input_hash = $2, updated_at = now()
     WHERE id = $1`,
    [jobId, inputHash]
  )
}

async function upsertIdeaEmbedding(
  client: PoolClient,
  params: {
    ideaId: string
    model: string
    dimensions: number
    inputHash: string
    embedding: number[]
  }
): Promise<void> {
  const vector = toVectorLiteral(params.embedding)
  await client.query(
    `INSERT INTO idea_embeddings (idea_id, model, dimensions, input_hash, embedding)
     VALUES ($1,$2,$3,$4,$5::vector)
     ON CONFLICT (idea_id, model, dimensions) DO UPDATE SET
       input_hash = EXCLUDED.input_hash,
       embedding = EXCLUDED.embedding,
       updated_at = now()`,
    [params.ideaId, params.model, params.dimensions, params.inputHash, vector]
  )
}

async function embedText(
  client: OpenAI,
  input: string,
  spec: { model: string; dimensions: number }
): Promise<number[]> {
  const response = await client.embeddings.create({
    model: spec.model,
    input,
    dimensions: spec.dimensions
  })
  const embedding = response.data?.[0]?.embedding
  if (!Array.isArray(embedding)) {
    throw new Error('Embeddings API returned no embedding data')
  }
  if (embedding.length !== spec.dimensions) {
    throw new Error(`Embedding length ${embedding.length} does not match ${spec.dimensions}`)
  }
  return embedding
}

export async function processEmbeddingJobs(
  pool: Pool,
  opts?: Partial<EmbeddingWorkerConfig> & { logger?: Logger }
): Promise<number> {
  const logger = opts?.logger
  const config = loadEmbeddingWorkerConfig(opts)

  if (config.dimensions !== DEFAULT_DIMENSIONS) {
    throw new Error(`Only ${DEFAULT_DIMENSIONS}-dim embeddings are supported in v0`)
  }

  const openai = new OpenAI({ apiKey: config.apiKey })
  let processed = 0

  for (let i = 0; i < config.batchSize; i += 1) {
    const job = await withClient(pool, async (client) => {
      return await claimEmbeddingJob(client, config.workerId)
    })

    if (!job) break

    try {
      if (job.dimensions !== DEFAULT_DIMENSIONS) {
        await withClient(pool, async (client) => {
          await markEmbeddingJobFailed(
            client,
            job.id,
            `unsupported embedding dimensions: ${job.dimensions}`
          )
        })
        continue
      }

      const idea = await withClient(pool, async (client) => {
        return await fetchIdeaForEmbedding(client, job.idea_id)
      })

      if (!idea) {
        await withClient(pool, async (client) => {
          await markEmbeddingJobFailed(client, job.id, 'idea not found')
        })
        continue
      }

      const input = truncateInput(buildIdeaEmbeddingInput(idea), config.maxChars)
      if (!input) {
        await withClient(pool, async (client) => {
          await markEmbeddingJobFailed(client, job.id, 'embedding input empty')
        })
        continue
      }

      const inputHash = hashEmbeddingInput(input, { model: job.model, dimensions: job.dimensions })
      if (inputHash !== job.input_hash) {
        await withClient(pool, async (client) => {
          await updateEmbeddingJobHash(client, job.id, inputHash)
        })
      }

      const embedding = await embedText(openai, input, {
        model: job.model,
        dimensions: job.dimensions
      })

      await withClient(pool, async (client) => {
        await upsertIdeaEmbedding(client, {
          ideaId: job.idea_id,
          model: job.model,
          dimensions: job.dimensions,
          inputHash,
          embedding
        })
        await markEmbeddingJobDone(client, job.id)
      })

      processed += 1
    } catch (err: any) {
      const message = err?.message ?? 'embedding job failed'
      await withClient(pool, async (client) => {
        await markEmbeddingJobFailed(client, job.id, message)
      })
      logger?.warn?.('embedding job failed', { jobId: job.id, error: message })
    }
  }

  return processed
}

export async function runEmbeddingWorker(
  pool: Pool,
  opts?: Partial<EmbeddingWorkerConfig> & { logger?: Logger; watch?: boolean }
): Promise<void> {
  const logger = opts?.logger
  const config = loadEmbeddingWorkerConfig(opts)
  const watch = opts?.watch === true

  let processed = 0
  do {
    const nextOpts: Partial<EmbeddingWorkerConfig> & { logger?: Logger } = { ...config }
    if (logger) nextOpts.logger = logger
    processed = await processEmbeddingJobs(pool, nextOpts)
    if (processed === 0 && watch) {
      await new Promise((resolve) => setTimeout(resolve, config.idleMs))
    }
  } while (processed > 0 || watch)
}
