import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'
import { withClient } from './db.js'
import type { Logger } from './types.js'

async function resolveMigrationsDir(explicit?: string): Promise<string> {
  if (explicit) return path.resolve(explicit)
  const envDir = process.env.WOFI_INDEXER_MIGRATIONS_DIR
  if (envDir) return path.resolve(envDir)

  const candidates = [
    path.resolve(process.cwd(), 'packages/indexer/migrations'),
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(fileURLToPath(new URL('../migrations', import.meta.url))),
    path.resolve(fileURLToPath(new URL('../../migrations', import.meta.url)))
  ]

  for (const candidate of candidates) {
    try {
      await fs.stat(candidate)
      return candidate
    } catch {
      // ignore
    }
  }

  return path.resolve(process.cwd(), 'packages/indexer/migrations')
}

export async function runMigrations(
  pool: Pool,
  opts?: { migrationsDir?: string; logger?: Logger }
): Promise<void> {
  const logger = opts?.logger
  const migrationsDir = await resolveMigrationsDir(opts?.migrationsDir)
  const skipPgvector = process.env.WOFI_INDEXER_SKIP_PGVECTOR === 'true'

  const entries = await fs.readdir(migrationsDir)
  const files = entries.filter((name) => name.endsWith('.sql')).sort()

  await withClient(pool, async (client) => {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    )

    const appliedRes = await client.query<{ id: string }>('SELECT id FROM schema_migrations')
    const applied = new Set(appliedRes.rows.map((row: { id: string }) => row.id))

    for (const file of files) {
      if (skipPgvector && file.includes('embeddings')) {
        logger?.info?.('skipping pgvector migration', { file })
        continue
      }
      if (applied.has(file)) continue
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8')
      logger?.info?.('applying migration', { file })
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
  })
}
