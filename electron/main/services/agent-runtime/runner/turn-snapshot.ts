import { createHash } from 'node:crypto'

import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import {
  AGENT_COMPACTION_VERSION,
  AGENT_PROJECTION_VERSION,
  AGENT_TURN_SNAPSHOT_VERSION,
  agentTurnSnapshotDraftSchema,
  type AgentTurnSnapshotDraft,
} from '../../../../../src/core/assistant/turn'
import type { AgentToolRegistration } from '../tools/types'
import type { AgentRuntimeModelSet } from './models'

interface BuildTurnSnapshotInput {
  runId: string
  threadId: string
  turn: number
  host: HostContextSnapshot
  models: AgentRuntimeModelSet
  registrations: AgentToolRegistration[]
  artifactRefs: string[]
  approvalMode: 'ask' | 'assistant_decides' | 'full_access'
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function buildAgentTurnSnapshotDraft(input: BuildTurnSnapshotInput): AgentTurnSnapshotDraft {
  const model = (role: 'primary' | 'router' | 'summarizer') => ({
    role,
    providerId: input.models[role].providerId,
    modelId: input.models[role].modelId,
    apiProtocol: input.models[role].adapter,
  })
  return agentTurnSnapshotDraftSchema.parse({
    version: AGENT_TURN_SNAPSHOT_VERSION,
    runId: input.runId,
    threadId: input.threadId,
    turn: input.turn,
    projectionVersion: AGENT_PROJECTION_VERSION,
    compactionVersion: AGENT_COMPACTION_VERSION,
    models: [model('primary'), model('router'), model('summarizer')],
    tools: input.registrations.map((registration) => ({
      name: registration.catalog.name,
      version: registration.catalog.version,
      schemaDigest: digest(registration.modelTool),
    })),
    scopeRevisions: input.host.scopeRevisions,
    artifactRefs: [...new Set(input.artifactRefs)].slice(0, 100),
    requestOptions: {
      contextWindow: input.models.primary.limits.contextWindow,
      maxOutputTokens: input.models.primary.settings.maxOutputTokens,
      timeoutMs: input.models.primary.settings.timeoutMs,
      approvalMode: input.approvalMode,
    },
  })
}
