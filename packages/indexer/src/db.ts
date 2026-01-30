import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl })
}

export async function withClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withClient(pool, async (client) => {
    await client.query('BEGIN')
    try {
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
}

export async function queryValue<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient,
  sql: string,
  params: unknown[]
): Promise<T | null> {
  const result: QueryResult<T> = await client.query<T>(sql, params)
  return result.rows[0] ?? null
}
