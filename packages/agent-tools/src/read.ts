import OpenAI from 'openai'
import {
  getClaimBundle as queryGetClaimBundle,
  getConstruction as queryGetConstruction,
  getIdea as queryGetIdea,
  getSubmission as queryGetSubmission,
  searchIdeasByEmbedding
} from '@wofi/query'
import type {
  GetClaimBundleInput,
  GetClaimBundleResult,
  GetConstructionInput,
  GetConstructionResult,
  GetIdeaInput,
  GetIdeaResult,
  GetSubmissionInput,
  GetSubmissionResult,
  SearchIdeasInput,
  SearchIdeasItem,
  SearchIdeasResult,
  ToolContext
} from './types.js'

const DEFAULT_MODEL = 'text-embedding-3-large'
const DEFAULT_DIMENSIONS = 3072
const DEFAULT_LIMIT = 10
const DEFAULT_MAX_CHARS = 8000

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function truncateInput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars)
}

function resolveEmbeddingConfig(input?: SearchIdeasInput): {
  model: string
  dimensions: number
  maxChars: number
} {
  const model = input?.model ?? process.env.WOFI_EMBEDDING_MODEL ?? DEFAULT_MODEL
  const dimensions =
    input?.dimensions ??
    toInt(process.env.WOFI_EMBEDDING_DIMENSIONS, DEFAULT_DIMENSIONS)
  const maxChars = toInt(process.env.WOFI_EMBEDDING_MAX_CHARS, DEFAULT_MAX_CHARS)
  return { model, dimensions, maxChars }
}

function resolveApiKey(): string {
  return process.env.WOFI_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? ''
}

function requireNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required`)
  }
}

async function embedQuery(
  query: string,
  cfg: { model: string; dimensions: number; maxChars: number }
): Promise<number[]> {
  if (cfg.dimensions !== DEFAULT_DIMENSIONS) {
    throw new Error(`Only ${DEFAULT_DIMENSIONS}-dim embeddings are supported in v0`)
  }
  const apiKey = resolveApiKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY (or WOFI_OPENAI_API_KEY) is required for vector search')
  }
  const openai = new OpenAI({ apiKey })
  const input = truncateInput(query, cfg.maxChars)
  const response = await openai.embeddings.create({
    model: cfg.model,
    input,
    dimensions: cfg.dimensions
  })
  const embedding = response.data?.[0]?.embedding
  if (!Array.isArray(embedding)) {
    throw new Error('Embeddings API returned no embedding data')
  }
  return embedding
}

async function searchIdeasText(
  ctx: ToolContext,
  query: string,
  limit: number
): Promise<SearchIdeasItem[]> {
  const like = `%${query}%`
  const res = await ctx.pool.query<{
    content_id: string
    title: string | null
    kind: string | null
    summary: string | null
    tags: unknown | null
    created_at: string | null
    author_pubkey: string | null
  }>(
    `SELECT content_id, title, kind, summary, tags, created_at, author_pubkey
     FROM ideas
     WHERE title ILIKE $1 OR summary ILIKE $1 OR tags::text ILIKE $1
     ORDER BY created_at DESC NULLS LAST
     LIMIT $2`,
    [like, limit]
  )

  return res.rows.map((row) => ({
    id: row.content_id,
    title: row.title,
    kind: row.kind,
    summary: row.summary,
    tags: row.tags,
    created_at: row.created_at,
    author_pubkey: row.author_pubkey,
    distance: null,
    score: null,
    source: 'text'
  }))
}

async function searchIdeasVector(
  ctx: ToolContext,
  query: string,
  limit: number,
  cfg: { model: string; dimensions: number; maxChars: number }
): Promise<SearchIdeasItem[]> {
  const embedding = await embedQuery(query, cfg)
  const results = await searchIdeasByEmbedding(ctx.pool, embedding, {
    limit,
    model: cfg.model,
    dimensions: cfg.dimensions
  })

  return results.map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    summary: row.summary,
    tags: row.tags,
    created_at: row.created_at,
    author_pubkey: row.author_pubkey,
    distance: row.distance,
    score: row.score,
    source: 'vector'
  }))
}

export async function searchIdeas(
  ctx: ToolContext,
  input: SearchIdeasInput
): Promise<SearchIdeasResult> {
  const query = input.query?.trim()
  if (!query) {
    return { items: [], total: 0, note: 'empty query' }
  }

  const limit = input.limit ?? DEFAULT_LIMIT
  const mode = input.mode ?? 'hybrid'
  const cfg = resolveEmbeddingConfig(input)

  if (mode === 'text') {
    const items = await searchIdeasText(ctx, query, limit)
    return { items, total: items.length }
  }

  if (mode === 'vector') {
    const items = await searchIdeasVector(ctx, query, limit, cfg)
    return { items, total: items.length }
  }

  const vectorItems = await searchIdeasVector(ctx, query, limit, cfg)
  const textItems = await searchIdeasText(ctx, query, limit)

  const merged: SearchIdeasItem[] = []
  const byId = new Map<string, SearchIdeasItem>()

  const pushItem = (item: SearchIdeasItem, source: 'text' | 'vector') => {
    const existing = byId.get(item.id)
    if (existing) {
      if (existing.source !== source) existing.source = 'hybrid'
      if (existing.score === null && item.score !== null) existing.score = item.score
      if (existing.distance === null && item.distance !== null) existing.distance = item.distance
      return
    }
    const next = { ...item, source }
    byId.set(item.id, next)
    merged.push(next)
  }

  for (const item of vectorItems) pushItem(item, 'vector')
  for (const item of textItems) pushItem(item, 'text')

  const items = merged.slice(0, limit)
  return { items, total: items.length }
}

export async function getIdea(ctx: ToolContext, input: GetIdeaInput): Promise<GetIdeaResult> {
  requireNonEmpty(input.idea_id, 'idea_id')
  return await queryGetIdea(ctx.pool, input.idea_id)
}

export async function getConstruction(
  ctx: ToolContext,
  input: GetConstructionInput
): Promise<GetConstructionResult> {
  requireNonEmpty(input.construction_id, 'construction_id')
  return await queryGetConstruction(ctx.pool, input.construction_id)
}

export async function getClaimBundle(
  ctx: ToolContext,
  input: GetClaimBundleInput
): Promise<GetClaimBundleResult> {
  requireNonEmpty(input.target_id, 'target_id')
  const opts = input.target_type ? { targetType: input.target_type } : undefined
  return await queryGetClaimBundle(ctx.pool, input.target_id, opts)
}

export async function getSubmission(
  ctx: ToolContext,
  input: GetSubmissionInput
): Promise<GetSubmissionResult> {
  requireNonEmpty(input.submission_id, 'submission_id')
  return await queryGetSubmission(ctx.pool, input.submission_id)
}
