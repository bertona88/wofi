export const QueryErrorCode = {
  NOT_FOUND: 'NOT_FOUND',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT'
} as const

type QueryErrorCodeKey = (typeof QueryErrorCode)[keyof typeof QueryErrorCode]

export type QueryError = Error & {
  code: QueryErrorCodeKey
  status: number
  details?: Record<string, unknown>
}

export function makeQueryError(
  code: QueryErrorCodeKey,
  message: string,
  opts?: { status?: number; details?: Record<string, unknown> }
): QueryError {
  const err = new Error(message) as QueryError
  err.code = code
  err.status = opts?.status ?? (code === QueryErrorCode.NOT_FOUND ? 404 : 400)
  if (opts?.details) err.details = opts.details
  return err
}
