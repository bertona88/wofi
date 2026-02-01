import readline from 'node:readline/promises'
import OpenAI from 'openai'
import { run } from '@openai/agents'
import { createObjectStore } from '@wofi/store'
import { createPool } from '@wofi/indexer'
import { DraftStore } from './draft-store.js'
import { ConversationStateStore } from './conversation-state.js'
import { createIntakeAgent } from './intake-agent.js'
import type { ToolContext } from '@wofi/agent-tools'

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

async function resolveConversationId(
  client: OpenAI,
  args: Record<string, string | boolean>
): Promise<string> {
  const provided =
    (typeof args['conversation-id'] === 'string' && args['conversation-id']) ||
    (typeof args.conversationId === 'string' && args.conversationId) ||
    (typeof args.conversation === 'string' && args.conversation)

  if (provided) return provided

  const conversation = await client.conversations.create({
    metadata: { wofi_state: 'draft' }
  })
  console.log(`New conversation: ${conversation.id}`)
  return conversation.id
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const prompt = await resolvePrompt(args)
  if (!prompt) throw new Error('No prompt provided')

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  const openai = new OpenAI()
  const conversationId = await resolveConversationId(openai, args)
  const stateStore = new ConversationStateStore(openai, conversationId)
  await stateStore.ensureInitialized()

  const gate = await stateStore.ensureOpen()
  if (!gate.open) {
    console.log('Conversation is closed. Start a new submission.')
    return
  }

  const pool = createPool(databaseUrl)
  const store = await createObjectStore()
  const ctx: ToolContext = { store, pool, allowUnsigned: true }

  const draftDir =
    typeof args['draft-dir'] === 'string'
      ? args['draft-dir']
      : process.env.WOFI_INTAKE_DRAFT_DIR
  const draftStore = new DraftStore(draftDir)

  const defaultProfileId =
    (typeof args['profile-id'] === 'string' && args['profile-id']) ||
    process.env.WOFI_DEFAULT_PROFILE_ID ||
    'default'

  const debugTools = process.env.WOFI_AGENT_TOOL_DEBUG === 'true'
  const model = typeof args.model === 'string' ? args.model : undefined

  const intakeOptions = {
    openai,
    conversationId,
    ctx,
    draftStore,
    defaultProfileId,
    debugTools,
    ...(model ? { model } : {})
  }

  const { agent } = createIntakeAgent(intakeOptions)

  const result = await run(agent, prompt, { conversationId })
  if (result.finalOutput) console.log(result.finalOutput)

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
