import { Agent, run, tool, webSearchTool, withTrace } from '@openai/agents'
import type { Tool as AgentTool } from '@openai/agents'
import { createObjectStore } from '@wofi/store'
import { createAgentTools, getIdea, linkEdge, mintClaim, mintEvidence } from '@wofi/agent-tools'
import type { ToolContext } from '@wofi/agent-tools'
import type { DecompositionJob, Logger } from '@wofi/indexer'
import type { Pool } from 'pg'

type DecompositionRunnerOptions = {
  model?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  searchContextSize?: 'low' | 'medium' | 'high'
  allowedDomains?: string[]
  logger?: Logger
  maxTurns?: number
  budgetMs?: number
}

type ToolLogEntry = { tool: string; contentId?: string; txId?: string }

const DEFAULT_MODEL = 'gpt-5'
const DEFAULT_BUDGET_MS = 5 * 60 * 1000

type BudgetStopPayload = {
  claimText: string
  evidenceLocator: string
}

function nowIso(): string {
  return new Date().toISOString()
}

export function buildBudgetStopPayload(profileId: string, ideaTitle: string): BudgetStopPayload {
  return {
    claimText: `Budget stop for decomposition under profile ${profileId}.`,
    evidenceLocator: `budget_stop:${ideaTitle}`
  }
}

function resolveBudgetMs(opts: DecompositionRunnerOptions): number {
  if (opts.budgetMs !== undefined) return opts.budgetMs
  const raw = process.env.WOFI_DECOMPOSITION_BUDGET_MS
  if (!raw) return DEFAULT_BUDGET_MS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : DEFAULT_BUDGET_MS
}

export function buildInstructions(profileId: string): string {
  return [
    'You are the WOFI decomposition agent.',
    'Follow planB/how_decomposition_works.md strictly.',
    'Workflow:',
    '1) call wofi.get_idea to load the target idea by content id.',
    '2) call wofi.search_ideas to find reusable building blocks before minting new ideas (reuse-first).',
    '3) propose exactly 3 candidate decompositions (compose/specialize/etc).',
    '4) mint missing intermediate ideas sparingly (only when no close match exists).',
    '5) for each candidate: mint constructions, then link edges INPUT_OF and OUTPUT_OF.',
    '6) add claims ABOUT the target idea for the key assertions; attach evidence.',
    '7) for each leaf, add a stop claim with text:',
    `"This Idea is well-known/common knowledge in domain D (stop point for decomposition under profile ${profileId})."`,
    '   If you cannot find evidence, write "Budget stop for decomposition under profile ' +
      `${profileId}" and attach agent_note evidence.`,
    '8) Evidence attaches only to claims. Always link via SUPPORTS.',
    '9) Claims attach only to Ideas (or Implementations). Always link via ABOUT.',
    '10) Never attach evidence directly to ideas or constructions.',
    'Use web search to gather evidence URLs. Prefer authoritative sources (standards, textbooks, primary papers).',
    'Use wofi.mint_evidence with kind="web_url" and locator as the URL.',
    'If you use a budget stop, use kind="agent_note" and locator "budget_stop:<idea title>".',
    'Never reuse the same evidence object across multiple claims. If the same URL supports multiple claims, mint a separate evidence object per claim.',
    'When minting any Construction, include params._decomposition with run_id and candidate_id.',
    'If you minted a new idea because no close match exists, set params._decomposition.minted_reason="no close match" on constructions that use it.',
    'Do not repeat tool calls after they succeed; keep tool usage minimal and deterministic.',
    'Hard limits per candidate set: use at most 3 web searches and at most 2 wofi.search_ideas calls.',
    'If you cannot find evidence within those limits, use budget stops.',
    'Output is via tool calls only; keep any final response brief.'
  ].join(' ')
}

export function buildPrompt(params: {
  job: DecompositionJob
  runId: string
  candidateIds: string[]
  budgetMs: number
}): string {
  const { job, runId, candidateIds, budgetMs } = params
  return [
    'Decompose the target idea and persist the results.',
    `target_idea_id: ${job.idea_id}`,
    `profile_id: ${job.profile_id}`,
    `run_id: ${runId}`,
    `candidate_ids: ${candidateIds.join(',')}`,
    'Candidate guidance:',
    `- ${candidateIds[0]}: standard hierarchical decomposition.`,
    `- ${candidateIds[1]}: more mechanistic/causal decomposition.`,
    `- ${candidateIds[2]}: more minimal / high-level decomposition.`,
    `budget_ms: ${budgetMs}`,
    job.opts_json ? `opts_json: ${JSON.stringify(job.opts_json)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

function toAllowedDomains(raw?: string): string[] | undefined {
  if (!raw) return undefined
  const domains = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return domains.length > 0 ? domains : undefined
}

function wrapTool(logger: Logger | undefined, log: ToolLogEntry[], config: any): AgentTool {
  return tool({
    ...(config as any),
    strict: true,
    execute: async (input: unknown) => {
      const result = await (config as any).execute(input)
      if (result && typeof result === 'object') {
        const contentId = (result as any).content_id
        const txId = (result as any).tx_id
        if (typeof contentId === 'string') {
          log.push({ tool: config.name, contentId, txId })
        }
      }
      return result
    },
    errorFunction: logger
      ? (_context: unknown, error: unknown) => {
          logger.error?.('agent tool error', { tool: config.name, error })
          return `Tool ${config.name} failed: ${error}`
        }
      : undefined
  } as any)
}

async function mintBudgetStop(
  ctx: ToolContext,
  ideaId: string,
  profileId: string,
  logger?: Logger
): Promise<void> {
  let ideaTitle = ideaId
  try {
    const idea = await getIdea(ctx, { idea_id: ideaId })
    if (idea?.title) ideaTitle = idea.title
  } catch (error) {
    logger?.warn?.('failed to fetch idea title for budget stop', { ideaId, error })
  }

  const payload = buildBudgetStopPayload(profileId, ideaTitle)
  const claim = await mintClaim(ctx, {
    claim_text: payload.claimText,
    claim_kind: 'credence',
    created_at: nowIso()
  })
  await linkEdge(ctx, {
    rel: 'ABOUT',
    from_id: claim.content_id,
    to_id: ideaId,
    created_at: nowIso()
  })
  const evidence = await mintEvidence(ctx, {
    kind: 'agent_note',
    locator: payload.evidenceLocator,
    created_at: nowIso()
  })
  await linkEdge(ctx, {
    rel: 'SUPPORTS',
    from_id: evidence.content_id,
    to_id: claim.content_id,
    created_at: nowIso()
  })
}

export async function runDecompositionJob(
  pool: Pool,
  job: DecompositionJob,
  opts: DecompositionRunnerOptions = {}
): Promise<void> {
  const store = await createObjectStore()
  const ctx: ToolContext = {
    store,
    pool,
    allowUnsigned: true,
    ...(opts.logger ? { logger: opts.logger } : {})
  }

  const log: ToolLogEntry[] = []
  const toolFactory = ((config) => wrapTool(opts.logger, log, config)) as Parameters<
    typeof createAgentTools
  >[1]
  const tools = createAgentTools(ctx, toolFactory) as AgentTool[]

  const allowedDomains = opts.allowedDomains ?? toAllowedDomains(process.env.WOFI_WEB_SEARCH_ALLOWED_DOMAINS)
  const searchContextSize =
    opts.searchContextSize ??
    (process.env.WOFI_WEB_SEARCH_CONTEXT_SIZE as 'low' | 'medium' | 'high' | undefined) ??
    'medium'

  tools.push(
    webSearchTool(
      allowedDomains
        ? {
            filters: { allowedDomains },
            searchContextSize
          }
        : { searchContextSize }
    )
  )

  const model = opts.model ?? process.env.WOFI_DECOMPOSITION_MODEL ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL
  const reasoningEffort =
    opts.reasoningEffort ??
    (process.env.WOFI_DECOMPOSITION_REASONING as
      | 'minimal'
      | 'low'
      | 'medium'
      | 'high'
      | undefined) ??
    'medium'

  const maxTurns =
    opts.maxTurns ??
    (process.env.WOFI_DECOMPOSITION_MAX_TURNS
      ? Number(process.env.WOFI_DECOMPOSITION_MAX_TURNS)
      : undefined) ??
    40

  const runId = `decomp_job_${job.id}_a${job.attempts}`
  const candidateIds = ['c1', 'c2', 'c3']
  const budgetMs = resolveBudgetMs(opts)

  const agent = new Agent({
    name: 'wofi_decomposition_agent_v0',
    model,
    instructions: buildInstructions(job.profile_id),
    tools,
    modelSettings: {
      reasoning: { effort: reasoningEffort },
      text: { verbosity: 'low' },
      providerData: {
        include: ['web_search_call.action.sources']
      }
    }
  })

  const prompt = buildPrompt({ job, runId, candidateIds, budgetMs })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(new Error('budget exceeded')), budgetMs)

  try {
    await withTrace(`WOFI Decomposition Job ${job.id}`, async () => {
      await run(agent, prompt, { maxTurns, signal: controller.signal })
    })
  } catch (error) {
    if (controller.signal.aborted) {
      opts.logger?.warn?.('decomposition job aborted due to budget', {
        jobId: job.id,
        ideaId: job.idea_id,
        profileId: job.profile_id,
        runId,
        budgetMs,
        error
      })
      await mintBudgetStop(ctx, job.idea_id, job.profile_id, opts.logger)
    } else {
      throw error
    }
  } finally {
    clearTimeout(timeoutId)
  }

  if (opts.logger) {
    opts.logger.info?.('decomposition job completed', {
      jobId: job.id,
      ideaId: job.idea_id,
      profileId: job.profile_id,
      runId,
      candidateIds,
      budgetMs,
      minted: log
    })
  }
}
