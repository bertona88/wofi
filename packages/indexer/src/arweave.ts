export type ArweaveClient = {
  listTransactions: (opts: { type: string; after?: string | null; first: number }) => Promise<{
    edges: Array<{ id: string; cursor: string }>
  }>
  getTransactionData: (txId: string) => Promise<string | null>
  lookupTxIdByContentId: (contentId: string) => Promise<string | null>
}

const DEFAULT_GATEWAY = 'https://arweave.net'

type GraphqlResponse = {
  data?: {
    transactions?: { edges?: Array<{ cursor?: string; node?: { id?: string } }> }
  }
}

function cleanGateway(url: string): string {
  return url.replace(/\/$/, '')
}

export function createArweaveClient(opts?: {
  gatewayUrl?: string
  fetch?: typeof fetch
}): ArweaveClient {
  const gatewayUrl = cleanGateway(opts?.gatewayUrl ?? DEFAULT_GATEWAY)
  const fetchFn = opts?.fetch ?? (globalThis.fetch as typeof fetch)
  if (!fetchFn) {
    throw new Error('fetch is required to use the Arweave client')
  }

  async function graphqlRequest(query: string, variables: Record<string, unknown>): Promise<GraphqlResponse> {
    const res = await fetchFn(`${gatewayUrl}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables })
    })
    if (!res.ok) {
      return {}
    }
    return (await res.json()) as GraphqlResponse
  }

  return {
    async listTransactions({ type, after, first }) {
      const query = `
        query($type: [String!]!, $after: String, $first: Int!) {
          transactions(tags: [{ name: "wofi:type", values: $type }], after: $after, first: $first, sort: HEIGHT_ASC) {
            edges { cursor node { id } }
          }
        }
      `
      const body = await graphqlRequest(query, {
        type: [type],
        after: after ?? null,
        first
      })
      const edges = body.data?.transactions?.edges ?? []
      return {
        edges: edges
          .map((edge) => ({
            cursor: edge.cursor ?? '',
            id: edge.node?.id ?? ''
          }))
          .filter((edge) => edge.id && edge.cursor)
      }
    },

    async getTransactionData(txId) {
      const res = await fetchFn(`${gatewayUrl}/${txId}`)
      if (!res.ok) return null
      return await res.text()
    },

    async lookupTxIdByContentId(contentId) {
      const query = `
        query($cid: [String!]!) {
          transactions(tags: [{ name: "wofi:content_id", values: $cid }], first: 1) {
            edges { node { id } }
          }
        }
      `
      const body = await graphqlRequest(query, { cid: [contentId] })
      return body.data?.transactions?.edges?.[0]?.node?.id ?? null
    }
  }
}
