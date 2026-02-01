import { contentId, validateInvariants, validateSchema } from '@wofi/kernel'
import { ingestObject } from '@wofi/indexer'
import type { Pool } from 'pg'
import type {
  ToolContext,
  MintResult,
  IdeaDraftInput,
  SubmissionInput,
  ClaimInput,
  EvidenceInput,
  ConstructionInput,
  EdgeLinkInput
} from './types.js'

const EDGE_TYPE_BY_WOFI: Record<string, string> = {
  'wofi.idea.v1': 'idea',
  'wofi.construction.v1': 'construction',
  'wofi.claim.v1': 'claim',
  'wofi.evidence.v1': 'evidence',
  'wofi.submission.v1': 'submission',
  'wofi.implementation.v1': 'implementation',
  'wofi.profile.v1': 'profile'
}

const EDGE_TABLE_BY_WOFI: Record<string, string> = {
  'wofi.idea.v1': 'ideas',
  'wofi.construction.v1': 'constructions',
  'wofi.claim.v1': 'claims',
  'wofi.evidence.v1': 'evidence',
  'wofi.submission.v1': 'submissions',
  'wofi.implementation.v1': 'implementations',
  'wofi.profile.v1': 'profiles'
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim().length > 0 ? value : undefined
}

function normalizeOptionalObject<T extends Record<string, unknown>>(
  value: T | null | undefined
): T | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value
}

function compactObject<T extends Record<string, unknown>>(
  value: T | null | undefined
): T | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined) continue
    out[key] = entry
  }
  return Object.keys(out).length > 0 ? (out as T) : undefined
}

function requireNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required`)
  }
}

async function ensureTypedRows(
  pool: Pool,
  table: string,
  ids: string[],
  label: string
): Promise<void> {
  if (ids.length === 0) return
  const res = await pool.query<{ content_id: string }>(
    `SELECT content_id FROM ${table} WHERE content_id = ANY($1)`,
    [ids]
  )
  const found = new Set(res.rows.map((row) => row.content_id))
  const missing = ids.filter((id) => !found.has(id))
  if (missing.length > 0) {
    throw new Error(`Missing ${label} ids: ${missing.join(', ')}`)
  }
}

async function lookupObjectTypes(
  pool: Pool,
  ids: string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const res = await pool.query<{ content_id: string; wofi_type: string }>(
    `SELECT content_id, wofi_type
     FROM objects
     WHERE content_id = ANY($1) AND ingest_status = 'ok'`,
    [ids]
  )
  const map = new Map<string, string>()
  for (const row of res.rows) {
    map.set(row.content_id, row.wofi_type)
  }
  return map
}

function assertEdgeRelation(rel: string, fromType: string, toType: string): void {
  switch (rel) {
    case 'INPUT_OF':
      if (!(fromType === 'idea' && toType === 'construction')) {
        throw new Error('INPUT_OF must be Idea -> Construction')
      }
      break
    case 'OUTPUT_OF':
      if (!(fromType === 'construction' && toType === 'idea')) {
        throw new Error('OUTPUT_OF must be Construction -> Idea')
      }
      break
    case 'SUPPORTS':
    case 'REFUTES':
      if (!(fromType === 'evidence' && toType === 'claim')) {
        throw new Error(`${rel} must be Evidence -> Claim`)
      }
      break
    case 'ABOUT':
      if (!(fromType === 'claim' && (toType === 'idea' || toType === 'implementation'))) {
        throw new Error('ABOUT must be Claim -> Idea|Implementation')
      }
      break
    case 'IMPLEMENTS':
      if (!(fromType === 'implementation' && toType === 'idea')) {
        throw new Error('IMPLEMENTS must be Implementation -> Idea')
      }
      break
    case 'SUBMITTED_AS':
      if (!(fromType === 'submission' && toType === 'idea')) {
        throw new Error('SUBMITTED_AS must be Submission -> Idea')
      }
      break
    case 'DERIVED_FROM':
      if (toType !== 'submission') {
        throw new Error('DERIVED_FROM must target Submission')
      }
      if (
        !(
          fromType === 'idea' ||
          fromType === 'claim' ||
          fromType === 'construction' ||
          fromType === 'implementation' ||
          fromType === 'evidence'
        )
      ) {
        throw new Error('DERIVED_FROM must originate from Idea|Claim|Construction|Implementation|Evidence')
      }
      break
    default:
      break
  }
}

async function ensureEdgeEndpoints(
  pool: Pool,
  rel: string,
  fromId: string,
  toId: string
): Promise<{ fromKind: string; toKind: string }> {
  const types = await lookupObjectTypes(pool, [fromId, toId])
  const fromType = types.get(fromId)
  const toType = types.get(toId)
  if (!fromType) throw new Error(`Missing edge from object: ${fromId}`)
  if (!toType) throw new Error(`Missing edge to object: ${toId}`)

  const fromKind = EDGE_TYPE_BY_WOFI[fromType]
  const toKind = EDGE_TYPE_BY_WOFI[toType]
  if (!fromKind || !toKind) {
    throw new Error('Unsupported edge endpoint types')
  }

  assertEdgeRelation(rel, fromKind, toKind)

  const fromTable = EDGE_TABLE_BY_WOFI[fromType]
  const toTable = EDGE_TABLE_BY_WOFI[toType]
  if (fromTable) {
    await ensureTypedRows(pool, fromTable, [fromId], fromKind)
  }
  if (toTable) {
    await ensureTypedRows(pool, toTable, [toId], toKind)
  }

  return { fromKind, toKind }
}

async function mintKernelObject(ctx: ToolContext, obj: Record<string, any>): Promise<MintResult> {
  const allowUnsigned = ctx.allowUnsigned ?? true
  const computedId = contentId(obj)
  await ctx.store.hasContentId(computedId)

  const objectToStore = { ...obj, content_id: computedId }
  const put = await ctx.store.putObject(objectToStore, { allowUnsigned })
  const ingestOpts: { allowUnsigned?: boolean; logger?: typeof ctx.logger } = { allowUnsigned }
  if (ctx.logger) ingestOpts.logger = ctx.logger
  const ingest = await ingestObject(
    ctx.pool,
    { canonicalJson: objectToStore, contentId: put.content_id, txId: put.tx_id },
    ingestOpts
  )

  return {
    content_id: put.content_id,
    tx_id: put.tx_id,
    already_existed: put.already_existed,
    ingest
  }
}

export async function mintIdea(ctx: ToolContext, input: IdeaDraftInput): Promise<MintResult> {
  requireNonEmpty(input.title, 'title')
  requireNonEmpty(input.kind, 'kind')
  const created_at = input.created_at ?? nowIso()
  const summary = normalizeOptionalString(input.summary)
  const tags = Array.isArray(input.tags) ? input.tags : undefined
  const metadata = normalizeOptionalObject(input.metadata)

  const obj = {
    type: 'wofi.idea.v1',
    schema_version: '1.0',
    title: input.title,
    kind: input.kind,
    ...(summary ? { summary } : {}),
    ...(tags ? { tags } : {}),
    ...(metadata ? { metadata } : {}),
    created_at
  }

  return await mintKernelObject(ctx, obj)
}

export async function mintSubmission(ctx: ToolContext, input: SubmissionInput): Promise<MintResult> {
  requireNonEmpty(input.conversation_export, 'conversation_export')
  const created_at = input.created_at ?? nowIso()
  const context = compactObject(input.context ?? undefined)
  const payload = { kind: 'inline_utf8', value: input.conversation_export }
  const payload_hash = contentId(payload)

  const obj = {
    type: 'wofi.submission.v1',
    schema_version: '1.0',
    payload,
    payload_hash,
    mime_type: input.mime_type ?? 'text/plain',
    ...(context ? { context } : {}),
    created_at
  }

  return await mintKernelObject(ctx, obj)
}

export async function mintClaim(ctx: ToolContext, input: ClaimInput): Promise<MintResult> {
  requireNonEmpty(input.claim_text, 'claim_text')
  const created_at = input.created_at ?? nowIso()
  const resolution = compactObject(input.resolution ?? undefined)
  const metadata = normalizeOptionalObject(input.metadata)

  const obj = {
    type: 'wofi.claim.v1',
    schema_version: '1.0',
    claim_text: input.claim_text,
    claim_kind: input.claim_kind,
    ...(resolution ? { resolution } : {}),
    ...(metadata ? { metadata } : {}),
    created_at
  }

  return await mintKernelObject(ctx, obj)
}

export async function mintEvidence(ctx: ToolContext, input: EvidenceInput): Promise<MintResult> {
  requireNonEmpty(input.kind, 'kind')
  requireNonEmpty(input.locator, 'locator')
  const created_at = input.created_at ?? nowIso()
  const metadata = normalizeOptionalObject(input.metadata)

  const obj = {
    type: 'wofi.evidence.v1',
    schema_version: '1.0',
    kind: input.kind,
    locator: input.locator,
    ...(normalizeOptionalString(input.hash) ? { hash: input.hash } : {}),
    ...(metadata ? { metadata } : {}),
    created_at
  }

  return await mintKernelObject(ctx, obj)
}

export async function mintConstruction(
  ctx: ToolContext,
  input: ConstructionInput
): Promise<MintResult> {
  const created_at = input.created_at ?? nowIso()
  if (!Array.isArray(input.inputs) || input.inputs.length === 0) {
    throw new Error('inputs must be a non-empty array')
  }

  const normalizedInputs = input.inputs.map((entry) => {
    const normalized: Record<string, unknown> = { idea_id: entry.idea_id }
    const role = normalizeOptionalString(entry.role)
    if (role) normalized.role = role
    const metadata = normalizeOptionalObject(entry.metadata)
    if (metadata) normalized.metadata = metadata
    return normalized
  })

  const ideaIds = normalizedInputs
    .map((entry) => entry.idea_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  await ensureTypedRows(ctx.pool, 'ideas', ideaIds, 'idea')

  const obj = {
    type: 'wofi.construction.v1',
    schema_version: '1.0',
    operator: input.operator,
    inputs: normalizedInputs,
    ...(input.profile_id ? { profile_id: input.profile_id } : {}),
    ...(input.params ? { params: input.params } : {}),
    ...(input.constraints ? { constraints: input.constraints } : {}),
    created_at
  }

  return await mintKernelObject(ctx, obj)
}

export async function linkEdge(ctx: ToolContext, input: EdgeLinkInput): Promise<MintResult> {
  requireNonEmpty(input.from_id, 'from_id')
  requireNonEmpty(input.to_id, 'to_id')
  const created_at = input.created_at ?? nowIso()

  const { fromKind, toKind } = await ensureEdgeEndpoints(
    ctx.pool,
    input.rel,
    input.from_id,
    input.to_id
  )

  const obj = {
    type: 'wofi.edge.v1',
    schema_version: '1.0',
    rel: input.rel,
    from: { kind: fromKind, id: input.from_id },
    to: { kind: toKind, id: input.to_id },
    created_at
  }

  validateSchema(obj)
  validateInvariants(obj, {
    getObjectTypeById: (id) => {
      if (id === input.from_id) return `wofi.${fromKind}.v1`
      if (id === input.to_id) return `wofi.${toKind}.v1`
      return undefined
    }
  })

  return await mintKernelObject(ctx, obj)
}
