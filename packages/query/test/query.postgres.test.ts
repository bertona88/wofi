import assert from 'node:assert'
import { test, before, after, beforeEach } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { runMigrations } from '@wofi/indexer'
import {
  getClaimBundle,
  getIdeaNeighborhood,
  getSubmission,
  getIdeaSubmissions,
  getDerivedFrom
} from '../src/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  test('postgres query tests skipped (DATABASE_URL not set)', (t) => {
    t.skip('DATABASE_URL not set')
  })
} else {
  let pool: Pool

  function assertSafeDatabase(url: string): void {
    const parsed = new URL(url)
    const dbName = parsed.pathname.replace(/^\//, '')
    const allowAny = process.env.WOFI_QUERY_TEST_ALLOW_ANY_DB === 'true'
    if (!allowAny && !dbName.includes('wofi_indexer_test')) {
      throw new Error(
        `Refusing to run destructive tests on database '${dbName}'. ` +
        `Set WOFI_QUERY_TEST_ALLOW_ANY_DB=true to override.`
      )
    }
  }

  async function applyMigrations(pg: Pool): Promise<void> {
    const migrationsDir = path.resolve(__dirname, '..', '..', '..', 'indexer', 'migrations')
    await runMigrations(pg, { migrationsDir })
  }

  async function resetDb(pg: Pool): Promise<void> {
    await pg.query(
      `TRUNCATE
        edges,
        submissions,
        evidence,
        claims,
        construction_outputs,
        construction_inputs,
        constructions,
        implementations,
        ideas,
        profiles,
        objects,
        ingest_deferred
      RESTART IDENTITY CASCADE`
    )
  }

  async function seedGraph(pg: Pool): Promise<{ ideaA: string; ideaB: string; construction: string }>{
    const ideaA = 'sha256:ideaA'
    const ideaB = 'sha256:ideaB'
    const construction = 'sha256:construction'

    await pg.query(
      `INSERT INTO ideas (content_id, title, kind, created_at)
       VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
      [ideaA, 'Idea A', 'concept', '2026-01-01T00:00:00Z', ideaB, 'Idea B', 'concept', '2026-01-02T00:00:00Z']
    )

    await pg.query(
      `INSERT INTO constructions (content_id, operator, created_at)
       VALUES ($1, $2, $3)`,
      [construction, 'compose', '2026-01-03T00:00:00Z']
    )

    await pg.query(
      `INSERT INTO construction_inputs (construction_id, input_idea_id, role, ordinal)
       VALUES ($1, $2, $3, $4)`,
      [construction, ideaA, null, 0]
    )

    await pg.query(
      `INSERT INTO construction_outputs (construction_id, output_idea_id)
       VALUES ($1, $2)`,
      [construction, ideaB]
    )

    return { ideaA, ideaB, construction }
  }

  before(async () => {
    assertSafeDatabase(databaseUrl)
    pool = new Pool({ connectionString: databaseUrl })
    await applyMigrations(pool)
  })

  beforeEach(async () => {
    await resetDb(pool)
  })

  after(async () => {
    await pool.end()
  })

  test('getIdeaNeighborhood depth 0 returns only root node', async () => {
    const { ideaA } = await seedGraph(pool)
    const graph = await getIdeaNeighborhood(pool, ideaA, { depth: 0 })
    assert.strictEqual(graph.nodes.length, 1)
    assert.strictEqual(graph.edges.length, 0)
    assert.strictEqual(graph.nodes[0]?.id, ideaA)
  })

  test('direction out vs in yields expected neighborhood', async () => {
    const { ideaA, ideaB, construction } = await seedGraph(pool)

    const outGraph = await getIdeaNeighborhood(pool, ideaA, { depth: 2, direction: 'out' })
    const outNodeIds = new Set(outGraph.nodes.map((n) => n.id))
    assert.ok(outNodeIds.has(ideaA))
    assert.ok(outNodeIds.has(construction))
    assert.ok(outNodeIds.has(ideaB))

    const edgeTypes = outGraph.edges.map((e) => e.type).sort()
    assert.deepStrictEqual(edgeTypes, ['input', 'output'])

    const inGraph = await getIdeaNeighborhood(pool, ideaB, { depth: 2, direction: 'in' })
    const inNodeIds = new Set(inGraph.nodes.map((n) => n.id))
    assert.ok(inNodeIds.has(ideaB))
    assert.ok(inNodeIds.has(construction))
    assert.ok(inNodeIds.has(ideaA))
  })

  test('pagination cursor resumes without duplicates', async () => {
    const { ideaA } = await seedGraph(pool)

    let cursor: string | null = null
    const nodeIds = new Set<string>()
    const edgeKeys = new Set<string>()

    for (let i = 0; i < 5; i += 1) {
      const res = await getIdeaNeighborhood(pool, ideaA, {
        depth: 2,
        direction: 'out',
        nodeLimit: 1,
        edgeLimit: 1,
        cursor
      })

      res.nodes.forEach((n) => nodeIds.add(`${n.type}:${n.id}`))
      res.edges.forEach((e) => edgeKeys.add(`${e.type}:${e.from}->${e.to}`))

      cursor = res.page.next_cursor
      if (!cursor) break
    }

    assert.ok(nodeIds.size >= 3)
    assert.ok(edgeKeys.size >= 2)
  })

  test('claim bundle nests evidence under claims only', async () => {
    const { ideaA } = await seedGraph(pool)

    const claimId = 'sha256:claim1'
    await pool.query(
      `INSERT INTO claims (content_id, about_type, about_id, claim_text, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [claimId, 'idea', ideaA, 'Claim about idea', '2026-01-04T00:00:00Z']
    )

    const evidenceId = 'sha256:evidence1'
    await pool.query(
      `INSERT INTO evidence (content_id, claim_id, stance, locator, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [evidenceId, claimId, 'supports', 'https://example.com', '2026-01-05T00:00:00Z']
    )

    const bundle = await getClaimBundle(pool, ideaA)
    assert.strictEqual(bundle.claims.length, 1)
    assert.strictEqual(bundle.claims[0]?.evidence.length, 1)
    assert.strictEqual(bundle.claims[0]?.evidence[0]?.id, evidenceId)
  })

  test('submission queries return linked submissions and derived objects', async () => {
    const ideaId = 'sha256:ideaSub'
    await pool.query(
      `INSERT INTO ideas (content_id, title, kind, created_at)
       VALUES ($1, $2, $3, $4)`,
      [ideaId, 'Idea Sub', 'concept', '2026-01-01T00:00:00Z']
    )

    const submissionId = 'sha256:submission1'
    await pool.query(
      `INSERT INTO submissions (content_id, payload_kind, payload_value, payload_hash, mime_type, context_json, created_at, author_pubkey)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        submissionId,
        'inline_utf8',
        'Raw submission',
        `sha256:${'c'.repeat(64)}`,
        'text/plain',
        JSON.stringify({ client: 'web' }),
        '2026-01-01T00:00:00Z',
        'pubkey1'
      ]
    )

    await pool.query(
      `INSERT INTO edges (content_id, rel, from_id, to_id, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      ['sha256:edgeSubmit', 'SUBMITTED_AS', submissionId, ideaId, '2026-01-01T00:00:00Z']
    )

    const derivedId = 'sha256:derived1'
    await pool.query(
      `INSERT INTO objects (content_id, wofi_type, schema_version, canonical_json, created_at, ingest_status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [derivedId, 'wofi.claim.v1', '1.0', JSON.stringify({}), '2026-01-02T00:00:00Z', 'ok']
    )

    await pool.query(
      `INSERT INTO edges (content_id, rel, from_id, to_id, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      ['sha256:edgeDerived', 'DERIVED_FROM', derivedId, submissionId, '2026-01-02T00:00:00Z']
    )

    const submission = await getSubmission(pool, submissionId)
    assert.strictEqual(submission.payload_value, 'Raw submission')

    const ideaSubs = await getIdeaSubmissions(pool, ideaId)
    assert.strictEqual(ideaSubs.length, 1)
    assert.strictEqual(ideaSubs[0]?.id, submissionId)

    const derived = await getDerivedFrom(pool, submissionId)
    assert.strictEqual(derived.length, 1)
    assert.strictEqual(derived[0]?.id, derivedId)
  })
}
