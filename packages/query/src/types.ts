export type NodeType = 'idea' | 'construction'
export type EdgeType = 'input' | 'output'
export type Direction = 'out' | 'in' | 'both'

export type IdeaNode = {
  type: 'idea'
  id: string
  title?: string | null
  created_at?: string | null
}

export type ConstructionNode = {
  type: 'construction'
  id: string
  operator?: string | null
  created_at?: string | null
}

export type GraphNode = IdeaNode | ConstructionNode

export type GraphEdge = {
  type: EdgeType
  from: string
  to: string
  ordinal?: number | null
  role?: string | null
}

export type GraphPage = {
  next_cursor: string | null
  node_limit: number
  edge_limit: number
}

export type GraphResponse = {
  root: { type: 'idea'; id: string }
  nodes: GraphNode[]
  edges: GraphEdge[]
  page: GraphPage
}

export type IdeaRecord = {
  type: 'idea'
  id: string
  title: string | null
  kind: string | null
  summary: string | null
  tags: unknown | null
  created_at: string | null
  author_pubkey: string | null
}

export type IdeaSearchResult = {
  type: 'idea'
  id: string
  title: string | null
  kind: string | null
  summary: string | null
  tags: unknown | null
  created_at: string | null
  author_pubkey: string | null
  distance: number | null
  score: number | null
}

export type ConstructionInput = {
  idea_id: string
  role: string | null
  ordinal: number
}

export type ConstructionOutput = {
  idea_id: string
} | null

export type ConstructionRecord = {
  type: 'construction'
  id: string
  operator: string | null
  profile_id: string | null
  params_json: unknown | null
  constraints_json: unknown | null
  created_at: string | null
  author_pubkey: string | null
  inputs: ConstructionInput[]
  output: ConstructionOutput
}

export type ClaimEvidence = {
  id: string
  stance: 'supports' | 'refutes' | null
  locator: string | null
  created_at: string | null
}

export type ClaimRecord = {
  id: string
  claim_text: string | null
  created_at: string | null
  evidence: ClaimEvidence[]
}

export type ClaimBundle = {
  target: { type: 'idea' | 'implementation'; id: string }
  claims: ClaimRecord[]
}

export type SubmissionRecord = {
  type: 'submission'
  id: string
  payload_kind: string | null
  payload_value: string | null
  payload_hash: string | null
  mime_type: string | null
  context_json: unknown | null
  created_at: string | null
  author_pubkey: string | null
}

export type DerivedFromRecord = {
  id: string
  wofi_type: string
  created_at: string | null
  author_pubkey: string | null
}

export type NeighborhoodOptions = {
  depth: number
  profileId?: string
  direction?: Direction
  nodeLimit?: number
  edgeLimit?: number
  cursor?: string | null
}

export type LineageOptions = Omit<NeighborhoodOptions, 'direction'> & {
  direction?: Exclude<Direction, 'both'>
}

export type ClaimBundleOptions = {
  targetType?: 'idea' | 'implementation'
}

export type GraphCursor = {
  nodes?: {
    depth: number
    node_type: NodeType
    created_at: string
    content_id: string
  } | null
  edges?: {
    depth: number
    edge_type: EdgeType
    from: string
    to: string
    ordinal: number
  } | null
}
