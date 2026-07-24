import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepMessage, ModelStepTool } from '../../../../../src/core/llm/modelStep'
import type { AgentMemoryContextEntry } from '../../../../../src/core/assistant/memory'

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
] as const
export type AgentToolDomain = typeof AGENT_TOOL_DOMAINS[number]

export type AgentRoutePath = 'workflow' | 'primary'

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
}
