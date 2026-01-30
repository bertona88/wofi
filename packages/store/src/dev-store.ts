import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { canonicalize, contentId, validateInvariants, validateSchema, verifyObjectSignature } from '@wofi/kernel'
import { makeStoreError, StoreErrorCode } from './errors.js'
import type {
  DevStoreConfig,
  Logger,
  ObjectStore,
  PutResult,
  StoredObject
} from './types.js'

const DEFAULT_BASE_DIR = path.resolve(process.cwd(), 'devstore')
const INDEX_FILENAME = 'index.json'
const OBJECTS_DIRNAME = 'objects'

type IndexFile = Record<string, string>

function log(
  logger: Logger | undefined,
  level: keyof Logger,
  message: string,
  meta?: Record<string, unknown>
): void {
  const fn = logger?.[level]
  if (fn) fn(message, meta)
}

function encodeContentId(contentId: string): string {
  return `${contentId}.json`
}

function deterministicTxId(contentId: string): string {
  const hash = createHash('sha256').update(contentId).digest('hex')
  return `dev-${hash}`
}

export class DevObjectStore implements ObjectStore {
  private readonly baseDir: string
  private readonly objectsDir: string
  private readonly indexPath: string
  private readonly allowUnsigned: boolean
  private readonly logger: Logger | undefined
  private readonly ready: Promise<void>
  private index: IndexFile = {}
  private indexLoaded = false

  constructor(opts?: { allowUnsigned?: boolean; logger?: Logger; dev?: DevStoreConfig }) {
    this.allowUnsigned = opts?.allowUnsigned === true
    this.logger = opts?.logger
    this.baseDir = path.resolve(opts?.dev?.baseDir ?? DEFAULT_BASE_DIR)
    this.objectsDir = path.join(this.baseDir, OBJECTS_DIRNAME)
    this.indexPath = path.join(this.baseDir, INDEX_FILENAME)
    this.ready = this.ensureStorage()
  }

  private async ensureStorage(): Promise<void> {
    await fs.mkdir(this.objectsDir, { recursive: true })
    try {
      await fs.access(this.indexPath)
    } catch {
      await fs.writeFile(this.indexPath, '{}', 'utf8')
    }
  }

  private async loadIndex(): Promise<IndexFile> {
    if (this.indexLoaded) return this.index
    try {
      const raw = await fs.readFile(this.indexPath, 'utf8')
      this.index = raw.trim().length === 0 ? {} : JSON.parse(raw)
      this.indexLoaded = true
      return this.index
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        this.index = {}
        this.indexLoaded = true
        return this.index
      }
      throw makeStoreError(
        StoreErrorCode.STORE_FETCH_FAILED,
        'Failed to read devstore index',
        {}
      )
    }
  }

  private async persistIndex(index: IndexFile): Promise<void> {
    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf8')
    this.index = index
    this.indexLoaded = true
  }

  private objectPath(contentId: string): string {
    return path.join(this.objectsDir, encodeContentId(contentId))
  }

  async putObject(obj: StoredObject, opts?: { allowUnsigned?: boolean }): Promise<PutResult> {
    await this.ready
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
      const canonicalBytes = canonicalize(objectToStore)
      const index = await this.loadIndex()
      const existingTxId = index[objectToStore.content_id]
      if (existingTxId) {
        log(this.logger, 'info', 'devstore put idempotent hit', {
          content_id: objectToStore.content_id,
          tx_id: existingTxId,
          backend: 'dev',
          duration_ms: Date.now() - started,
          result: 'already_existed'
        })
        return { content_id: objectToStore.content_id, tx_id: existingTxId, already_existed: true }
      }

      const tx_id = deterministicTxId(objectToStore.content_id) || randomUUID()
      await fs.writeFile(this.objectPath(objectToStore.content_id), Buffer.from(canonicalBytes))
      index[objectToStore.content_id] = tx_id
      await this.persistIndex(index)

      log(this.logger, 'info', 'devstore put ok', {
        content_id: objectToStore.content_id,
        tx_id,
        backend: 'dev',
        duration_ms: Date.now() - started,
        result: 'ok'
      })
      return { content_id: objectToStore.content_id, tx_id, already_existed: false }
    } catch (err: any) {
      if (err?.code && typeof err.code === 'string') {
        throw err
      }
      throw makeStoreError(
        StoreErrorCode.STORE_PUT_FAILED,
        err?.message ?? 'Unknown devstore put error'
      )
    }
  }

  async getObjectByContentId(id: string): Promise<StoredObject | null> {
    await this.ready
    const started = Date.now()
    const index = await this.loadIndex()
    const txId = index[id]
    if (!txId) return null
    try {
      const raw = await fs.readFile(this.objectPath(id), 'utf8')
      const parsed = JSON.parse(raw) as StoredObject
      const computed = contentId(parsed)
      if (computed !== id) {
        throw makeStoreError(StoreErrorCode.STORE_ID_MISMATCH, 'content_id mismatch on read', {
          content_id: id,
          tx_id: txId
        })
      }
      log(this.logger, 'debug', 'devstore read ok', {
        content_id: id,
        tx_id: txId,
        backend: 'dev',
        duration_ms: Date.now() - started
      })
      return parsed
    } catch (err: any) {
      if (err?.code === StoreErrorCode.STORE_ID_MISMATCH) throw err
      throw makeStoreError(
        StoreErrorCode.STORE_FETCH_FAILED,
        err?.message ?? 'Failed to read object from devstore',
        { content_id: id, tx_id: txId }
      )
    }
  }

  async getObjectByTxId(txId: string): Promise<StoredObject | null> {
    await this.ready
    const index = await this.loadIndex()
    const entry = Object.entries(index).find(([, storedTxId]) => storedTxId === txId)
    if (!entry) return null
    const [contentId] = entry
    return this.getObjectByContentId(contentId)
  }

  async hasContentId(id: string): Promise<boolean> {
    await this.ready
    const index = await this.loadIndex()
    return Boolean(index[id])
  }
}
