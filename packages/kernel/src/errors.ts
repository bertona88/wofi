export type KernelValidationError = Error & {
  code: string
  path?: string
  details?: unknown
}

export const KernelErrorCode = {
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  INVARIANT_VIOLATION: 'INVARIANT_VIOLATION',
  CANONICALIZATION_ERROR: 'CANONICALIZATION_ERROR',
  UNKNOWN_SCHEMA_VERSION: 'UNKNOWN_SCHEMA_VERSION',
  UNKNOWN_OBJECT_TYPE: 'UNKNOWN_OBJECT_TYPE',
  SIGNATURE_MISSING: 'SIGNATURE_MISSING',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  AUTHOR_INVALID: 'AUTHOR_INVALID'
} as const

type KernelErrorCodeKey = typeof KernelErrorCode[keyof typeof KernelErrorCode]

export function makeKernelError(
  code: KernelErrorCodeKey,
  message: string,
  path?: string,
  details?: unknown
): KernelValidationError {
  const err = new Error(message) as KernelValidationError
  err.code = code
  if (path) err.path = path
  if (details !== undefined) err.details = details
  return err
}
