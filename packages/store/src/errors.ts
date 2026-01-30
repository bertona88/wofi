export const StoreErrorCode = {
  STORE_PUT_FAILED: 'STORE_PUT_FAILED',
  STORE_FETCH_FAILED: 'STORE_FETCH_FAILED',
  STORE_ID_MISMATCH: 'STORE_ID_MISMATCH'
} as const

type StoreErrorCodeKey = (typeof StoreErrorCode)[keyof typeof StoreErrorCode]

export type StoreError = Error & {
  code: StoreErrorCodeKey
  content_id?: string
  tx_id?: string
}

export function makeStoreError(
  code: StoreErrorCodeKey,
  message: string,
  meta?: { content_id?: string; tx_id?: string }
): StoreError {
  const err = new Error(message) as StoreError
  err.code = code
  if (meta?.content_id) err.content_id = meta.content_id
  if (meta?.tx_id) err.tx_id = meta.tx_id
  return err
}
