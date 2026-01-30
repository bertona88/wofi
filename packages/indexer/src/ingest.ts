import { contentId, validateSchema, validateInvariants, verifyObjectSignature, getObjectType } from '@wofi/kernel'
import type { Pool, PoolClient } from 'pg'
import { withTransaction } from './db.js'
import type { IngestResult, Logger, OutboxRow, SyncOptions } from './types.js'

const TYPE_TO_TABLE: Record<string, string> = {
  'wofi.idea.v1': 'ideas',
  'wofi.construction.v1': 'constructions',
  'wofi.claim.v1': 'claims',
  'wofi.evidence.v1': 'evidence',
  'wofi.submission.v1': 'submissions',
  'wofi.implementation.v1': 'implementations',
  'wofi.profile.v1': 'profiles',
  'wofi.edge.v1': 'edges'
}

type Deferred = { status: 'deferred'; missingRef: string; reason: string }

type ExpandResult = { status: 'ok' } | Deferred

type IngestOptions = {
  allowUnsigned?: boolean
  logger?: Logger
}

type IngestInput = {
  canonicalJson: unknown
  contentId?: string
  txId?: string | null
  source?: string
}

function parseCanonicalJson(input: unknown): Record<string, any> {
  if (typeof input === 'string') {
    return JSON.parse(input) as Record<string, any>
  }
  if (input instanceof Uint8Array) {
    return JSON.parse(Buffer.from(input).toString('utf8')) as Record<string, any>
  }
  if (input && typeof input === 'object') {
    return input as Record<string, any>
  }
  throw new Error('Invalid canonical JSON payload')
}

function safeString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  return null
}

function toJsonParam(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

async function insertRawObject(
  pool: Pool,
  row: {
    content_id: string
    wofi_type: string
    schema_version: string
    canonical_json: Record<string, any>
    created_at: string | null
    author_pubkey: string | null
    signature_json: any | null
    arweave_tx_id?: string | null
    ingest_status: 'ok' | 'failed'
    ingest_error?: string | null
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO objects (
      content_id,
      wofi_type,
      schema_version,
      canonical_json,
      created_at,
      author_pubkey,
      signature_json,
      arweave_tx_id,
      ingest_status,
      ingest_error
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (content_id) DO UPDATE SET
      arweave_tx_id = COALESCE(objects.arweave_tx_id, EXCLUDED.arweave_tx_id),
      ingest_status = CASE
        WHEN objects.ingest_status = 'failed' AND EXCLUDED.ingest_status = 'ok' THEN 'ok'
        ELSE objects.ingest_status
      END,
      ingest_error = CASE
        WHEN objects.ingest_status = 'failed' AND EXCLUDED.ingest_status = 'ok' THEN NULL
        WHEN objects.ingest_status = 'failed' AND EXCLUDED.ingest_status = 'failed' THEN EXCLUDED.ingest_error
        ELSE objects.ingest_error
      END`
    ,
    [
      row.content_id,
      row.wofi_type,
      row.schema_version,
      row.canonical_json,
      row.created_at,
      row.author_pubkey,
      row.signature_json,
      row.arweave_tx_id ?? null,
      row.ingest_status,
      row.ingest_error ?? null
    ]
  )
}

async function updateObjectFailure(
  pool: Pool,
  contentId: string,
  error: string
): Promise<void> {
  await pool.query(
    `UPDATE objects SET ingest_status = 'failed', ingest_error = $2 WHERE content_id = $1`,
    [contentId, error]
  )
}

async function getObjectTypeById(client: PoolClient, id: string): Promise<string | null> {
  const res = await client.query<{ wofi_type: string }>(
    `SELECT wofi_type FROM objects WHERE content_id = $1 AND ingest_status = 'ok'`,
    [id]
  )
  return res.rows[0]?.wofi_type ?? null
}

async function hasTypedRow(client: PoolClient, table: string, id: string): Promise<boolean> {
  const res = await client.query(`SELECT 1 FROM ${table} WHERE content_id = $1`, [id])
  return (res.rowCount ?? 0) > 0
}

function missingRef(id: string, reason: string): Deferred {
  return { status: 'deferred', missingRef: id, reason }
}

async function expandIdea(client: PoolClient, obj: Record<string, any>): Promise<ExpandResult> {
  await client.query(
    `INSERT INTO ideas (content_id, title, kind, summary, tags, created_at, author_pubkey)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING`,
    [
      obj.content_id,
      obj.title ?? null,
      obj.kind ?? null,
      obj.summary ?? null,
      toJsonParam(obj.tags),
      obj.created_at ?? null,
      obj.author?.value ?? null
    ]
  )
  return { status: 'ok' }
}

async function expandConstruction(client: PoolClient, obj: Record<string, any>): Promise<ExpandResult> {
  const inputs = Array.isArray(obj.inputs) ? obj.inputs : []
  for (const input of inputs) {
    const ideaId = input?.idea_id
    if (typeof ideaId !== 'string' || ideaId.length === 0) continue
    const exists = await hasTypedRow(client, 'ideas', ideaId)
    if (!exists) return missingRef(ideaId, 'missing idea for construction input')
  }

  await client.query(
    `INSERT INTO constructions (content_id, operator, profile_id, params_json, constraints_json, created_at, author_pubkey)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING`,
    [
      obj.content_id,
      obj.operator ?? null,
      obj.profile_id ?? null,
      toJsonParam(obj.params),
      toJsonParam(obj.constraints),
      obj.created_at ?? null,
      obj.author?.value ?? null
    ]
  )

  for (let i = 0; i < inputs.length; i += 1) {
    const input = inputs[i]
    if (!input) continue
    if (typeof input.idea_id !== 'string' || input.idea_id.length === 0) continue
    await client.query(
      `INSERT INTO construction_inputs (construction_id, input_idea_id, role, ordinal)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [
        obj.content_id,
        input.idea_id,
        input.role ?? null,
        i
      ]
    )
  }

  return { status: 'ok' }
}

async function expandClaim(client: PoolClient, obj: Record<string, any>): Promise<ExpandResult> {
  await client.query(
    `INSERT INTO claims (content_id, about_type, about_id, claim_text, resolution_type, resolution_json, created_at, author_pubkey)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING`,
    [
      obj.content_id,
      null,
      null,
      obj.claim_text ?? null,
      obj.claim_kind ?? null,
      toJsonParam(obj.resolution),
      obj.created_at ?? null,
      obj.author?.value ?? null
    ]
  )
  return { status: 'ok' }
}

async function expandEvidence(client: PoolClient, obj: Record<string, any>): Promise<ExpandResult> {
  await client.query(
    `INSERT INTO evidence (content_id, claim_id, stance, locator, excerpt_hash, created_at, author_pubkey)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING`,
    [
      obj.content_id,
      null,
      null,
      obj.locator ?? null,
      obj.hash ?? null,
      obj.created_at ?? null,
      obj.author?.value ?? null
    ]
  )
  return { status: 'ok' }
}

async function expandSubmission(client: PoolClient, obj: Record<string, any>): Promise<ExpandResult> {
  await client.query(
    `INSERT INTO submissions (
      content_id,
      payload_kind,
      payload_value,
      payload_hash,
      mime_type,
      context_json,
      created_at,
      author_pubkey
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING`,
    [
      obj.content_id,
      obj.payload?.kind ?? null,
      obj.payload?.value ?? null,
      obj.payload_hash ?? null,
      obj.mime_type ?? null,
      toJsonParam(obj.context),
      obj.created_at ?? null,
      obj.author?.value ?? null
    ]
  )
  return { status: 'ok' }
}

async function expandImplementation(client: PoolClient, obj: Record<string, any>): Promise<ExpandResult> {
  const ideaId = obj.implements?.idea_id
  if (typeof ideaId === 'string' && ideaId.length > 0) {
    const exists = await hasTypedRow(client, 'ideas', ideaId)
    if (!exists) return missingRef(ideaId, 'missing idea for implementation')
  } else {
    return missingRef('unknown', 'implementation missing idea_id')
  }

  await client.query(
    `INSERT INTO implementations (content_id, idea_id, metadata_json, created_at, author_pubkey)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT DO NOTHING`,
    [
      obj.content_id,
      ideaId ?? null,
      toJsonParam({ metadata: obj.metadata ?? null, artifact: obj.artifact ?? null }),
      obj.created_at ?? null,
      obj.author?.value ?? null
    ]
  )
  return { status: 'ok' }
}

async function expandProfile(client: PoolClient, obj: Record<string, any>): Promise<ExpandResult> {
  await client.query(
    `INSERT INTO profiles (content_id, weights_json, created_at, author_pubkey)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING`,
    [
      obj.content_id,
      toJsonParam({
        name: obj.name ?? null,
        kernel_primitives: obj.kernel_primitives ?? null,
        operator_cost: obj.operator_cost ?? null,
        cost_model: obj.cost_model ?? null,
        metadata: obj.metadata ?? null
      }),
      obj.created_at ?? null,
      obj.author?.value ?? null
    ]
  )
  return { status: 'ok' }
}

function expectedEdgeType(wofiType: string | null): string | null {
  if (!wofiType) return null
  switch (wofiType) {
    case 'wofi.idea.v1':
      return 'idea'
    case 'wofi.construction.v1':
      return 'construction'
    case 'wofi.claim.v1':
      return 'claim'
    case 'wofi.evidence.v1':
      return 'evidence'
    case 'wofi.submission.v1':
      return 'submission'
    case 'wofi.implementation.v1':
      return 'implementation'
    case 'wofi.profile.v1':
      return 'profile'
    default:
      return null
  }
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

async function expandEdge(client: PoolClient, obj: Record<string, any>): Promise<ExpandResult> {
  const rel = obj.rel
  const fromId = obj.from?.id
  const toId = obj.to?.id

  if (typeof fromId !== 'string' || typeof toId !== 'string') {
    return missingRef('unknown', 'edge missing endpoints')
  }

  const fromTypeRaw = await getObjectTypeById(client, fromId)
  const toTypeRaw = await getObjectTypeById(client, toId)
  if (!fromTypeRaw) return missingRef(fromId, 'missing from object for edge')
  if (!toTypeRaw) return missingRef(toId, 'missing to object for edge')

  const fromType = expectedEdgeType(fromTypeRaw)
  const toType = expectedEdgeType(toTypeRaw)
  if (fromType && toType) {
    assertEdgeRelation(rel, fromType, toType)
  }

  const fromTable = TYPE_TO_TABLE[fromTypeRaw]
  const toTable = TYPE_TO_TABLE[toTypeRaw]
  if (fromTable && !(await hasTypedRow(client, fromTable, fromId))) {
    return missingRef(fromId, 'missing typed row for edge from')
  }
  if (toTable && !(await hasTypedRow(client, toTable, toId))) {
    return missingRef(toId, 'missing typed row for edge to')
  }

  await client.query(
    `INSERT INTO edges (content_id, rel, from_id, to_id, created_at, author_pubkey)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT DO NOTHING`,
    [obj.content_id, rel, fromId, toId, obj.created_at ?? null, obj.author?.value ?? null]
  )

  if (rel === 'OUTPUT_OF' && fromType === 'construction' && toType === 'idea') {
    await client.query(
      `INSERT INTO construction_outputs (construction_id, output_idea_id)
       VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [fromId, toId]
    )
  }

  if (rel === 'ABOUT' && fromType === 'claim' && (toType === 'idea' || toType === 'implementation')) {
    const aboutType = toType === 'idea' ? 'idea' : 'implementation'
    await client.query(
      `UPDATE claims
       SET about_type = $2, about_id = $3
       WHERE content_id = $1 AND (about_id IS NULL OR about_id = $3)`,
      [fromId, aboutType, toId]
    )
  }

  if ((rel === 'SUPPORTS' || rel === 'REFUTES') && fromType === 'evidence' && toType === 'claim') {
    const stance = rel === 'SUPPORTS' ? 'supports' : 'refutes'
    const res = await client.query<{ claim_id: string | null }>(
      `SELECT claim_id FROM evidence WHERE content_id = $1`,
      [fromId]
    )
    const existingClaim = res.rows[0]?.claim_id
    if (existingClaim && existingClaim !== toId) {
      throw new Error('Evidence already linked to a different claim')
    }
    await client.query(
      `UPDATE evidence
       SET claim_id = $2, stance = $3
       WHERE content_id = $1`,
      [fromId, toId, stance]
    )
  }

  if (rel === 'IMPLEMENTS' && fromType === 'implementation' && toType === 'idea') {
    const res = await client.query<{ idea_id: string }>(
      `SELECT idea_id FROM implementations WHERE content_id = $1`,
      [fromId]
    )
    const ideaId = res.rows[0]?.idea_id
    if (ideaId && ideaId !== toId) {
      throw new Error('IMPLEMENTs edge does not match implementation.idea_id')
    }
  }

  return { status: 'ok' }
}

async function expandTyped(client: PoolClient, obj: Record<string, any>): Promise<ExpandResult> {
  const type = getObjectType(obj)
  switch (type) {
    case 'wofi.idea.v1':
      return expandIdea(client, obj)
    case 'wofi.construction.v1':
      return expandConstruction(client, obj)
    case 'wofi.claim.v1':
      return expandClaim(client, obj)
    case 'wofi.evidence.v1':
      return expandEvidence(client, obj)
    case 'wofi.submission.v1':
      return expandSubmission(client, obj)
    case 'wofi.implementation.v1':
      return expandImplementation(client, obj)
    case 'wofi.profile.v1':
      return expandProfile(client, obj)
    case 'wofi.edge.v1':
      return expandEdge(client, obj)
    default:
      return { status: 'ok' }
  }
}

async function recordDeferred(
  pool: Pool,
  contentId: string,
  wofiType: string,
  missingRefId: string,
  reason: string
): Promise<void> {
  await pool.query(
    `INSERT INTO ingest_deferred (content_id, wofi_type, missing_ref, reason)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (content_id) DO UPDATE SET
       missing_ref = EXCLUDED.missing_ref,
       reason = EXCLUDED.reason`,
    [contentId, wofiType, missingRefId, reason]
  )
}

function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const code = (err as any).code
    if (code) return `${code}: ${(err as any).message}`
    return String((err as any).message)
  }
  return String(err)
}

export async function ingestObject(
  pool: Pool,
  input: IngestInput,
  opts?: IngestOptions
): Promise<IngestResult> {
  const logger = opts?.logger
  const allowUnsigned = opts?.allowUnsigned === true

  const obj = parseCanonicalJson(input.canonicalJson) as Record<string, any>

  let computedId = ''
  let contentIdValue = input.contentId ?? safeString(obj.content_id)
  let wofiType = safeString(obj.type) ?? 'unknown'
  let schemaVersion = safeString(obj.schema_version) ?? 'unknown'

  try {
    computedId = contentId(obj)
    if (contentIdValue && contentIdValue !== computedId) {
      throw new Error('content_id mismatch')
    }
    if (!contentIdValue) contentIdValue = computedId
  } catch (err) {
    const error = describeError(err)
    await insertRawObject(pool, {
      content_id: contentIdValue ?? `unknown:${Date.now()}`,
      wofi_type: wofiType,
      schema_version: schemaVersion,
      canonical_json: obj,
      created_at: safeString(obj.created_at),
      author_pubkey: safeString(obj.author?.value),
      signature_json: obj.signature ?? null,
      arweave_tx_id: input.txId ?? null,
      ingest_status: 'failed',
      ingest_error: error
    })
    return { contentId: contentIdValue ?? 'unknown', wofiType, status: 'failed', error }
  }

  const objectToStore: Record<string, any> = { ...obj, content_id: contentIdValue }
  wofiType = safeString(objectToStore.type) ?? wofiType
  schemaVersion = safeString(objectToStore.schema_version) ?? schemaVersion

  let validationError: string | null = null
  try {
    validateSchema(objectToStore)
    validateInvariants(objectToStore)
    await verifyObjectSignature(objectToStore, { allowUnsigned })
  } catch (err) {
    validationError = describeError(err)
  }

  await insertRawObject(pool, {
    content_id: contentIdValue,
    wofi_type: wofiType,
    schema_version: schemaVersion,
    canonical_json: objectToStore,
    created_at: safeString(objectToStore.created_at),
    author_pubkey: safeString(objectToStore.author?.value),
    signature_json: objectToStore.signature ?? null,
    arweave_tx_id: input.txId ?? null,
    ingest_status: validationError ? 'failed' : 'ok',
    ingest_error: validationError
  })

  if (validationError) {
    logger?.warn?.('ingest validation failed', { content_id: contentIdValue, wofi_type: wofiType, error: validationError })
    return { contentId: contentIdValue, wofiType, status: 'failed', error: validationError }
  }

  try {
    const result = await withTransaction(pool, async (client) => {
      return await expandTyped(client, objectToStore)
    })

    if (result.status === 'deferred') {
      await recordDeferred(pool, contentIdValue, wofiType, result.missingRef, result.reason)
      logger?.info?.('ingest deferred', {
        content_id: contentIdValue,
        wofi_type: wofiType,
        missing_ref: result.missingRef,
        reason: result.reason
      })
      return {
        contentId: contentIdValue,
        wofiType,
        status: 'deferred',
        missingRef: result.missingRef
      }
    }

    return { contentId: contentIdValue, wofiType, status: 'ok' }
  } catch (err) {
    const error = describeError(err)
    await updateObjectFailure(pool, contentIdValue, error)
    logger?.error?.('typed expansion failed', {
      content_id: contentIdValue,
      wofi_type: wofiType,
      error
    })
    return { contentId: contentIdValue, wofiType, status: 'failed', error }
  }
}

export async function retryDeferred(
  pool: Pool,
  opts?: { limit?: number; allowUnsigned?: boolean; logger?: Logger }
): Promise<number> {
  const limit = opts?.limit ?? 50
  const logger = opts?.logger
  const res = await pool.query<{ content_id: string }>(
    `SELECT content_id FROM ingest_deferred ORDER BY first_seen_at ASC LIMIT $1`,
    [limit]
  )
  let processed = 0
  for (const row of res.rows) {
    const objectRes = await pool.query<{ canonical_json: any }>(
      `SELECT canonical_json FROM objects WHERE content_id = $1`,
      [row.content_id]
    )
    if (objectRes.rowCount === 0) continue
    const ingestOpts: IngestOptions = {}
    if (opts?.allowUnsigned !== undefined) ingestOpts.allowUnsigned = opts.allowUnsigned
    if (logger) ingestOpts.logger = logger
    const ingest = await ingestObject(
      pool,
      { canonicalJson: objectRes.rows[0]?.canonical_json, contentId: row.content_id },
      Object.keys(ingestOpts).length > 0 ? ingestOpts : undefined
    )
    if (ingest.status === 'ok') {
      await pool.query(`DELETE FROM ingest_deferred WHERE content_id = $1`, [row.content_id])
    }
    processed += 1
  }
  return processed
}

export async function ingestOutboxBatch(
  pool: Pool,
  opts?: SyncOptions & { logger?: Logger }
): Promise<number> {
  const batchSize = opts?.batchSize ?? 50
  const logger = opts?.logger
  const outboxRes = await pool.query<OutboxRow>(
    `SELECT content_id, canonical_json, arweave_tx_id, tx_id
     FROM outbox
     WHERE status IS NULL OR status <> 'ingested'
     ORDER BY created_at ASC
     LIMIT $1`,
    [batchSize]
  )

  let processed = 0
  for (const row of outboxRes.rows) {
    const txId = row.arweave_tx_id ?? row.tx_id ?? null
    const ingestOpts: IngestOptions = {}
    if (opts?.allowUnsigned !== undefined) ingestOpts.allowUnsigned = opts.allowUnsigned
    if (logger) ingestOpts.logger = logger
    const ingest = await ingestObject(
      pool,
      { canonicalJson: row.canonical_json, contentId: row.content_id, txId },
      Object.keys(ingestOpts).length > 0 ? ingestOpts : undefined
    )
    if (ingest.status === 'ok' || ingest.status === 'deferred') {
      await pool.query(
        `UPDATE outbox
         SET status = $2, last_error = NULL, attempts = COALESCE(attempts,0) + 1, updated_at = now()
         WHERE content_id = $1`,
        [row.content_id, ingest.status === 'ok' ? 'ingested' : 'deferred']
      )
    } else {
      await pool.query(
        `UPDATE outbox
         SET status = 'failed', last_error = $2, attempts = COALESCE(attempts,0) + 1, updated_at = now()
         WHERE content_id = $1`,
        [row.content_id, ingest.error ?? 'unknown error']
      )
    }
    processed += 1
  }

  if (processed > 0) {
    const retryOpts: { limit: number; allowUnsigned?: boolean; logger?: Logger } = { limit: batchSize }
    if (opts?.allowUnsigned !== undefined) retryOpts.allowUnsigned = opts.allowUnsigned
    if (logger) retryOpts.logger = logger
    await retryDeferred(pool, retryOpts)
  }

  return processed
}
