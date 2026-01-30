import assert from 'node:assert'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { KernelErrorCode, contentId, signObject } from '@wofi/kernel'
import { DevObjectStore } from '../src/dev-store.js'
import { StoreErrorCode } from '../src/errors.js'

const privKey = Uint8Array.from([...Array(32).keys()])
const baseIdea = {
  type: 'wofi.idea.v1',
  schema_version: '1.0',
  title: 'Local test idea',
  kind: 'concept',
  summary: 'Dev store round trip',
  created_at: '2026-01-07T00:00:00Z'
}

async function makeStore() {
  const dir = await mkdtemp(path.join(tmpdir(), 'wofi-devstore-'))
  const store = new DevObjectStore({ dev: { baseDir: dir } })
  return { store, dir }
}

test('dev store round trip preserves content_id and is idempotent', async () => {
  const { store } = await makeStore()
  const signed = await signObject(baseIdea, privKey)
  const first = await store.putObject(signed)

  assert.strictEqual(first.content_id, contentId(signed))
  assert.ok(first.tx_id.startsWith('dev-'))
  assert.strictEqual(first.already_existed, false)

  const fetched = await store.getObjectByContentId(first.content_id)
  assert.deepStrictEqual(fetched, { ...signed, content_id: first.content_id })
  assert.strictEqual(await store.hasContentId(first.content_id), true)

  const second = await store.putObject(signed)
  assert.strictEqual(second.tx_id, first.tx_id)
  assert.strictEqual(second.already_existed, true)
})

test('unsigned write rejected unless allowUnsigned is true', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wofi-devstore-unsigned-'))
  const store = new DevObjectStore({ dev: { baseDir: dir } })
  await assert.rejects(() => store.putObject(baseIdea), (err: any) => {
    return err.code === KernelErrorCode.SIGNATURE_MISSING
  })

  const permissive = new DevObjectStore({ dev: { baseDir: dir + '-allow' }, allowUnsigned: true })
  const res = await permissive.putObject(baseIdea, { allowUnsigned: true })
  assert.strictEqual(res.content_id, contentId(baseIdea))
})

test('corrupted payload triggers STORE_ID_MISMATCH', async () => {
  const { store, dir } = await makeStore()
  const signed = await signObject(baseIdea, privKey)
  const { content_id } = await store.putObject(signed)

  const objectPath = path.join(dir, 'objects', `${content_id}.json`)

  const raw = await readFile(objectPath, 'utf8')
  const mutated = { ...JSON.parse(raw), title: 'tampered' }
  await writeFile(objectPath, JSON.stringify(mutated), 'utf8')

  await assert.rejects(() => store.getObjectByContentId(content_id), (err: any) => {
    return err.code === StoreErrorCode.STORE_ID_MISMATCH
  })
})
