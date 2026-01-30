import assert from 'node:assert'
import { test } from 'node:test'
import { contentId, signObject } from '@wofi/kernel'
import { ArweaveObjectStore } from '../src/arweave-store.js'
import { StoreErrorCode } from '../src/errors.js'
import type { FetchFn, TurboUploadInput } from '../src/types.js'

const privKey = Uint8Array.from([...Array(32).keys()])
const baseIdea = {
  type: 'wofi.idea.v1',
  schema_version: '1.0',
  title: 'Arweave idea',
  kind: 'concept',
  summary: 'Arweave test payload',
  created_at: '2026-01-07T00:00:00Z'
}

class FakeTurboClient {
  uploads: Array<{ input: TurboUploadInput; txId: string }> = []
  dataByTxId = new Map<string, string>()
  contentToTx = new Map<string, string>()
  counter = 0

  async upload(input: TurboUploadInput): Promise<{ id: string }> {
    const txId = `tx-${++this.counter}`
    const payload =
      typeof input.data === 'string'
        ? input.data
        : Buffer.from(input.data as any).toString('utf8')
    this.uploads.push({ input, txId })
    const tag =
      input.dataItemOpts?.tags?.find((t) => t.name === 'wofi:content_id') ??
      input.tags?.find((t) => t.name === 'wofi:content_id')
    if (tag) {
      this.contentToTx.set(tag.value, txId)
    }
    this.dataByTxId.set(txId, payload)
    return { id: txId }
  }

  lookup(contentId: string): string | null {
    return this.contentToTx.get(contentId) ?? null
  }
}

function makeFetch(turbo: FakeTurboClient): FetchFn {
  return async (url: string | URL) => {
    const asString = url.toString()
    if (asString.includes('/graphql')) {
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ data: { transactions: { edges: [] } } })
      } as any
    }
    const txId = asString.split('/').pop() ?? ''
    const payload = turbo.dataByTxId.get(txId)
    if (!payload) {
      return {
        ok: false,
        status: 404,
        text: async () => '',
        json: async () => ({})
      } as any
    }
    return {
      ok: true,
      status: 200,
      text: async () => payload,
      json: async () => JSON.parse(payload)
    } as any
  }
}

test('arweave store attaches required tags and uploads canonical bytes', async () => {
  const turbo = new FakeTurboClient()
  const fetch = makeFetch(turbo)
  const store = new ArweaveObjectStore({
    allowUnsigned: true,
    arweave: {
      turboClient: turbo as any,
      fetch,
      gatewayUrl: 'https://gateway.local',
      lookupTxId: async (cid) => turbo.lookup(cid)
    }
  })

  const signed = await signObject(baseIdea, privKey)
  const result = await store.putObject(signed)
  assert.strictEqual(result.already_existed, false)

  const upload = turbo.uploads[0]!
  const tagNames = (upload.input.dataItemOpts?.tags ?? []).map((t) => t.name)
  for (const required of [
    'wofi:type',
    'wofi:schema_version',
    'wofi:content_id',
    'wofi:created_at',
    'wofi:author',
    'Content-Type'
  ]) {
    assert.ok(tagNames.includes(required), `missing tag ${required}`)
  }

  const payloadObj = JSON.parse(
    Buffer.from(upload.input.data as any).toString('utf8')
  )
  assert.strictEqual(payloadObj.content_id, contentId(signed))
})

test('arweave store short-circuits idempotent upload and verifies hash on read', async () => {
  const turbo = new FakeTurboClient()
  const fetch = makeFetch(turbo)
  const store = new ArweaveObjectStore({
    allowUnsigned: true,
    arweave: {
      turboClient: turbo as any,
      fetch,
      gatewayUrl: 'https://gateway.local',
      lookupTxId: async (cid) => turbo.lookup(cid)
    }
  })

  const signed = await signObject(baseIdea, privKey)
  const first = await store.putObject(signed)
  const second = await store.putObject(signed)
  assert.strictEqual(second.tx_id, first.tx_id)
  assert.strictEqual(turbo.uploads.length, 1)

  const fetched = await store.getObjectByTxId(first.tx_id)
  assert.strictEqual(contentId(fetched), first.content_id)

  const tampered = { ...JSON.parse(turbo.dataByTxId.get(first.tx_id)!) }
  tampered.summary = 'tampered summary'
  turbo.dataByTxId.set(first.tx_id, JSON.stringify(tampered))

  await assert.rejects(() => store.getObjectByTxId(first.tx_id), (err: any) => {
    return err.code === StoreErrorCode.STORE_ID_MISMATCH
  })
})
