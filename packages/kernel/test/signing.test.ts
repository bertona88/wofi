import assert from 'node:assert'
import { test } from 'node:test'
import {
  KernelErrorCode,
  contentId,
  normalizePubkey,
  signObject,
  verifyObjectSignature
} from '../src/index.js'

const privKey = Uint8Array.from([...Array(32).keys()])
const pubKeyB64 =
  'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg' // precomputed from privKey
const expectedSig =
  'nKU1eVMGVNXD33cInvRe2mE-L-32cOlr7axGOVBOWEVGS7_U--Mmax0GJZPo9fCNQgNDvTbEih0NPGpndCl4CA'

const baseObject = {
  type: 'wofi.idea.v1',
  schema_version: '1.0',
  title: 'Test Idea',
  kind: 'concept',
  summary: 'Just a test',
  tags: ['t1'],
  created_at: '2026-01-07T00:00:00Z'
}

test('signObject produces deterministic signature and keeps content_id stable', async () => {
  const signed = await signObject(baseObject, privKey)

  assert.deepStrictEqual(signed.author, { kind: 'pubkey', value: pubKeyB64 })
  assert.strictEqual(signed.signature.value, expectedSig)
  assert.strictEqual(signed.signature.alg, 'ed25519')

  const originalId = contentId(baseObject)
  assert.strictEqual(signed.content_id, originalId)
  assert.strictEqual(contentId(signed), originalId)

  const signedAgain = await signObject(baseObject, privKey)
  assert.strictEqual(signedAgain.signature.value, expectedSig)
})

test('verifyObjectSignature detects mutation', async () => {
  const signed = await signObject(baseObject, privKey)
  await verifyObjectSignature(signed) // should pass

  const mutated = { ...signed, summary: 'mutated summary' }
  await assert.rejects(() => verifyObjectSignature(mutated), (err: any) => {
    return err.code === KernelErrorCode.SIGNATURE_INVALID
  })
})

test('verifyObjectSignature enforces presence unless allowUnsigned', async () => {
  await assert.rejects(() => verifyObjectSignature(baseObject), (err: any) => {
    return err.code === KernelErrorCode.SIGNATURE_MISSING
  })

  await verifyObjectSignature(baseObject, { allowUnsigned: true })
})

test('normalizePubkey accepts hex and base64url, rejects wrong length', () => {
  const decodeB64Url = (str: string) => {
    const padded = str + '='.repeat((4 - (str.length % 4)) % 4)
    return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  }
  const pubKeyHex = decodeB64Url(pubKeyB64).toString('hex')

  const normalizedFromHex = normalizePubkey(pubKeyHex)
  const normalizedFromB64 = normalizePubkey(pubKeyB64)
  assert.strictEqual(normalizedFromHex, normalizedFromB64)

  assert.throws(() => normalizePubkey('abcd'), (err: any) => {
    return err.code === KernelErrorCode.AUTHOR_INVALID
  })
})
