import assert from 'node:assert'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newDb } from 'pg-mem'
import { contentId } from '@wofi/kernel'
import { runMigrations } from '../src/migrations.js'
import { backfillFromArweave } from '../src/backfill.js'

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations'
)

test('backfill ingests objects and updates checkpoints', async () => {
  const db = newDb()
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()
  await runMigrations(pool as any, { migrationsDir })

  const idea = {
    type: 'wofi.idea.v1',
    schema_version: '1.0',
    title: 'Idea',
    kind: 'concept',
    created_at: '2026-01-29T00:00:00Z'
  }
  const ideaId = contentId(idea)
  const payload = JSON.stringify({ ...idea, content_id: ideaId })

  let graphqlCalls = 0
  const fetchStub = async (input: string | URL, _init?: any) => {
    const url = input.toString()
    if (url.endsWith('/graphql')) {
      graphqlCalls += 1
      if (graphqlCalls > 1) {
        return {
          ok: true,
          json: async () => ({ data: { transactions: { edges: [] } } })
        } as any
      }
      return {
        ok: true,
        json: async () => ({
          data: {
            transactions: {
              edges: [{ cursor: 'c1', node: { id: 'tx1' } }]
            }
          }
        })
      } as any
    }
    if (url.endsWith('/tx1')) {
      return {
        ok: true,
        text: async () => payload
      } as any
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any
  }

  const originalFetch = globalThis.fetch
  ;(globalThis as any).fetch = fetchStub

  try {
    await backfillFromArweave(pool as any, {
      type: 'wofi.idea.v1',
      allowUnsigned: true,
      gatewayUrl: 'https://arweave.net'
    })
  } finally {
    ;(globalThis as any).fetch = originalFetch
  }

  const count = await pool.query(`SELECT COUNT(*)::int as count FROM ideas`)
  assert.strictEqual(count.rows[0]?.count, 1)

  const checkpoints = await pool.query(
    `SELECT cursor FROM backfill_checkpoints WHERE source = 'arweave' AND wofi_type = 'wofi.idea.v1'`
  )
  assert.strictEqual(checkpoints.rows[0]?.cursor, 'c1')

  await pool.end()
})
