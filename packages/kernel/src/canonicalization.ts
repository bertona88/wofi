import { createHash } from 'node:crypto'
import { KernelErrorCode, makeKernelError } from './errors.js'
import type { CanonicalBytes } from './types.js'

function canonicalizeValue(value: unknown): string {
  if (value === null) return 'null'
  const t = typeof value
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw makeKernelError(
        KernelErrorCode.CANONICALIZATION_ERROR,
        'Non-finite numbers are not allowed in canonical JSON'
      )
    }
    // Use ECMAScript number to string representation (matches JSON.stringify)
    return Number(value).toString()
  }
  if (t === 'string') return JSON.stringify(value)
  if (t === 'bigint' || t === 'function' || t === 'symbol') {
    throw makeKernelError(
      KernelErrorCode.CANONICALIZATION_ERROR,
      `Unsupported value type: ${t}`
    )
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => {
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
        return 'null'
      }
      return canonicalizeValue(item)
    })
    return `[${parts.join(',')}]`
  }
  if (t === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const parts = entries.map(
      ([k, v]) => `${JSON.stringify(k)}:${canonicalizeValue(v)}`
    )
    return `{${parts.join(',')}}`
  }
  throw makeKernelError(
    KernelErrorCode.CANONICALIZATION_ERROR,
    `Unsupported value type: ${t}`
  )
}

export function canonicalize(obj: unknown): CanonicalBytes {
  try {
    const canonical = canonicalizeValue(obj)
    return new TextEncoder().encode(canonical)
  } catch (err) {
    if ((err as any).code === KernelErrorCode.CANONICALIZATION_ERROR) {
      throw err
    }
    throw makeKernelError(
      KernelErrorCode.CANONICALIZATION_ERROR,
      (err as Error).message
    )
  }
}

export function toContentObject(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) {
    return (obj as unknown[]).reduce<unknown[]>((acc, item) => {
      if (item === null) return acc
      const cleaned = toContentObject(item)
      if (cleaned !== undefined) acc.push(cleaned)
      return acc
    }, [])
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value === null) continue
    if (key === 'content_id' || key === 'signature' || key === 'author') continue
    const cleaned = toContentObject(value)
    if (cleaned !== undefined) {
      result[key] = cleaned
    }
  }
  return result
}

export function contentId(obj: unknown): string {
  const contentObject = toContentObject(obj)
  const canonicalBytes = canonicalize(contentObject)
  const hash = createHash('sha256').update(canonicalBytes).digest('hex')
  return `sha256:${hash}`
}
