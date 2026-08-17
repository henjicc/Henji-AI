import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepMessage, ModelStepTool } from '../../../../../src/core/llm/modelStep'
import type { AgentMemoryContextEntry } from '../../../../../src/core/assistant/memory'
import type { AssistantSkillMetadata } from '../../../../../src/core/assistant/skills'
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
  /*
   * `image_mark` 与 `image_edit` 是两个域，不是一个域的两种写法。
   *
   * 图片编辑器这个 Surface 上住着两套能力：`image_edit` 管预览与来源（create_image_edit_preview
   * 等），`image_mark` 管标注文档本身（undo/redo，实体是 image_mark.document /
   * image_mark.annotation）。后者此前从未出现在这份清单里，于是它既进不了
   * `search_application_capabilities` 的分类枚举，也不被任何 intent 的 toolDomains 锚定——
   * 模型没有任何途径学到"image_mark"这个词，只会猜 image_edit，而那是另一个域。
   *
   * 这与设置域那次事故是同一形状（能力声明 application.setting、注册表登记 settings.registry，
   * 一次改设置从 5 回合 3.8 万 token 变成 18 回合 25 万）：同一样东西两个名字，或者一个名字
   * 只登记了一半，代价都是模型撞墙。
   */
  'image_mark',
  'assets',
  'user_instructions',
  'memory',
  'artifacts',
  'application',
  'settings',
] as const
export type AgentToolDomain = typeof AGENT_TOOL_DOMAINS[number]

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
  /**
   * 每轮都会变的层（宿主 revision、任务图进展、观察索引、活动工具集）。
   *
   * 供应商的上下文缓存按**前缀完整匹配**计费：前缀一旦出现差异，后面全部落空。所以这些层
   * 必须排在只增不改的对话历史之后，否则每轮都会把整段历史挤出缓存。
   */
  volatile?: boolean
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
  toolDomains: AgentToolDomain[]
  reason: string
  /**
   * 本轮用户目标是否是一个具体的应用任务（而不是闲聊或路由兜底）。
   *
   * **这是一个授权位，不是分类标签。** 唯一消费方是 approval-policy：`assistant_decides`
   * 模式下，只有它为真才自动放行 R1 非只读非破坏性工具。
   *
   * 以前这个语义靠 `intent !== 'general'` 现场推断——把一个用于提示词与评测打分的分类标签
   * 当权限位用，intent 的取值稍有演化就会静默改变每次运行的授权范围。现在由 router 在每一个
   * return 点显式赋值，且**必填无默认值**，漏赋值在 TypeScript 编译期就会被拦下。
   */
  explicitUserIntent: boolean
  /** 因承接上一轮任务而额外放宽的工具域；与 toolDomains 分开记录，只用于日志与解释。 */
  continuationDomains?: AgentToolDomain[]
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
  /**
   * 按工具名解析历史投影函数，由 runner 从工具注册表注入。
   *
   * 观察层的卸载判定必须和 runner-results.toolMessage 用同一把尺子，包括先裁再判——
   * 否则同一份结果在 tool 消息里被内联、在观察层却被卸载成 artifact，模型看到 artifactRef
   * 就会去分页读回一份它其实已经有的内容。
   */
  resolveHistoryProjection?: (toolName: string) => ((output: unknown) => unknown) | undefined
  maxOutputTokens?: number
  workingSummary?: AgentWorkingSummary
  lastModelUsage?: {
    inputTokens: number
    conversationMessageCount: number
    /**
     * 上一轮**本地估算**的输入 token 数，与 `inputTokens` 是同一份请求的两种口径。
     *
     * 有了这一对数就能算出估算器相对本供应商、本内容配比的真实倍率，让分层预算按真值走。
     * 缺它的时候预算只能信估算器，而估算器按设计「宁可高估」：实测三维场景第 7 轮估 46,248、
     * 供应商实收 32,046，高估 44%，于是预算凭空少了一万多，`user_instructions` 与
     * `skills_index` 被判超额丢弃——两层都在可缓存前缀里，一丢整段对话缓存作废，
     * 命中量从 20,480 掉回 4,096，而模型正好在写最终答复时失去了技能索引。
     */
    estimatedInputTokens?: number
    /**
     * 上一轮供应商实际报告的前缀缓存命中/写入量。
     *
     * 只用于日志，不参与任何阈值计算。补它是因为「稳定层 → 对话历史 → 易变层」这个顺序
     * 到底有没有让缓存命中率涨起来，在生产日志里查不到任何证据——`ModelStepUsage` 早就有
     * 这几个字段，只是从来没有往结构化日志里写过。
     */
    cacheReadTokens?: number | null
    cacheWriteTokens?: number | null
    inputNoCacheTokens?: number | null
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

