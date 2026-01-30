import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  KernelErrorCode,
  canonicalize,
  contentId,
  getObjectType,
  validateInvariants,
  validateSchema
} from '../src/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const fixture = (name: string) =>
  path.join(__dirname, '..', '..', 'test', 'fixtures', name)

test('canonicalize produces JCS-stable output', () => {
  const input = JSON.parse(readFileSync(fixture('canonical_input.json'), 'utf8'))
  const expected = readFileSync(fixture('canonical_expected.txt'), 'utf8').trimEnd()
  const canonical = new TextDecoder().decode(canonicalize(input))
  assert.strictEqual(canonical, expected)
})

test('contentId strips transport fields and nulls', () => {
  const idea = JSON.parse(readFileSync(fixture('idea_with_signature.json'), 'utf8'))
  const id = contentId(idea)
  assert.strictEqual(
    id,
    'sha256:0a958eda1d7c3747c320b146393453fc63d11dd74b3968dc27c56e80be264f44'
  )
})

test('validateSchema rejects unknown type', () => {
  assert.throws(
    () => validateSchema({ type: 'wofi.unknown.v1', schema_version: '1.0' }),
    (err: any) => err.code === KernelErrorCode.UNKNOWN_OBJECT_TYPE
  )
})

test('validateSchema rejects unknown schema version', () => {
  const obj = { type: 'wofi.idea.v1', schema_version: '9.9', title: 'x', kind: 'y', created_at: 't' }
  assert.throws(
    () => validateSchema(obj),
    (err: any) => err.code === KernelErrorCode.UNKNOWN_SCHEMA_VERSION
  )
})

test('validateSchema enforces additionalProperties=false', () => {
  const obj = {
    type: 'wofi.idea.v1',
    schema_version: '1.0',
    title: 'x',
    kind: 'y',
    created_at: 't',
    unexpected: true
  }
  assert.throws(
    () => validateSchema(obj),
    (err: any) => err.code === KernelErrorCode.SCHEMA_INVALID
  )
})

test('construction inputs must be idea references', () => {
  const construction = {
    type: 'wofi.construction.v1',
    schema_version: '1.0',
    operator: 'compose',
    inputs: [{ idea_id: 'idea-1' }, { idea_id: 'idea-2', claim_id: 'bad' }],
    created_at: 't'
  }
  assert.throws(
    () => validateSchema(construction),
    (err: any) => err.code === KernelErrorCode.SCHEMA_INVALID
  )
})

test('submission schema enforces payload + hash', () => {
  const submission = {
    type: 'wofi.submission.v1',
    schema_version: '1.0',
    payload: { kind: 'inline_utf8', value: 'hello world' },
    payload_hash: `sha256:${'a'.repeat(64)}`,
    mime_type: 'text/plain',
    created_at: 't',
    context: { client: 'web', language: 'en', ui_version: '1.0.0' }
  }
  validateSchema(submission)
  const badSubmission = { ...submission, payload: { kind: 'unknown', value: 'x' } }
  assert.throws(
    () => validateSchema(badSubmission),
    (err: any) => err.code === KernelErrorCode.SCHEMA_INVALID
  )
})

test('edge rel must be valid and respect referential types', () => {
  const edge = {
    type: 'wofi.edge.v1',
    schema_version: '1.0',
    rel: 'INPUT_OF',
    from: { kind: 'idea', id: 'idea-1' },
    to: { kind: 'construction', id: 'construction-1' },
    created_at: 't'
  }
  validateSchema(edge)
  // invalid local rel
  const badRel = { ...edge, rel: 'INVALID' }
  assert.throws(
    () => validateInvariants(badRel),
    (err: any) => err.code === KernelErrorCode.INVARIANT_VIOLATION
  )

  const ctx = {
    getObjectTypeById: (id: string) => {
      if (id === 'idea-1') return 'wofi.idea.v1'
      if (id === 'construction-1') return 'wofi.claim.v1'
      return undefined
    }
  }

  assert.throws(
    () => validateInvariants(edge, ctx),
    (err: any) => err.code === KernelErrorCode.INVARIANT_VIOLATION
  )
})

test('submission edges respect referential types', () => {
  const submittedAs = {
    type: 'wofi.edge.v1',
    schema_version: '1.0',
    rel: 'SUBMITTED_AS',
    from: { kind: 'submission', id: 'sub-1' },
    to: { kind: 'idea', id: 'idea-1' },
    created_at: 't'
  }
  validateSchema(submittedAs)
  const ctxOk = {
    getObjectTypeById: (id: string) => {
      if (id === 'sub-1') return 'wofi.submission.v1'
      if (id === 'idea-1') return 'wofi.idea.v1'
      return undefined
    }
  }
  validateInvariants(submittedAs, ctxOk)

  const derived = {
    type: 'wofi.edge.v1',
    schema_version: '1.0',
    rel: 'DERIVED_FROM',
    from: { kind: 'idea', id: 'idea-1' },
    to: { kind: 'submission', id: 'sub-1' },
    created_at: 't'
  }
  validateSchema(derived)
  const ctxBad = {
    getObjectTypeById: (id: string) => {
      if (id === 'sub-1') return 'wofi.submission.v1'
      if (id === 'idea-1') return 'wofi.profile.v1'
      return undefined
    }
  }
  assert.throws(
    () => validateInvariants(derived, ctxBad),
    (err: any) => err.code === KernelErrorCode.INVARIANT_VIOLATION
  )
})

test('implementation must reference exactly one idea when context provided', () => {
  const impl = {
    type: 'wofi.implementation.v1',
    schema_version: '1.0',
    implements: { idea_id: 'idea-1' },
    created_at: 't',
    content_id: `sha256:${'0'.repeat(64)}`
  }
  validateSchema(impl)
  const ctx = {
    getObjectTypeById: (id: string) => (id === 'idea-1' ? 'wofi.idea.v1' : undefined),
    getEdgesByFromId: (_id: string) => [
      { rel: 'IMPLEMENTS', to_id: 'idea-1' },
      { rel: 'IMPLEMENTS', to_id: 'idea-2' }
    ]
  }
  assert.throws(
    () => validateInvariants(impl, ctx),
    (err: any) => err.code === KernelErrorCode.INVARIANT_VIOLATION
  )
})

test('getObjectType throws SCHEMA_INVALID when type missing', () => {
  assert.throws(
    () => getObjectType({ schema_version: '1.0' }),
    (err: any) => err.code === KernelErrorCode.SCHEMA_INVALID
  )
})
