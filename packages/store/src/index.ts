import path from 'node:path'
import { ArweaveObjectStore } from './arweave-store.js'
import { DevObjectStore } from './dev-store.js'
import { StoreErrorCode, makeStoreError } from './errors.js'
import type { ObjectStore, StoreConfig } from './types.js'

const DEFAULT_BACKEND = 'dev'

export async function createObjectStore(config?: StoreConfig): Promise<ObjectStore> {
  const backend =
    config?.backend ??
    (process.env.WOFI_STORE_BACKEND as 'dev' | 'arweave' | undefined) ??
    DEFAULT_BACKEND

  const allowUnsigned =
    config?.allowUnsigned ?? process.env.WOFI_STORE_ALLOW_UNSIGNED === 'true'

  const logger = config?.logger

  if (backend === 'arweave') {
    const arweaveCfg: any = {}
    const turboClient = config?.arweave?.turboClient
    if (turboClient) arweaveCfg.turboClient = turboClient

    const turboUrl = config?.arweave?.turboUrl ?? process.env.ARWEAVE_TURBO_URL
    if (turboUrl) arweaveCfg.turboUrl = turboUrl

    const gatewayUrl = config?.arweave?.gatewayUrl ?? process.env.ARWEAVE_GATEWAY_URL
    if (gatewayUrl) arweaveCfg.gatewayUrl = gatewayUrl

    const jwkPath = config?.arweave?.jwkPath ?? process.env.ARWEAVE_JWK_PATH
    if (jwkPath) arweaveCfg.jwkPath = jwkPath

    if (config?.arweave?.jwk) arweaveCfg.jwk = config.arweave.jwk
    if (config?.arweave?.signer) arweaveCfg.signer = config.arweave.signer
    if (config?.arweave?.fetch) arweaveCfg.fetch = config.arweave.fetch
    if (config?.arweave?.cache) arweaveCfg.cache = config.arweave.cache
    if (config?.arweave?.lookupTxId) arweaveCfg.lookupTxId = config.arweave.lookupTxId

    return new ArweaveObjectStore({
      allowUnsigned,
      ...(logger ? { logger } : {}),
      arweave: arweaveCfg
    })
  }

  return new DevObjectStore({
    allowUnsigned,
    ...(logger ? { logger } : {}),
    dev: {
      baseDir: config?.dev?.baseDir ?? path.resolve(process.cwd(), 'devstore')
    }
  })
}

export { ArweaveObjectStore } from './arweave-store.js'
export { DevObjectStore } from './dev-store.js'
export { StoreErrorCode, makeStoreError } from './errors.js'
export type {
  ObjectStore,
  PutResult,
  StoredObject,
  StoreBackend,
  StoreConfig,
  Logger,
  DevStoreConfig,
  ArweaveStoreConfig
} from './types.js'
