import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepMessage, ModelStepTool } from '../../../../../src/core/llm/modelStep'
import type { AgentMemoryContextEntry } from '../../../../../src/core/assistant/memory'

export type AgentIntent =
  | 'navigate'
  | 'generate'
  | 'inspect_model'
  | 'read_generation'
  | 'cancel_generation'
  | 'diagnose'
  | 'canvas'
  | 'toolbox'
  | 'camera_stage'
  | 'storyboard'
  | 'image_edit'
  | 'assets'
  | 'workflow'
  | 'user_instructions'
  | 'memory'
  | 'general'

export type AgentRoutePath = 'workflow' | 'primary'

export interface AgentRouteDecision {
  intent: AgentIntent
  complexity: 'simple' | 'multi_step' | 'ambiguous'
  path: AgentRoutePath
  toolDomains: string[]
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
