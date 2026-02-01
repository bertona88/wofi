import type { PoolClient } from 'pg'
import { makeQueryError, QueryErrorCode } from './errors.js'
import { withClient, queryValue, type Queryable } from './db.js'
import {
  CLAIM_BUNDLE_SQL,
  NEIGHBORHOOD_EDGES_SQL,
  NEIGHBORHOOD_NODES_SQL
} from './sql.js'
import type {
  ClaimBundle,
  ClaimBundleOptions,
  ClaimEvidence,
  ClaimRecord,
  ConstructionInput,
  ConstructionRecord,
  ConstructionOutput,
  Direction,
  DerivedFromRecord,
  GraphCursor,
  GraphEdge,
  GraphNode,
  GraphResponse,
  IdeaRecord,
  IdeaSearchResult,
  LineageOptions,
  NeighborhoodOptions,
  SubmissionRecord
} from './types.js'

type NodeRow = {
  node_type: 'idea' | 'construction'
  node_id: string
  depth: number
  title: string | null
  operator: string | null
  created_at: string | null
  created_at_key: string
}

type EdgeRow = {
  edge_type: 'input' | 'output'
  edge_from_typed: string
  edge_to_typed: string
  role: string | null
  ordinal: number | null
  depth: number
  ordinal_key: number
}

type ClaimJoinRow = {
  claim_id: string
  claim_text: string | null
  claim_created_at: string | null
  evidence_id: string | null
  stance: 'supports' | 'refutes' | null
  locator: string | null
  evidence_created_at: string | null
}

function assertDepth(depth: number): number {
  if (!Number.isInteger(depth) || depth < 0) {
    throw makeQueryError(QueryErrorCode.INVALID_ARGUMENT, 'depth must be a non-negative integer', {
      details: { depth }
    })
  }
  return depth
}

function assertLimit(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value <= 0) {
    throw makeQueryError(QueryErrorCode.INVALID_ARGUMENT, `${name} must be a positive integer`, {
      details: { [name]: value }
    })
  }
  return value
}

function parseDirection(direction?: Direction): Direction {
  if (!direction) return 'both'
  if (direction !== 'out' && direction !== 'in' && direction !== 'both') {
    throw makeQueryError(QueryErrorCode.INVALID_ARGUMENT, 'direction must be out, in, or both', {
      details: { direction }
    })
  }
  return direction
}

function toVectorLiteral(embedding: number[]): string {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw makeQueryError(QueryErrorCode.INVALID_ARGUMENT, 'embedding must be a non-empty array')
  }
  for (const value of embedding) {
    if (!Number.isFinite(value)) {
      throw makeQueryError(QueryErrorCode.INVALID_ARGUMENT, 'embedding contains non-finite values')
    }
  }
  return `[${embedding.join(',')}]`
}

function encodeCursor(cursor: GraphCursor): string {
  const json = JSON.stringify(cursor)
  return Buffer.from(json, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): GraphCursor {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = JSON.parse(json)
    return parsed as GraphCursor
  } catch (err) {
    throw makeQueryError(QueryErrorCode.INVALID_ARGUMENT, 'invalid cursor')
  }
}

async function ensureIdeaExists(client: PoolClient, id: string): Promise<void> {
  const row = await queryValue<{ content_id: string }>(
    client,
    'SELECT content_id FROM ideas WHERE content_id = $1',
    [id]
  )
  if (!row) {
    throw makeQueryError(QueryErrorCode.NOT_FOUND, `idea not found: ${id}`)
  }
}

async function ensureConstructionExists(client: PoolClient, id: string): Promise<void> {
  const row = await queryValue<{ content_id: string }>(
    client,
    'SELECT content_id FROM constructions WHERE content_id = $1',
    [id]
  )
  if (!row) {
    throw makeQueryError(QueryErrorCode.NOT_FOUND, `construction not found: ${id}`)
  }
}

async function resolveClaimTarget(
  client: PoolClient,
  id: string,
  targetType?: 'idea' | 'implementation'
): Promise<'idea' | 'implementation'> {
  if (targetType) {
    const table = targetType === 'idea' ? 'ideas' : 'implementations'
    const row = await queryValue<{ content_id: string }>(
      client,
      `SELECT content_id FROM ${table} WHERE content_id = $1`,
      [id]
    )
    if (!row) {
      throw makeQueryError(QueryErrorCode.NOT_FOUND, `${targetType} not found: ${id}`)
    }
    return targetType
  }

  const ideaRow = await queryValue<{ content_id: string }>(
    client,
    'SELECT content_id FROM ideas WHERE content_id = $1',
    [id]
  )
  if (ideaRow) return 'idea'

  const implRow = await queryValue<{ content_id: string }>(
    client,
    'SELECT content_id FROM implementations WHERE content_id = $1',
    [id]
  )
  if (implRow) return 'implementation'

  throw makeQueryError(QueryErrorCode.NOT_FOUND, `target not found: ${id}`)
}

export async function getIdea(db: Queryable, id: string): Promise<IdeaRecord> {
  return await withClient(db, async (client) => {
    const row = await queryValue<{
      content_id: string
      title: string | null
      kind: string | null
      summary: string | null
      tags: unknown | null
      created_at: string | null
      author_pubkey: string | null
    }>(
      client,
      `SELECT content_id, title, kind, summary, tags, created_at, author_pubkey
       FROM ideas WHERE content_id = $1`,
      [id]
    )

    if (!row) {
      throw makeQueryError(QueryErrorCode.NOT_FOUND, `idea not found: ${id}`)
    }

    return {
      type: 'idea',
      id: row.content_id,
      title: row.title,
      kind: row.kind,
      summary: row.summary,
      tags: row.tags,
      created_at: row.created_at,
      author_pubkey: row.author_pubkey
    }
  })
}

export async function searchIdeasByEmbedding(
  db: Queryable,
  embedding: number[],
  opts?: { limit?: number; model?: string; dimensions?: number }
): Promise<IdeaSearchResult[]> {
  const limit = assertLimit('limit', opts?.limit, 10)
  const model = opts?.model ?? 'text-embedding-3-large'
  const dimensions = opts?.dimensions ?? embedding.length

  if (embedding.length !== dimensions) {
    throw makeQueryError(QueryErrorCode.INVALID_ARGUMENT, 'embedding length does not match dimensions', {
      details: { length: embedding.length, dimensions }
    })
  }

  const vector = toVectorLiteral(embedding)

  return await withClient(db, async (client) => {
    const res = await client.query<{
      content_id: string
      title: string | null
      kind: string | null
      summary: string | null
      tags: unknown | null
      created_at: string | null
      author_pubkey: string | null
      distance: number | null
    }>(
      `SELECT i.content_id, i.title, i.kind, i.summary, i.tags, i.created_at, i.author_pubkey,
              e.embedding <=> $1::vector AS distance
       FROM idea_embeddings e
       JOIN ideas i ON i.content_id = e.idea_id
       WHERE e.model = $2 AND e.dimensions = $3
       ORDER BY e.embedding <=> $1::vector
       LIMIT $4`,
      [vector, model, dimensions, limit]
    )

    return res.rows.map((row) => {
      const distance = row.distance ?? null
      return {
        type: 'idea',
        id: row.content_id,
        title: row.title,
        kind: row.kind,
        summary: row.summary,
        tags: row.tags,
        created_at: row.created_at,
        author_pubkey: row.author_pubkey,
        distance,
        score: distance === null ? null : 1 - distance
      }
    })
  })
}

export async function getConstruction(db: Queryable, id: string): Promise<ConstructionRecord> {
  return await withClient(db, async (client) => {
    const row = await queryValue<{
      content_id: string
      operator: string | null
      profile_id: string | null
      params_json: unknown | null
      constraints_json: unknown | null
      created_at: string | null
      author_pubkey: string | null
    }>(
      client,
      `SELECT content_id, operator, profile_id, params_json, constraints_json, created_at, author_pubkey
       FROM constructions WHERE content_id = $1`,
      [id]
    )

    if (!row) {
      throw makeQueryError(QueryErrorCode.NOT_FOUND, `construction not found: ${id}`)
    }

    const inputsRes = await client.query<ConstructionInput>(
      `SELECT input_idea_id AS idea_id, role, ordinal
       FROM construction_inputs
       WHERE construction_id = $1
       ORDER BY ordinal ASC`,
      [id]
    )

    const outputRow = await queryValue<{ output_idea_id: string }>(
      client,
      `SELECT output_idea_id FROM construction_outputs WHERE construction_id = $1`,
      [id]
    )

    const output: ConstructionOutput = outputRow ? { idea_id: outputRow.output_idea_id } : null

    return {
      type: 'construction',
      id: row.content_id,
      operator: row.operator,
      profile_id: row.profile_id,
      params_json: row.params_json,
      constraints_json: row.constraints_json,
      created_at: row.created_at,
      author_pubkey: row.author_pubkey,
      inputs: inputsRes.rows,
      output
    }
  })
}

export async function getIdeaNeighborhood(
  db: Queryable,
  id: string,
  opts: NeighborhoodOptions
): Promise<GraphResponse> {
  const depth = assertDepth(opts.depth)
  const direction = parseDirection(opts.direction)
  const nodeLimit = assertLimit('nodeLimit', opts.nodeLimit, 200)
  const edgeLimit = assertLimit('edgeLimit', opts.edgeLimit, 400)

  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null
  const nodeCursor = cursor?.nodes ?? null
  const edgeCursor = cursor?.edges ?? null

  return await withClient(db, async (client) => {
    await ensureIdeaExists(client, id)

    const nodeParams = [
      id,
      depth,
      direction,
      nodeCursor?.depth ?? null,
      nodeCursor?.node_type ?? null,
      nodeCursor?.created_at ?? null,
      nodeCursor?.content_id ?? null,
      nodeLimit
    ]

    const nodesRes = await client.query<NodeRow>(NEIGHBORHOOD_NODES_SQL, nodeParams)
    const nodes: GraphNode[] = nodesRes.rows.map((row) => {
      if (row.node_type === 'idea') {
        return {
          type: 'idea',
          id: row.node_id,
          title: row.title,
          created_at: row.created_at
        }
      }
      return {
        type: 'construction',
        id: row.node_id,
        operator: row.operator,
        created_at: row.created_at
      }
    })

    const edgeParams = [
      id,
      depth,
      direction,
      edgeCursor?.depth ?? null,
      edgeCursor?.edge_type ?? null,
      edgeCursor?.from ?? null,
      edgeCursor?.to ?? null,
      edgeCursor?.ordinal ?? null,
      edgeLimit
    ]

    const edgesRes = await client.query<EdgeRow>(NEIGHBORHOOD_EDGES_SQL, edgeParams)
    const edges: GraphEdge[] = edgesRes.rows.map((row) => ({
      type: row.edge_type,
      from: row.edge_from_typed,
      to: row.edge_to_typed,
      ordinal: row.ordinal,
      role: row.role
    }))

    const nextCursor: GraphCursor = {}
    if (nodesRes.rows.length === nodeLimit) {
      const last = nodesRes.rows.at(-1)
      if (last) {
        nextCursor.nodes = {
          depth: last.depth,
          node_type: last.node_type,
          created_at: last.created_at_key,
          content_id: last.node_id
        }
      }
    }
    if (edgesRes.rows.length === edgeLimit) {
      const last = edgesRes.rows.at(-1)
      if (last) {
        nextCursor.edges = {
          depth: last.depth,
          edge_type: last.edge_type,
          from: last.edge_from_typed,
          to: last.edge_to_typed,
          ordinal: last.ordinal_key
        }
      }
    }

    const nextCursorValue = nextCursor.nodes || nextCursor.edges ? encodeCursor(nextCursor) : null

    return {
      root: { type: 'idea', id },
      nodes,
      edges,
      page: {
        next_cursor: nextCursorValue,
        node_limit: nodeLimit,
        edge_limit: edgeLimit
      }
    }
  })
}

export async function getIdeaLineage(
  db: Queryable,
  id: string,
  opts: LineageOptions
): Promise<GraphResponse> {
  const direction = opts.direction ?? 'out'
  return await getIdeaNeighborhood(db, id, { ...opts, direction })
}

export async function getClaimBundle(
  db: Queryable,
  targetId: string,
  opts?: ClaimBundleOptions
): Promise<ClaimBundle> {
  return await withClient(db, async (client) => {
    const targetType = await resolveClaimTarget(client, targetId, opts?.targetType)

    const rows = await client.query<ClaimJoinRow>(CLAIM_BUNDLE_SQL, [targetType, targetId])

    const claimsById = new Map<string, ClaimRecord>()
    for (const row of rows.rows) {
      let claim = claimsById.get(row.claim_id)
      if (!claim) {
        claim = {
          id: row.claim_id,
          claim_text: row.claim_text,
          created_at: row.claim_created_at,
          evidence: []
        }
        claimsById.set(row.claim_id, claim)
      }
      if (row.evidence_id) {
        const evidence: ClaimEvidence = {
          id: row.evidence_id,
          stance: row.stance ?? null,
          locator: row.locator ?? null,
          created_at: row.evidence_created_at
        }
        claim.evidence.push(evidence)
      }
    }

    return {
      target: { type: targetType, id: targetId },
      claims: Array.from(claimsById.values())
    }
  })
}

export async function getSubmission(db: Queryable, id: string): Promise<SubmissionRecord> {
  return await withClient(db, async (client) => {
    const row = await queryValue<{
      content_id: string
      payload_kind: string | null
      payload_value: string | null
      payload_hash: string | null
      mime_type: string | null
      context_json: unknown | null
      created_at: string | null
      author_pubkey: string | null
    }>(
      client,
      `SELECT content_id, payload_kind, payload_value, payload_hash, mime_type, context_json, created_at, author_pubkey
       FROM submissions WHERE content_id = $1`,
      [id]
    )

    if (!row) {
      throw makeQueryError(QueryErrorCode.NOT_FOUND, `submission not found: ${id}`)
    }

    return {
      type: 'submission',
      id: row.content_id,
      payload_kind: row.payload_kind,
      payload_value: row.payload_value,
      payload_hash: row.payload_hash,
      mime_type: row.mime_type,
      context_json: row.context_json,
      created_at: row.created_at,
      author_pubkey: row.author_pubkey
    }
  })
}

export async function getIdeaSubmissions(db: Queryable, ideaId: string): Promise<SubmissionRecord[]> {
  return await withClient(db, async (client) => {
    await ensureIdeaExists(client, ideaId)

    const res = await client.query<{
      content_id: string
      payload_kind: string | null
      payload_value: string | null
      payload_hash: string | null
      mime_type: string | null
      context_json: unknown | null
      created_at: string | null
      author_pubkey: string | null
    }>(
      `SELECT s.content_id, s.payload_kind, s.payload_value, s.payload_hash, s.mime_type, s.context_json, s.created_at, s.author_pubkey
       FROM edges e
       JOIN submissions s ON s.content_id = e.from_id
       WHERE e.rel = 'SUBMITTED_AS' AND e.to_id = $1
       ORDER BY s.created_at ASC, s.content_id ASC`,
      [ideaId]
    )

    return res.rows.map((row) => ({
      type: 'submission',
      id: row.content_id,
      payload_kind: row.payload_kind,
      payload_value: row.payload_value,
      payload_hash: row.payload_hash,
      mime_type: row.mime_type,
      context_json: row.context_json,
      created_at: row.created_at,
      author_pubkey: row.author_pubkey
    }))
  })
}

export async function getDerivedFrom(db: Queryable, submissionId: string): Promise<DerivedFromRecord[]> {
  return await withClient(db, async (client) => {
    const exists = await queryValue<{ content_id: string }>(
      client,
      'SELECT content_id FROM submissions WHERE content_id = $1',
      [submissionId]
    )
    if (!exists) {
      throw makeQueryError(QueryErrorCode.NOT_FOUND, `submission not found: ${submissionId}`)
    }

    const res = await client.query<{
      content_id: string
      wofi_type: string
      created_at: string | null
      author_pubkey: string | null
    }>(
      `SELECT o.content_id, o.wofi_type, o.created_at, o.author_pubkey
       FROM edges e
       JOIN objects o ON o.content_id = e.from_id AND o.ingest_status = 'ok'
       WHERE e.rel = 'DERIVED_FROM' AND e.to_id = $1
       ORDER BY o.created_at ASC, o.content_id ASC`,
      [submissionId]
    )

    return res.rows.map((row) => ({
      id: row.content_id,
      wofi_type: row.wofi_type,
      created_at: row.created_at,
      author_pubkey: row.author_pubkey
    }))
  })
}
