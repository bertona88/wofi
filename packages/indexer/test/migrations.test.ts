import assert from 'node:assert'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newDb } from 'pg-mem'
import { runMigrations } from '../src/migrations.js'

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations'
)

test('runMigrations creates base tables', async () => {
  const db = newDb()
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()

  await runMigrations(pool as any, { migrationsDir })

  const res = await pool.query(`SELECT COUNT(*)::int as count FROM objects`)
  assert.strictEqual(res.rows[0]?.count, 0)

  const resIdeas = await pool.query(`SELECT COUNT(*)::int as count FROM ideas`)
  assert.strictEqual(resIdeas.rows[0]?.count, 0)

  await pool.end()
})
