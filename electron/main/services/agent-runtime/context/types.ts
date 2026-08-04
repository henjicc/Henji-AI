import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepMessage, ModelStepTool } from '../../../../../src/core/llm/modelStep'
import type { AgentMemoryContextEntry } from '../../../../../src/core/assistant/memory'
import type { AssistantSkillMetadata } from '../../../../../src/core/assistant/skills'
import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import type { AgentTaskGraph } from '../../../../../src/core/assistant/taskGraph'

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
  'settings',
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
  'application',
  'settings',
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
  'skills_index',
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
  routeVersion?: 'agent-route/v2'
  intent: AgentIntent
  candidateIntents?: AgentIntent[]
  complexity: 'simple' | 'multi_step' | 'ambiguous'
  path: AgentRoutePath
  toolDomains: AgentToolDomain[]
  source: 'deterministic' | 'router_model' | 'fallback'
  reason: string
  /** 软规划信息，只影响能力排序，不限制能力发现，也不授予权限。 */
  anchorSurfaceId?: string
  taskFacets?: string[]
  suggestedCapabilityQueries?: string[]
  /** 可持久化的多领域任务图；旧保存点读取时允许缺失。 */
  taskGraph?: AgentTaskGraph
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
  /** 本次运行开始时扫描到的已启用技能，只用于构建 skills_index 层，正文按需加载。 */
  skills?: AssistantSkillMetadata[]
  snapshot: HostContextSnapshot
  route: AgentRouteDecision
  conversation: ModelStepMessage[]
  observations: AgentToolObservation[]
  modelTools: ModelStepTool[]
  activeToolNames: string[]
  /** 核心地板和活动 Facet 租约；最终上下文裁剪不得静默删除。 */
  protectedToolNames?: string[]
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
  contextPressure: 'normal' | 'soft' | 'hard'
}
