export type StoredObject = Record<string, any>

export type PutResult = {
  content_id: string
  tx_id: string
  already_existed: boolean
}

export interface ObjectStore {
  putObject(obj: StoredObject, opts?: { allowUnsigned?: boolean }): Promise<PutResult>
  getObjectByContentId(id: string): Promise<StoredObject | null>
  getObjectByTxId(txId: string): Promise<StoredObject | null>
  hasContentId(id: string): Promise<boolean>
}

export type Logger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void
  info?: (message: string, meta?: Record<string, unknown>) => void
  warn?: (message: string, meta?: Record<string, unknown>) => void
  error?: (message: string, meta?: Record<string, unknown>) => void
}

export type StoreBackend = 'dev' | 'arweave'

export type FetchFn = (
  input: string | URL,
  init?: RequestInit
) => Promise<{
  ok: boolean
  status: number
  text(): Promise<string>
  json(): Promise<any>
}>

export type ArweaveTag = { name: string; value: string }

export type TurboUploadInput = {
  data: Uint8Array | Buffer | string
  dataItemOpts?: { tags?: ArweaveTag[] }
  tags?: ArweaveTag[]
}

export type TurboUploadResult = { id: string }

export interface TurboClient {
  upload(input: TurboUploadInput): Promise<TurboUploadResult>
}

export type DevStoreConfig = {
  baseDir?: string
}

export type ArweaveStoreConfig = {
  turboClient?: TurboClient
  turboUrl?: string
  gatewayUrl?: string
  jwkPath?: string
  jwk?: unknown
  signer?: unknown
  fetch?: FetchFn
  cache?: Map<string, string>
  lookupTxId?: (contentId: string) => Promise<string | null>
}

export type StoreConfig = {
  backend?: StoreBackend
  allowUnsigned?: boolean
  logger?: Logger
  dev?: DevStoreConfig
  arweave?: ArweaveStoreConfig
}
