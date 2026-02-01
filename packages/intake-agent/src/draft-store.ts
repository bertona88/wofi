import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DraftRecord } from './types.js'

const DEFAULT_BASE_DIR = path.resolve(process.cwd(), 'devstore', 'intake-drafts')

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export class DraftStore {
  private readonly baseDir: string

  constructor(baseDir: string | undefined = DEFAULT_BASE_DIR) {
    this.baseDir = baseDir
  }

  private conversationDir(conversationId: string): string {
    return path.join(this.baseDir, sanitizeId(conversationId))
  }

  private draftPath(conversationId: string, rev: number, hash: string): string {
    const filename = `draft_${rev}_${hash}.json`
    return path.join(this.conversationDir(conversationId), filename)
  }

  async save(record: DraftRecord): Promise<void> {
    const dir = this.conversationDir(record.conversation_id)
    await fs.mkdir(dir, { recursive: true })
    const filePath = this.draftPath(record.conversation_id, record.rev, record.hash)
    const payload = JSON.stringify(record, null, 2)
    await fs.writeFile(filePath, payload, 'utf8')
    await fs.writeFile(path.join(dir, 'latest.json'), payload, 'utf8')
  }

  async loadLatest(conversationId: string): Promise<DraftRecord | null> {
    const filePath = path.join(this.conversationDir(conversationId), 'latest.json')
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      return JSON.parse(raw) as DraftRecord
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null
      throw err
    }
  }

  async load(conversationId: string, rev: number, hash: string): Promise<DraftRecord | null> {
    const filePath = this.draftPath(conversationId, rev, hash)
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      return JSON.parse(raw) as DraftRecord
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null
      throw err
    }
  }
}
