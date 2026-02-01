import { z } from 'zod'
import {
  mintClaim,
  mintConstruction,
  mintEvidence,
  mintIdea,
  mintSubmission,
  linkEdge
} from './write.js'
import { enqueueDecomposition } from './jobs.js'
import { getClaimBundle, getConstruction, getIdea, getSubmission, searchIdeas } from './read.js'
import type {
  ClaimInput,
  ConstructionInput,
  DecompositionEnqueueInput,
  EdgeLinkInput,
  EvidenceInput,
  GetClaimBundleInput,
  GetConstructionInput,
  GetIdeaInput,
  GetSubmissionInput,
  IdeaDraftInput,
  SearchIdeasInput,
  SubmissionInput,
  ToolContext
} from './types.js'

export type ToolFactory = <TInput, TOutput>(config: {
  name: string
  description: string
  parameters: z.ZodObject<any>
  execute: (input: TInput) => Promise<TOutput>
}) => unknown

// Inject the Agents SDK `tool` factory to avoid a hard dependency on @openai/agents here.

const ideaDraftSchema = z.object({
  title: z.string().min(1),
  kind: z.string().min(1),
  summary: z.string().min(1).nullable(),
  tags: z.array(z.string().min(1)).nullable(),
  created_at: z.string().min(1).nullable()
})

const submissionSchema = z.object({
  conversation_export: z.string().min(1),
  mime_type: z.string().min(1).nullable(),
  context: z
    .object({
      client: z.enum(['web', 'cli', 'api']).nullable(),
      language: z.string().min(1).nullable(),
      ui_version: z.string().min(1).nullable()
    })
    .nullable(),
  created_at: z.string().min(1).nullable()
})

const claimSchema = z.object({
  claim_text: z.string().min(1),
  claim_kind: z.enum(['binary', 'credence']),
  resolution: z
    .object({
      criteria: z.string().min(1),
      resolve_by: z.string().min(1).nullable()
    })
    .nullable(),
  created_at: z.string().min(1).nullable()
})

const evidenceSchema = z.object({
  kind: z.string().min(1),
  locator: z.string().min(1),
  hash: z.string().min(1).nullable(),
  created_at: z.string().min(1).nullable()
})

const constructionSchema = z.object({
  operator: z.enum(['compose', 'specialize', 'generalize', 'analogize', 'bundle', 'refine']),
  inputs: z
    .array(
      z.object({
        idea_id: z.string().min(1),
        role: z.string().min(1).nullable()
      })
    )
    .min(1),
  profile_id: z.string().min(1).nullable(),
  created_at: z.string().min(1).nullable()
})

const edgeSchema = z.object({
  rel: z.enum([
    'INPUT_OF',
    'OUTPUT_OF',
    'IMPLEMENTS',
    'ABOUT',
    'SUPPORTS',
    'REFUTES',
    'ATTESTS',
    'SUBMITTED_AS',
    'DERIVED_FROM'
  ]),
  from_id: z.string().min(1),
  to_id: z.string().min(1),
  created_at: z.string().min(1).nullable()
})

const getIdeaSchema = z.object({
  idea_id: z.string().min(1)
})

const getConstructionSchema = z.object({
  construction_id: z.string().min(1)
})

const getClaimBundleSchema = z.object({
  target_id: z.string().min(1),
  target_type: z.enum(['idea', 'implementation']).nullable()
})

const getSubmissionSchema = z.object({
  submission_id: z.string().min(1)
})

const enqueueDecompositionSchema = z.object({
  idea_id: z.string().min(1),
  profile_id: z.string().min(1),
  force: z.boolean().nullable()
})

const searchIdeasSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().nullable(),
  mode: z.enum(['hybrid', 'text', 'vector']).nullable(),
  model: z.string().min(1).nullable(),
  dimensions: z.number().int().positive().nullable()
})

export function createAgentTools(ctx: ToolContext, tool: ToolFactory): unknown[] {
  return [
    tool({
      name: 'wofi.mint_idea',
      description: 'Mint a new Idea object (unsigned v0) and ingest it.',
      parameters: ideaDraftSchema,
      execute: (input: IdeaDraftInput) => mintIdea(ctx, input)
    }),
    tool({
      name: 'wofi.mint_submission',
      description: 'Mint a Submission object (unsigned v0) and ingest it.',
      parameters: submissionSchema,
      execute: (input: SubmissionInput) => mintSubmission(ctx, input)
    }),
    tool({
      name: 'wofi.mint_claim',
      description: 'Mint a Claim object (unsigned v0) and ingest it.',
      parameters: claimSchema,
      execute: (input: ClaimInput) => mintClaim(ctx, input)
    }),
    tool({
      name: 'wofi.mint_evidence',
      description: 'Mint an Evidence object (unsigned v0) and ingest it.',
      parameters: evidenceSchema,
      execute: (input: EvidenceInput) => mintEvidence(ctx, input)
    }),
    tool({
      name: 'wofi.mint_construction',
      description: 'Mint a Construction object (unsigned v0) and ingest it.',
      parameters: constructionSchema,
      execute: (input: ConstructionInput) => mintConstruction(ctx, input)
    }),
    tool({
      name: 'wofi.link_edge',
      description: 'Mint an Edge object (unsigned v0) after referential checks.',
      parameters: edgeSchema,
      execute: (input: EdgeLinkInput) => linkEdge(ctx, input)
    }),
    tool({
      name: 'decomposition.enqueue',
      description: 'Enqueue a decomposition job for an idea and profile.',
      parameters: enqueueDecompositionSchema,
      execute: (input: DecompositionEnqueueInput) => enqueueDecomposition(ctx, input)
    }),
    tool({
      name: 'wofi.get_idea',
      description: 'Fetch an Idea record by content id.',
      parameters: getIdeaSchema,
      execute: (input: GetIdeaInput) => getIdea(ctx, input)
    }),
    tool({
      name: 'wofi.get_construction',
      description: 'Fetch a Construction record by content id.',
      parameters: getConstructionSchema,
      execute: (input: GetConstructionInput) => getConstruction(ctx, input)
    }),
    tool({
      name: 'wofi.get_claim_bundle',
      description: 'Fetch claims (and evidence) about an Idea or Implementation.',
      parameters: getClaimBundleSchema,
      execute: (input: GetClaimBundleInput) => getClaimBundle(ctx, input)
    }),
    tool({
      name: 'wofi.get_submission',
      description: 'Fetch a Submission record by content id.',
      parameters: getSubmissionSchema,
      execute: (input: GetSubmissionInput) => getSubmission(ctx, input)
    }),
    tool({
      name: 'wofi.search_ideas',
      description: 'Search ideas by text and/or vector similarity.',
      parameters: searchIdeasSchema,
      execute: (input: SearchIdeasInput) => searchIdeas(ctx, input)
    })
  ]
}
