import assert from 'node:assert'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newDb } from 'pg-mem'
import { contentId } from '@wofi/kernel'
import { runMigrations } from '../src/migrations.js'
import { ingestObject, retryDeferred } from '../src/ingest.js'

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations'
)

function makeIdea(title: string): Record<string, any> {
  return {
    type: 'wofi.idea.v1',
    schema_version: '1.0',
    title,
    kind: 'concept',
    created_at: '2026-01-29T00:00:00Z'
  }
}

function makeConstruction(inputIds: string[]): Record<string, any> {
  return {
    type: 'wofi.construction.v1',
    schema_version: '1.0',
    operator: 'compose',
    inputs: inputIds.map((id) => ({ idea_id: id })),
    created_at: '2026-01-29T00:00:00Z'
  }
}

function makeClaim(): Record<string, any> {
  return {
    type: 'wofi.claim.v1',
    schema_version: '1.0',
    claim_text: 'Test claim',
    claim_kind: 'binary',
    created_at: '2026-01-29T00:00:00Z'
  }
}

function makeEvidence(): Record<string, any> {
  return {
    type: 'wofi.evidence.v1',
    schema_version: '1.0',
    kind: 'paper',
    locator: 'https://example.com',
    hash: 'sha256:deadbeef',
    created_at: '2026-01-29T00:00:00Z'
  }
}

function makeSubmission(): Record<string, any> {
  return {
    type: 'wofi.submission.v1',
    schema_version: '1.0',
    payload: { kind: 'inline_utf8', value: 'Raw submission text' },
    payload_hash: `sha256:${'b'.repeat(64)}`,
    mime_type: 'text/plain',
    context: { client: 'web', language: 'en', ui_version: '1.0.0' },
    created_at: '2026-01-29T00:00:00Z'
  }
}

function makeImplementation(ideaId: string): Record<string, any> {
  return {
    type: 'wofi.implementation.v1',
    schema_version: '1.0',
    implements: { idea_id: ideaId },
    created_at: '2026-01-29T00:00:00Z'
  }
}

function makeProfile(): Record<string, any> {
  return {
    type: 'wofi.profile.v1',
    schema_version: '1.0',
    name: 'default',
    operator_cost: {
      compose: 1,
      specialize: 1,
      generalize: 1,
      analogize: 1,
      bundle: 1,
      refine: 1
    },
    cost_model: {
      ref_existing_idea: 1,
      mint_new_idea: 1,
      mint_new_construction: 1,
      param_byte: 1,
      residual_byte: 1
    },
    created_at: '2026-01-29T00:00:00Z'
  }
}

function makeEdge(rel: string, fromId: string, toId: string): Record<string, any> {
  return {
    type: 'wofi.edge.v1',
    schema_version: '1.0',
    rel,
    from: { kind: 'ref', id: fromId },
    to: { kind: 'ref', id: toId },
    created_at: '2026-01-29T00:00:00Z'
  }
}

test('ingest pipeline expands typed tables and is idempotent', async () => {
  const db = newDb()
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()
  await runMigrations(pool as any, { migrationsDir })

  const ideaA = makeIdea('Idea A')
  const ideaAId = contentId(ideaA)
  const ideaB = makeIdea('Idea B')
  const ideaBId = contentId(ideaB)

  const construction = makeConstruction([ideaAId])
  const constructionId = contentId(construction)

  const claim = makeClaim()
  const claimId = contentId(claim)

  const evidence = makeEvidence()
  const evidenceId = contentId(evidence)

  const submission = makeSubmission()
  const submissionId = contentId(submission)

  const implementation = makeImplementation(ideaAId)
  const implementationId = contentId(implementation)

  const profile = makeProfile()
  const profileId = contentId(profile)

  const outputEdge = makeEdge('OUTPUT_OF', constructionId, ideaBId)
  const aboutEdge = makeEdge('ABOUT', claimId, ideaAId)
  const supportsEdge = makeEdge('SUPPORTS', evidenceId, claimId)
  const implementsEdge = makeEdge('IMPLEMENTS', implementationId, ideaAId)
  const submittedAsEdge = makeEdge('SUBMITTED_AS', submissionId, ideaAId)
  const derivedFromEdge = makeEdge('DERIVED_FROM', claimId, submissionId)

  const objects = [
    submission,
    ideaA,
    ideaB,
    construction,
    claim,
    evidence,
    implementation,
    profile,
    outputEdge,
    aboutEdge,
    supportsEdge,
    implementsEdge,
    submittedAsEdge,
    derivedFromEdge
  ]

  for (const obj of objects) {
    const result = await ingestObject(pool as any, { canonicalJson: obj }, { allowUnsigned: true })
    assert.strictEqual(result.status, 'ok')
  }

  const ideaCount = await pool.query(`SELECT COUNT(*)::int as count FROM ideas`)
  assert.strictEqual(ideaCount.rows[0]?.count, 2)

  const constructionCount = await pool.query(`SELECT COUNT(*)::int as count FROM constructions`)
  assert.strictEqual(constructionCount.rows[0]?.count, 1)

  const outputCount = await pool.query(`SELECT COUNT(*)::int as count FROM construction_outputs`)
  assert.strictEqual(outputCount.rows[0]?.count, 1)

  const claims = await pool.query(`SELECT about_type, about_id FROM claims WHERE content_id = $1`, [claimId])
  assert.strictEqual(claims.rows[0]?.about_type, 'idea')
  assert.strictEqual(claims.rows[0]?.about_id, ideaAId)

  const evidenceRows = await pool.query(`SELECT claim_id, stance FROM evidence WHERE content_id = $1`, [evidenceId])
  assert.strictEqual(evidenceRows.rows[0]?.claim_id, claimId)
  assert.strictEqual(evidenceRows.rows[0]?.stance, 'supports')

  const submissionRows = await pool.query(
    `SELECT payload_kind, payload_value, payload_hash, mime_type FROM submissions WHERE content_id = $1`,
    [submissionId]
  )
  assert.strictEqual(submissionRows.rows[0]?.payload_kind, 'inline_utf8')
  assert.strictEqual(submissionRows.rows[0]?.payload_value, 'Raw submission text')

  const implRows = await pool.query(`SELECT idea_id FROM implementations WHERE content_id = $1`, [implementationId])
  assert.strictEqual(implRows.rows[0]?.idea_id, ideaAId)

  const profileRows = await pool.query(`SELECT content_id FROM profiles WHERE content_id = $1`, [profileId])
  assert.strictEqual(profileRows.rowCount, 1)

  const repeat = await ingestObject(pool as any, { canonicalJson: ideaA }, { allowUnsigned: true })
  assert.strictEqual(repeat.status, 'ok')
  const ideaCountAfter = await pool.query(`SELECT COUNT(*)::int as count FROM ideas`)
  assert.strictEqual(ideaCountAfter.rows[0]?.count, 2)

  await pool.end()
})

test('missing references go to deferred and recover', async () => {
  const db = newDb()
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()
  await runMigrations(pool as any, { migrationsDir })

  const missingIdea = makeIdea('Missing')
  const missingIdeaId = contentId(missingIdea)

  const construction = makeConstruction([missingIdeaId])
  const result = await ingestObject(pool as any, { canonicalJson: construction }, { allowUnsigned: true })
  assert.strictEqual(result.status, 'deferred')

  const deferredCount = await pool.query(`SELECT COUNT(*)::int as count FROM ingest_deferred`)
  assert.strictEqual(deferredCount.rows[0]?.count, 1)

  await ingestObject(pool as any, { canonicalJson: missingIdea }, { allowUnsigned: true })
  const retried = await retryDeferred(pool as any, { allowUnsigned: true })
  assert.strictEqual(retried, 1)

  const constructionCount = await pool.query(`SELECT COUNT(*)::int as count FROM constructions`)
  assert.strictEqual(constructionCount.rows[0]?.count, 1)

  await pool.end()
})
