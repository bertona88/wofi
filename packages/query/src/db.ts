import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'

export type Queryable = Pool | PoolClient

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl })
}

export async function withClient<T>(db: Queryable, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if ('release' in db) {
    return await fn(db)
  }
  const client = await db.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

export async function queryValue<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient,
  sql: string,
  params: unknown[]
): Promise<T | null> {
  const result: QueryResult<T> = await client.query<T>(sql, params)
  return result.rows[0] ?? null
}
