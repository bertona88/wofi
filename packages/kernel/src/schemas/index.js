const CONTENT_ID_PATTERN = '^sha256:[0-9a-f]{64}$';
const authorSchema = {
    type: 'object',
    properties: {
        kind: { const: 'pubkey' },
        value: { type: 'string', minLength: 1 }
    },
    required: ['kind', 'value'],
    additionalProperties: false
};
const signatureSchema = {
    type: 'object',
    properties: {
        alg: { const: 'ed25519' },
        value: { type: 'string', minLength: 1 }
    },
    required: ['alg', 'value'],
    additionalProperties: false
};
const metadataSchema = {
    type: 'object',
    additionalProperties: true
};
const baseProperties = {
    content_id: { type: 'string', pattern: CONTENT_ID_PATTERN, nullable: true },
    signature: { ...signatureSchema, nullable: true },
    created_at: { type: 'string', minLength: 1 },
    author: { ...authorSchema, nullable: true }
};
const ideaSchema = {
    type: 'object',
    properties: {
        type: { const: 'wofi.idea.v1' },
        schema_version: { const: '1.0' },
        title: { type: 'string', minLength: 1 },
        kind: { type: 'string', minLength: 1 },
        summary: { type: 'string', minLength: 1 },
        tags: {
            type: 'array',
            items: { type: 'string', minLength: 1 }
        },
        metadata: metadataSchema,
        ...baseProperties
    },
    required: ['type', 'schema_version', 'title', 'kind', 'created_at'],
    additionalProperties: false
};
const constructionInputSchema = {
    type: 'object',
    properties: {
        idea_id: { type: 'string', minLength: 1 },
        role: { type: 'string', minLength: 1 },
        metadata: metadataSchema
    },
    required: ['idea_id'],
    additionalProperties: false
};
const constructionSchema = {
    type: 'object',
    properties: {
        type: { const: 'wofi.construction.v1' },
        schema_version: { const: '1.0' },
        profile_id: { type: 'string', minLength: 1 },
        operator: {
            type: 'string',
            enum: ['compose', 'specialize', 'generalize', 'analogize', 'bundle', 'refine']
        },
        inputs: {
            type: 'array',
            items: constructionInputSchema,
            minItems: 1
        },
        params: { type: 'object', additionalProperties: true },
        constraints: { type: 'object', additionalProperties: true },
        ...baseProperties
    },
    required: ['type', 'schema_version', 'operator', 'inputs', 'created_at'],
    additionalProperties: false
};
const claimSchema = {
    type: 'object',
    properties: {
        type: { const: 'wofi.claim.v1' },
        schema_version: { const: '1.0' },
        claim_text: { type: 'string', minLength: 1 },
        claim_kind: { type: 'string', enum: ['binary', 'credence'] },
        resolution: {
            type: 'object',
            properties: {
                criteria: { type: 'string', minLength: 1 },
                resolve_by: { type: 'string', minLength: 1 }
            },
            required: ['criteria'],
            additionalProperties: false
        },
        metadata: metadataSchema,
        ...baseProperties
    },
    required: ['type', 'schema_version', 'claim_text', 'claim_kind', 'created_at'],
    additionalProperties: false
};
const evidenceSchema = {
    type: 'object',
    properties: {
        type: { const: 'wofi.evidence.v1' },
        schema_version: { const: '1.0' },
        kind: { type: 'string', minLength: 1 },
        locator: { type: 'string', minLength: 1 },
        hash: { type: 'string', minLength: 1 },
        metadata: metadataSchema,
        ...baseProperties
    },
    required: ['type', 'schema_version', 'kind', 'locator', 'created_at'],
    additionalProperties: false
};
const implementationSchema = {
    type: 'object',
    properties: {
        type: { const: 'wofi.implementation.v1' },
        schema_version: { const: '1.0' },
        implements: {
            type: 'object',
            properties: {
                idea_id: { type: 'string', minLength: 1 }
            },
            required: ['idea_id'],
            additionalProperties: false
        },
        artifact: {
            type: 'object',
            properties: {
                kind: { type: 'string', minLength: 1 },
                value: { type: 'string', minLength: 1 }
            },
            required: ['kind', 'value'],
            additionalProperties: false
        },
        metadata: metadataSchema,
        ...baseProperties
    },
    required: ['type', 'schema_version', 'implements', 'created_at'],
    additionalProperties: false
};
const profileSchema = {
    type: 'object',
    properties: {
        type: { const: 'wofi.profile.v1' },
        schema_version: { const: '1.0' },
        name: { type: 'string', minLength: 1 },
        kernel_primitives: {
            type: 'array',
            items: { type: 'string', minLength: 1 }
        },
        operator_cost: {
            type: 'object',
            properties: {
                compose: { type: 'number' },
                specialize: { type: 'number' },
                generalize: { type: 'number' },
                analogize: { type: 'number' },
                bundle: { type: 'number' },
                refine: { type: 'number' }
            },
            required: ['compose', 'specialize', 'generalize', 'analogize', 'bundle', 'refine'],
            additionalProperties: false
        },
        cost_model: {
            type: 'object',
            properties: {
                ref_existing_idea: { type: 'number' },
                mint_new_idea: { type: 'number' },
                mint_new_construction: { type: 'number' },
                param_byte: { type: 'number' },
                residual_byte: { type: 'number' }
            },
            required: [
                'ref_existing_idea',
                'mint_new_idea',
                'mint_new_construction',
                'param_byte',
                'residual_byte'
            ],
            additionalProperties: false
        },
        metadata: metadataSchema,
        ...baseProperties
    },
    required: ['type', 'schema_version', 'name', 'operator_cost', 'cost_model', 'created_at'],
    additionalProperties: false
};
const edgeEndpointSchema = {
    type: 'object',
    properties: {
        kind: { type: 'string', minLength: 1 },
        id: { type: 'string', minLength: 1 }
    },
    required: ['kind', 'id'],
    additionalProperties: false
};
const edgeSchema = {
    type: 'object',
    properties: {
        type: { const: 'wofi.edge.v1' },
        schema_version: { const: '1.0' },
        rel: {
            type: 'string',
            enum: ['INPUT_OF', 'OUTPUT_OF', 'IMPLEMENTS', 'ABOUT', 'SUPPORTS', 'REFUTES', 'ATTESTS']
        },
        from: edgeEndpointSchema,
        to: edgeEndpointSchema,
        ...baseProperties
    },
    required: ['type', 'schema_version', 'rel', 'from', 'to', 'created_at'],
    additionalProperties: false
};
const claimMarketSchema = {
    type: 'object',
    properties: {
        type: { const: 'wofi.claim_market.v1' },
        schema_version: { const: '1.0' },
        claim_id: { type: 'string', minLength: 1 },
        market_kind: { type: 'string', minLength: 1 },
        settlement: {
            type: 'object',
            properties: {
                oracle: { type: 'object', additionalProperties: true },
                dispute: { type: 'object', additionalProperties: true },
                expiry: { type: 'string', minLength: 1 }
            },
            required: ['oracle'],
            additionalProperties: false
        },
        asset: {
            type: 'object',
            properties: {
                network: { type: 'string', minLength: 1 },
                contract: { type: 'string', minLength: 1 },
                token_id: { type: 'string', minLength: 1 }
            },
            required: [],
            additionalProperties: false
        },
        metadata: metadataSchema,
        ...baseProperties
    },
    required: ['type', 'schema_version', 'claim_id', 'market_kind', 'created_at'],
    additionalProperties: false
};
const attestationSchema = {
    type: 'object',
    properties: {
        type: { const: 'wofi.attestation.v1' },
        schema_version: { const: '1.0' },
        about: edgeEndpointSchema,
        stance: { type: 'string', minLength: 1 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        note: { type: 'string', minLength: 1 },
        metadata: metadataSchema,
        ...baseProperties
    },
    required: ['type', 'schema_version', 'about', 'stance', 'created_at'],
    additionalProperties: false
};
export const schemaMap = {
    'wofi.idea.v1': { '1.0': ideaSchema },
    'wofi.construction.v1': { '1.0': constructionSchema },
    'wofi.claim.v1': { '1.0': claimSchema },
    'wofi.evidence.v1': { '1.0': evidenceSchema },
    'wofi.implementation.v1': { '1.0': implementationSchema },
    'wofi.profile.v1': { '1.0': profileSchema },
    'wofi.edge.v1': { '1.0': edgeSchema },
    'wofi.claim_market.v1': { '1.0': claimMarketSchema },
    'wofi.attestation.v1': { '1.0': attestationSchema }
};
