export type ValidationContext = {
  getObjectTypeById?: (id: string) => string | undefined
  getEdgesByFromId?: (fromId: string) => Array<{ rel: string; to_id: string }>
}

export type CanonicalBytes = Uint8Array
