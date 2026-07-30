import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepMessage, ModelStepTool } from '../../../../../src/core/llm/modelStep'
import type { AgentMemoryContextEntry } from '../../../../../src/core/assistant/memory'
import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'

export const AGENT_INTENTS = [
  'navigate',
  'generate',
  'inspect_model',
  'read_generation',
  'cancel_generation',
  'diagnose',
  'canvas',
  'toolbox',
  'camera_stage',
  'storyboard',
  'image_edit',
  'assets',
  'workflow',
  'user_instructions',
  'memory',
  'general',
] as const
export type AgentIntent = typeof AGENT_INTENTS[number]

export const AGENT_TOOL_DOMAINS = [
  'catalog',
  'navigation',
  'models',
  'generation',
  'diagnostics',
  'canvas',
  'toolbox',
  'camera_stage',
  'storyboard',
  'image_edit',
  'assets',
  'workflows',
  'user_instructions',
  'memory',
  'artifacts',
] as const
export type AgentToolDomain = typeof AGENT_TOOL_DOMAINS[number]

export type AgentRoutePath = 'workflow' | 'primary'

export const AGENT_CONTEXT_LAYER_IDS = [
  'model_catalog',
  'current_goal',
  'host_state',
  'plan_state',
  'user_instructions',
  'confirmed_memory',
  'tool_contracts',
  'observations',
] as const
export type AgentContextLayerId = typeof AGENT_CONTEXT_LAYER_IDS[number]

export interface AgentContextLayer {
  id: AgentContextLayerId
  source: string
  trust: 'trusted_runtime' | 'untrusted_user' | 'untrusted_memory' | 'untrusted_observation'
  priority: number
  required: boolean
  maxTokens: number
  content: string
}

export interface AgentContextLayerReport {
  id: AgentContextLayerId
  included: boolean
  estimatedTokens: number
  truncated: boolean
  reason: string
}

export interface AgentRouteDecision {
  intent: AgentIntent
  candidateIntents?: AgentIntent[]
  complexity: 'simple' | 'multi_step' | 'ambiguous'
  path: AgentRoutePath
  toolDomains: AgentToolDomain[]
  source: 'deterministic' | 'router_model' | 'fallback'
  reason: string
}

export interface AgentContextArtifact {
  artifactRef: string
  source: string
  dataClasses: AgentToolObservation['dataClasses']
  createdAt: string
  originalBytes: number
  payload: unknown
}

export interface AgentContextBuildInput {
  runId: string
  goal: string
  userInstructions?: string
  memoryContext?: AgentMemoryContextEntry[]
  snapshot: HostContextSnapshot
  route: AgentRouteDecision
  conversation: ModelStepMessage[]
  observations: AgentToolObservation[]
  modelTools: ModelStepTool[]
  activeToolNames: string[]
  contextWindowBudget: number
  maxOutputTokens?: number
  workingSummary?: AgentWorkingSummary
  lastModelUsage?: {
    inputTokens: number
    conversationMessageCount: number
  }
}

export interface AgentContextBuildResult {
  system: string
  messages: ModelStepMessage[]
  tools: ModelStepTool[]
  activeToolNames: string[]
  estimatedTokens: number
  snapshotRevision: number
  compacted: boolean
  beforeCompactionTokens: number
  offloaded: AgentContextArtifact[]
  layerReports: AgentContextLayerReport[]
  retainedLayers: AgentContextLayerId[]
  droppedLayers: AgentContextLayerId[]
  compactionReason: string | null
}
