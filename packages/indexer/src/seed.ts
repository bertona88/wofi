#!/usr/bin/env node
import { contentId } from '@wofi/kernel'
import { loadConfig } from './config.js'
import { createPool } from './db.js'
import { runMigrations } from './migrations.js'
import { ingestObject } from './ingest.js'
import { createLogger } from './logger.js'

type KernelObject = Record<string, unknown>

function withContentId<T extends KernelObject>(obj: T): T & { content_id: string } {
  const id = contentId(obj)
  return { ...obj, content_id: id }
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg?.startsWith('--')) continue
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

async function seed(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const logger = createLogger({ json: args['log-json'] === true })
  const overrides: { allowUnsigned?: boolean } = {}
  if (args['allow-unsigned'] === true) {
    overrides.allowUnsigned = true
  }
  const config = loadConfig(overrides)
  const pool = createPool(config.databaseUrl)

  await runMigrations(pool, { logger })

  const ideaA = withContentId({
    type: 'wofi.idea.v1',
    schema_version: '1.0',
    title: 'Solar Desalination Raft',
    kind: 'concept',
    summary: 'Floating raft that uses solar heat to desalinate seawater.',
    tags: ['desalination', 'solar'],
    created_at: '2026-01-10T00:00:00Z'
  })

  const ideaB = withContentId({
    type: 'wofi.idea.v1',
    schema_version: '1.0',
    title: 'Modular Coastal Desalination System',
    kind: 'concept',
    summary: 'Network of solar rafts with shared brine management.',
    tags: ['desalination', 'modular'],
    created_at: '2026-01-11T00:00:00Z'
  })

  const profile = withContentId({
    type: 'wofi.profile.v1',
    schema_version: '1.0',
    name: 'default',
    kernel_primitives: [],
    operator_cost: {
      compose: 1,
      specialize: 1,
      generalize: 1,
      analogize: 1,
      bundle: 1,
      refine: 1
    },
    cost_model: {
      ref_existing_idea: 1,
      mint_new_idea: 10,
      mint_new_construction: 1,
      param_byte: 0.01,
      residual_byte: 0.01
    },
    created_at: '2026-01-09T00:00:00Z'
  })

  const construction = withContentId({
    type: 'wofi.construction.v1',
    schema_version: '1.0',
    profile_id: profile.content_id,
    operator: 'compose',
    inputs: [
      {
        idea_id: ideaA.content_id,
        role: 'basis'
      }
    ],
    created_at: '2026-01-12T00:00:00Z'
  })

  const implementation = withContentId({
    type: 'wofi.implementation.v1',
    schema_version: '1.0',
    implements: {
      idea_id: ideaB.content_id
    },
    artifact: {
      kind: 'url',
      value: 'https://example.com/wofi-seed-demo'
    },
    metadata: { stage: 'prototype' },
    created_at: '2026-01-16T00:00:00Z'
  })

  const claim = withContentId({
    type: 'wofi.claim.v1',
    schema_version: '1.0',
    claim_text: 'The system produces 500L/day in coastal conditions.',
    claim_kind: 'binary',
    resolution: {
      criteria: 'Pilot test output >= 500L/day',
      resolve_by: '2026-12-31'
    },
    created_at: '2026-01-14T00:00:00Z'
  })

  const evidence = withContentId({
    type: 'wofi.evidence.v1',
    schema_version: '1.0',
    kind: 'report',
    locator: 'https://example.com/wofi-seed-report.pdf',
    metadata: { source: 'lab' },
    created_at: '2026-01-15T00:00:00Z'
  })

  const edgeInput = withContentId({
    type: 'wofi.edge.v1',
    schema_version: '1.0',
    rel: 'INPUT_OF',
    from: { kind: 'idea', id: ideaA.content_id },
    to: { kind: 'construction', id: construction.content_id },
    created_at: '2026-01-12T00:00:00Z'
  })

  const edgeOutput = withContentId({
    type: 'wofi.edge.v1',
    schema_version: '1.0',
    rel: 'OUTPUT_OF',
    from: { kind: 'construction', id: construction.content_id },
    to: { kind: 'idea', id: ideaB.content_id },
    created_at: '2026-01-12T00:00:00Z'
  })

  const edgeAbout = withContentId({
    type: 'wofi.edge.v1',
    schema_version: '1.0',
    rel: 'ABOUT',
    from: { kind: 'claim', id: claim.content_id },
    to: { kind: 'idea', id: ideaB.content_id },
    created_at: '2026-01-14T00:00:00Z'
  })

  const edgeSupports = withContentId({
    type: 'wofi.edge.v1',
    schema_version: '1.0',
    rel: 'SUPPORTS',
    from: { kind: 'evidence', id: evidence.content_id },
    to: { kind: 'claim', id: claim.content_id },
    created_at: '2026-01-15T00:00:00Z'
  })

  const edgeImplements = withContentId({
    type: 'wofi.edge.v1',
    schema_version: '1.0',
    rel: 'IMPLEMENTS',
    from: { kind: 'implementation', id: implementation.content_id },
    to: { kind: 'idea', id: ideaB.content_id },
    created_at: '2026-01-16T00:00:00Z'
  })

  const objects = [
    profile,
    ideaA,
    ideaB,
    construction,
    implementation,
    claim,
    evidence,
    edgeInput,
    edgeOutput,
    edgeAbout,
    edgeSupports,
    edgeImplements
  ]

  for (const obj of objects) {
    const result = await ingestObject(pool, { canonicalJson: obj }, {
      allowUnsigned: true,
      logger
    })
    if (result.status === 'failed') {
      throw new Error(`Seed ingest failed for ${result.wofiType}: ${result.error ?? 'unknown error'}`)
    }
  }

  logger.info?.('seed complete', {
    ideaA: ideaA.content_id,
    ideaB: ideaB.content_id,
    construction: construction.content_id,
    claim: claim.content_id,
    evidence: evidence.content_id,
    implementation: implementation.content_id,
    profile: profile.content_id
  })

  await pool.end()
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
