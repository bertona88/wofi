import { promises as fs } from 'node:fs'
import path from 'node:path'
import { canonicalize, contentId, validateInvariants, validateSchema, verifyObjectSignature } from '@wofi/kernel'
import { makeStoreError, StoreErrorCode } from './errors.js'
import type {
  ArweaveStoreConfig,
  FetchFn,
  Logger,
  ObjectStore,
  PutResult,
  StoredObject,
  TurboClient,
  TurboUploadInput
} from './types.js'

const DEFAULT_TURBO_URL = 'https://up.turbo.net'
const DEFAULT_GATEWAY_URL = 'https://arweave.net'

type GraphqlResponse = {
  data?: {
    transactions?: { edges?: Array<{ node?: { id?: string } }> }
  }
}

function log(
  logger: Logger | undefined,
  level: keyof Logger,
  message: string,
  meta?: Record<string, unknown>
): void {
  const fn = logger?.[level]
  if (fn) fn(message, meta)
}

function buildTags(obj: StoredObject, id: string): Array<{ name: string; value: string }> {
  const tags: Array<{ name: string; value: string }> = [
    { name: 'wofi:type', value: String(obj.type ?? '') },
    { name: 'wofi:schema_version', value: String(obj.schema_version ?? '') },
    { name: 'wofi:content_id', value: id },
    { name: 'wofi:created_at', value: String(obj.created_at ?? '') },
    { name: 'Content-Type', value: 'application/json' }
  ]

  const author = (obj as any).author?.value
  if (author) {
    tags.push({ name: 'wofi:author', value: String(author) })
  }
  const profileId = (obj as any).profile_id
  if (profileId) {
    tags.push({ name: 'wofi:profile_id', value: String(profileId) })
  }
  return tags
}

async function readJwk(jwkPath?: string): Promise<any | null> {
  if (!jwkPath) return null
  const resolved = path.resolve(jwkPath)
  const raw = await fs.readFile(resolved, 'utf8')
  return JSON.parse(raw)
}

export class ArweaveObjectStore implements ObjectStore {
  private turboClient: TurboClient | null
  private readonly allowUnsigned: boolean
  private readonly logger: Logger | undefined
  private readonly fetchFn: FetchFn
  private readonly gatewayUrl: string
  private readonly turboUrl: string
  private readonly lookupTxId: ((contentId: string) => Promise<string | null>) | undefined
  private readonly cache: Map<string, string>
  private readonly jwkPath: string | undefined
  private readonly jwk: unknown
  private readonly signer: unknown

  constructor(opts?: {
    allowUnsigned?: boolean
    logger?: Logger
    arweave?: ArweaveStoreConfig
  }) {
    this.allowUnsigned = opts?.allowUnsigned === true
    this.logger = opts?.logger
    this.turboClient = opts?.arweave?.turboClient ?? null
    this.fetchFn = opts?.arweave?.fetch ?? (globalThis.fetch as FetchFn)
    this.gatewayUrl = opts?.arweave?.gatewayUrl ?? DEFAULT_GATEWAY_URL
    this.turboUrl = opts?.arweave?.turboUrl ?? DEFAULT_TURBO_URL
    this.lookupTxId = opts?.arweave?.lookupTxId
    this.cache = opts?.arweave?.cache ?? new Map<string, string>()
    this.jwkPath = opts?.arweave?.jwkPath
    this.jwk = opts?.arweave?.jwk
    this.signer = opts?.arweave?.signer
  }

  private async ensureTurboClient(): Promise<TurboClient> {
    if (this.turboClient) return this.turboClient

    let signer = this.signer
    if (!signer) {
      const jwk = this.jwk ?? (await readJwk(this.jwkPath))
      if (!jwk) {
        throw makeStoreError(
          StoreErrorCode.STORE_PUT_FAILED,
          'Arweave signer (JWK) is required for uploads'
        )
      }
      const module = await import('@ardrive/turbo-sdk')
      const { ArweaveSigner } = module as any
      signer = new ArweaveSigner(jwk)
    }

    const module = await import('@ardrive/turbo-sdk')
    const { TurboFactory } = module as any
    this.turboClient = TurboFactory.authenticated({
      signer,
      uploadServiceConfig: { url: this.turboUrl }
    })
    return this.turboClient as TurboClient
  }

  private async lookupExistingTxId(contentId: string): Promise<string | null> {
    const cached = this.cache.get(contentId)
    if (cached) return cached

    if (this.lookupTxId) {
      try {
        const found = await this.lookupTxId(contentId)
        if (found) {
          this.cache.set(contentId, found)
          return found
        }
      } catch {
        // ignore lookup errors for robustness
      }
    }

    const fromGraphql = await this.queryGraphql(contentId)
    if (fromGraphql) {
      this.cache.set(contentId, fromGraphql)
      return fromGraphql
    }

    return null
  }

  private async queryGraphql(contentId: string): Promise<string | null> {
    if (!this.fetchFn) return null
    const query = `
      query($cid: [String!]!) {
        transactions(tags: [{ name: "wofi:content_id", values: $cid }], first: 1) {
          edges { node { id } }
        }
      }
    `
    try {
      const res = await this.fetchFn(new URL('/graphql', this.gatewayUrl).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables: { cid: [contentId] } })
      } as any)
      if (!res.ok) return null
      const body = (await res.json()) as GraphqlResponse
      const id = body.data?.transactions?.edges?.[0]?.node?.id
      return id ?? null
    } catch {
      return null
    }
  }

  private async downloadTxData(txId: string): Promise<string | null> {
    if (!this.fetchFn) return null
    const url = `${this.gatewayUrl.replace(/\/$/, '')}/${txId}`
    try {
      const res = await this.fetchFn(url)
      if (!res.ok) return null
      return await res.text()
    } catch {
      return null
    }
  }

  async putObject(obj: StoredObject, opts?: { allowUnsigned?: boolean }): Promise<PutResult> {
    const started = Date.now()
    const allowUnsigned = opts?.allowUnsigned ?? this.allowUnsigned
    try {
      validateSchema(obj)
      validateInvariants(obj)
      await verifyObjectSignature(obj, { allowUnsigned })

      const computedId = contentId(obj)
      const existingId = (obj as any).content_id as string | undefined
      if (existingId && existingId !== computedId) {
        throw makeStoreError(StoreErrorCode.STORE_ID_MISMATCH, 'content_id mismatch', {
          content_id: existingId
        })
      }
      const objectToStore = { ...(obj as any), content_id: existingId ?? computedId }

      const preexisting = await this.lookupExistingTxId(objectToStore.content_id)
      if (preexisting) {
        log(this.logger, 'info', 'arweave put idempotent hit', {
          content_id: objectToStore.content_id,
          tx_id: preexisting,
          backend: 'arweave',
          result: 'already_existed',
          duration_ms: Date.now() - started
        })
        return { content_id: objectToStore.content_id, tx_id: preexisting, already_existed: true }
      }

      const client = await this.ensureTurboClient()
      const tags = buildTags(objectToStore, objectToStore.content_id)
      const canonicalBytes = canonicalize(objectToStore)
      const uploadInput: TurboUploadInput = {
        data: Buffer.from(canonicalBytes),
        dataItemOpts: { tags },
        tags
      }
      const res = await client.upload(uploadInput)
      const tx_id = (res as any).id ?? (res as any).txId ?? (res as any).tx_id
      if (!tx_id) {
        throw makeStoreError(StoreErrorCode.STORE_PUT_FAILED, 'Turbo upload missing tx id')
      }

      this.cache.set(objectToStore.content_id, tx_id)
      log(this.logger, 'info', 'arweave put ok', {
        content_id: objectToStore.content_id,
        tx_id,
        backend: 'arweave',
        result: 'ok',
        duration_ms: Date.now() - started
      })
      return { content_id: objectToStore.content_id, tx_id, already_existed: false }
    } catch (err: any) {
      if (err?.code && typeof err.code === 'string') throw err
      throw makeStoreError(
        StoreErrorCode.STORE_PUT_FAILED,
        err?.message ?? 'Unknown arweave put error'
      )
    }
  }

  async getObjectByContentId(id: string): Promise<StoredObject | null> {
    const txId = await this.lookupExistingTxId(id)
    if (!txId) return null
    const obj = await this.getObjectByTxId(txId)
    if (!obj) return null
    const computed = contentId(obj)
    if (computed !== id) {
      throw makeStoreError(StoreErrorCode.STORE_ID_MISMATCH, 'content_id mismatch on read', {
        content_id: id,
        tx_id: txId
      })
    }
    return obj
  }

  async getObjectByTxId(txId: string): Promise<StoredObject | null> {
    const started = Date.now()
    const raw = await this.downloadTxData(txId)
    if (raw === null) return null
    try {
      const parsed = JSON.parse(raw) as StoredObject
      const computedId = contentId(parsed)
      const declared = (parsed as any).content_id
      if (declared && declared !== computedId) {
        throw makeStoreError(StoreErrorCode.STORE_ID_MISMATCH, 'content_id mismatch on read', {
          content_id: declared,
          tx_id: txId
        })
      }
      this.cache.set(computedId, txId)
      log(this.logger, 'debug', 'arweave read ok', {
        content_id: computedId,
        tx_id: txId,
        backend: 'arweave',
        duration_ms: Date.now() - started
      })
      return parsed
    } catch (err: any) {
      if (err?.code === StoreErrorCode.STORE_ID_MISMATCH) throw err
      throw makeStoreError(
        StoreErrorCode.STORE_FETCH_FAILED,
        err?.message ?? 'Failed to parse arweave payload',
        { tx_id: txId }
      )
    }
  }

  async hasContentId(id: string): Promise<boolean> {
    const txId = await this.lookupExistingTxId(id)
    return Boolean(txId)
  }
}
