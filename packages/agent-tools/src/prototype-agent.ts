import { Agent, run, tool } from '@openai/agents'
import type { Tool } from '@openai/agents'
import readline from 'node:readline/promises'
import { createObjectStore } from '@wofi/store'
import { createPool } from '@wofi/indexer'
import { createAgentTools } from './agents.js'
import type { ToolContext } from './types.js'

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg || !arg.startsWith('--')) continue
    const [key, value] = arg.slice(2).split('=')
    if (!key) continue
    if (value !== undefined) {
      out[key] = value
    } else {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        out[key] = next
        i += 1
      } else {
        out[key] = true
      }
    }
  }
  return out
}

async function resolvePrompt(args: Record<string, string | boolean>): Promise<string> {
  if (typeof args.prompt === 'string') return args.prompt

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('Idea prompt: ')
  rl.close()
  return answer.trim()
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const prompt = await resolvePrompt(args)
  if (!prompt) {
    throw new Error('No prompt provided')
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }

  const pool = createPool(databaseUrl)
  const store = await createObjectStore()
  const ctx: ToolContext = { store, pool, allowUnsigned: true }

  const debugTools = process.env.WOFI_AGENT_TOOL_DEBUG === 'true'
  const toolFactory = ((config) => {
    const execute = async (input: unknown) => {
      if (debugTools) {
        console.log(`[tool:${config.name}] input`, JSON.stringify(input))
      }
      return await config.execute(input as never)
    }
    return tool({
      ...(config as any),
      execute,
      strict: true,
      errorFunction: debugTools
        ? (_context: unknown, error: unknown) => {
            console.error(`[tool:${config.name}] error`, error)
            return `Tool ${config.name} failed: ${error}`
          }
        : undefined
    } as any)
  }) as Parameters<typeof createAgentTools>[1]
  const tools = createAgentTools(ctx, toolFactory) as Tool[]

  const defaultProfileId = process.env.WOFI_DEFAULT_PROFILE_ID ?? 'default'

  const agentConfig: ConstructorParameters<typeof Agent>[0] = {
    name: 'wofi_intake_agent_v0',
    instructions:
      'You are the WOFI intake agent. Given a user idea, do the following in order: ' +
      '1) call wofi.mint_submission using the full user prompt as conversation_export; ' +
      '2) extract a clean idea draft and call wofi.mint_idea; ' +
      '3) link the submission to the idea using wofi.link_edge with rel SUBMITTED_AS; ' +
      `4) enqueue decomposition using decomposition.enqueue with the idea_id and profile_id \"${defaultProfileId}\". ` +
      'Ask one clarifying question only if required, otherwise proceed with tool calls.',
    tools
  }
  if (typeof args.model === 'string') agentConfig.model = args.model

  const agent = new Agent(agentConfig)

  const result = await run(agent, prompt)
  if (result.finalOutput) {
    console.log(result.finalOutput)
  }

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
