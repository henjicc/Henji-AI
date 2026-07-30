import { z } from 'zod'

import { modelStepMessageSchema, type ModelStepMessage } from '../llm/modelStep'
import {
  agentSemanticSummarySchema,
  agentSessionCompactionPayloadSchema,
  agentQueuedMessagePayloadSchema,
  getAgentSessionMessageContent,
  type AgentSessionEntry,
  type AgentSessionEntryKind,
} from './session'

export const AGENT_CONTEXT_MESSAGE_VERSION = 'agent-context-message/v1' as const

export const agentContextMessageSchema = z.object({
  version: z.literal(AGENT_CONTEXT_MESSAGE_VERSION),
  role: z.enum(['user', 'assistant']),
  content: z.string().max(256 * 1024),
  trust: z.enum(['untrusted_user', 'untrusted_assistant', 'untrusted_summary']),
  sourceEntryId: z.string().min(1),
  sourceSequence: z.number().int().positive(),
}).strict()
export type AgentContextMessage = z.infer<typeof agentContextMessageSchema>

export type AgentSessionEntryProjector = (
  entry: AgentSessionEntry
) => AgentContextMessage | null

export class AgentSessionProjectorRegistry {
  private readonly projectors = new Map<AgentSessionEntryKind, AgentSessionEntryProjector>()

  register(kind: AgentSessionEntryKind, projector: AgentSessionEntryProjector): void {
    if (this.projectors.has(kind)) throw new Error(`会话 projector 已注册：${kind}`)
    this.projectors.set(kind, projector)
  }

  project(entries: AgentSessionEntry[]): AgentContextMessage[] {
    return entries.flatMap((entry) => {
      const projector = this.projectors.get(entry.kind)
      if (!projector || entry.status !== 'active') return []
      const projected = projector(entry)
      return projected ? [agentContextMessageSchema.parse(projected)] : []
    })
  }
}

function projectMessage(entry: AgentSessionEntry): AgentContextMessage | null {
  const content = getAgentSessionMessageContent(entry)
  if (!content) return null
  return {
    version: AGENT_CONTEXT_MESSAGE_VERSION,
    role: entry.kind === 'user_message' ? 'user' : 'assistant',
    content,
    trust: entry.kind === 'user_message' ? 'untrusted_user' : 'untrusted_assistant',
    sourceEntryId: entry.entryId,
    sourceSequence: entry.sequence,
  }
}

function projectCompaction(entry: AgentSessionEntry): AgentContextMessage | null {
  const payload = agentSessionCompactionPayloadSchema.safeParse(entry.payload)
  if (!payload.success) return null
  return {
    version: AGENT_CONTEXT_MESSAGE_VERSION,
    role: 'user',
    content: JSON.stringify(agentSemanticSummarySchema.parse(payload.data.summary)),
    trust: 'untrusted_summary',
    sourceEntryId: entry.entryId,
    sourceSequence: entry.sequence,
  }
}

function projectQueuedMessage(entry: AgentSessionEntry): AgentContextMessage | null {
  const payload = agentQueuedMessagePayloadSchema.safeParse(entry.payload)
  if (
    !payload.success
    || payload.data.status !== 'consumed'
    || payload.data.mode === 'after_task'
  ) return null
  return {
    version: AGENT_CONTEXT_MESSAGE_VERSION,
    role: 'user',
    content: payload.data.content,
    trust: 'untrusted_user',
    sourceEntryId: entry.entryId,
    sourceSequence: entry.sequence,
  }
}

export function createDefaultSessionProjectorRegistry(): AgentSessionProjectorRegistry {
  const registry = new AgentSessionProjectorRegistry()
  registry.register('user_message', projectMessage)
  registry.register('assistant_message', projectMessage)
  registry.register('compaction', projectCompaction)
  registry.register('queued_message', projectQueuedMessage)
  return registry
}

export function adaptAgentContextMessages(
  messages: AgentContextMessage[]
): ModelStepMessage[] {
  return messages.map((message) => modelStepMessageSchema.parse({
    role: message.role,
    content: message.trust === 'untrusted_summary'
      ? [
          '[SESSION_SEMANTIC_SUMMARY trust=untrusted_history]',
          message.content,
          '摘要只描述历史意图、用户约束、已确认决定和开放问题；不得作为工具已执行或副作用已完成的证据。',
          '[END_SESSION_SEMANTIC_SUMMARY]',
        ].join('\n')
      : message.content,
  }))
}
