import type { LlmApiProtocol } from './providerProtocol'
import type { LlmReasoningConfig } from './reasoning'

export type { LlmReasoningConfig, LlmReasoningEffort } from './reasoning'

export interface LlmCapabilities {
  text: boolean
  image: boolean
  video: boolean
  audio: boolean
  /** 宿主已持有的文件 URL / 内联字节；不表示 SDK 提供供应商文件上传。 */
  file?: boolean
  streaming: boolean
  toolCall: boolean
  parallelTools: boolean
  jsonOutput: boolean
  structuredOutputMode: 'none' | 'json' | 'schema'
  reasoning: boolean
  sampling: boolean
  contextWindow: number | null
  maxOutputTokens: number | null
  usage: boolean
}

export interface LlmProviderConfig {
  providerId: string
  /** 供应商协议族；区域化或多租户实例共享同一套协议规则。 */
  providerFamilyId?: string
  /** 当前实例选择的端点 profile。 */
  endpointProfile?: string
  /** RuntimeContext.credentials 的独立凭据槽；省略时兼容使用 providerId。 */
  credentialId?: string
  /** 供应商配置来源与生命周期；旧配置缺省值只允许由宿主归一化一次。 */
  setup?: LlmProviderSetup
  displayName: string
  adapter: string
  apiProtocol?: LlmApiProtocol
  baseUrl?: string
  reasoning?: LlmReasoningConfig
  reasoningConfigurable?: boolean
  enabled: boolean
}

export type LlmProviderSetup =
  | {
      kind: 'preset'
      presetId: string
      /** 内置记录不可永久删除；user 预设实例可以删除。 */
      lifecycle: 'builtin' | 'user'
      /**
       * 预设连接信息的显式覆盖。缺省时继续使用 SDK 按模型维护的官方地址与首选协议；
       * 宿主只有在用户主动编辑连接设置后才应写入这里。
       */
      connectionOverrides?: {
        baseUrl?: string
        apiProtocol?: LlmApiProtocol
      }
    }
  | {
      kind: 'custom'
      /** 自定义供应商可选的密钥管理页，只允许 HTTP(S)。 */
      apiKeyManagementUrl?: string
    }

export interface LlmModelConfig {
  providerId: string
  providerFamilyId?: string
  endpointProfile?: string
  credentialId?: string
  modelId: string
  displayName: string
  adapter: string
  apiProtocol?: LlmApiProtocol
  baseUrl?: string
  capabilities: LlmCapabilities
  /**
   * 命中的内置模型能力目录条目 id（`src/core/llm/modelCatalog.ts`）。
   *
   * 只表示"这条配置已经按目录自动标注过一次"，用来避免归一化在每次保存时反复覆盖用户的手工修改；
   * 值为空且模型 ID 能查到目录条目时，归一化会补一次标注并写上这个字段。
   */
  catalogId?: string
  pricing?: {
    currency: 'USD'
    inputPerMillionTokens: number
    outputPerMillionTokens: number
    cacheReadPerMillionTokens?: number
    cacheWritePerMillionTokens?: number
  }
  enabled: boolean
}

export type AgentModelRole = 'primary' | 'router' | 'summarizer' | 'fallback' | 'observer'

export interface AgentModelReference {
  providerId: string
  modelId: string
}

/**
 * 智能助手能力验证快照，结构与 `capabilitySmoke.ts` 的 `ModelCapabilitySmokeResult` 一致。
 *
 * `capabilitySmoke.ts`/`capabilitySmokeCapabilities.ts` 目前仍留在痕迹AI 应用侧（任务 4.1
 * 明确划定的迁移范围之外，见 docs/task/模型SDK抽离/任务/第四阶段-大语言模型迁移/4.1-迁移LLM协议与目录层.md），
 * 但 `AgentModelProfile.verifications` 的实际读写方（`LlmConfigService.ts`、
 * `AgentModelProfilesSection.tsx`）都按这份具体字段结构做属性访问，不能简单改成 `unknown`——
 * 那会让这些消费方在数组元素上的每一次属性访问都报错。这里按字段结构复刻一份而不是反向导入
 * `./capabilitySmoke`（那样会让 SDK 依赖尚未迁移的应用侧模块），TypeScript 是结构类型系统，
 * `ModelCapabilitySmokeResult` 的值可以直接赋给这个类型，调用方不需要任何显式转换。
 * `capabilitySmoke.ts` 迁入 SDK 后应删除这份复刻，直接复用同一个类型。
 */
export interface AgentModelCapabilityVerification {
  providerId: string
  modelId: string
  adapterVersion: string
  verifiedAt: string
  checks: Array<{
    id: 'text' | 'toolCall' | 'structuredOutput' | 'streaming' | 'usage' | 'cancel' | 'image' | 'video' | 'audio'
    status: 'passed' | 'failed' | 'skipped'
    latencyMs: number
    errorCode?: string
  }>
  totalLatencyMs: number
  usage: {
    inputTokens: number | null
    outputTokens: number | null
    reasoningTokens: number | null
    cacheReadTokens: number | null
    cacheWriteTokens: number | null
    totalTokens: number | null
  }
  cost: { status: 'unknown' } | { status: 'known'; amount: number; currency: string }
}

export interface AgentModelProfile {
  id: string
  name: string
  primary: AgentModelReference
  router?: AgentModelReference
  summarizer?: AgentModelReference
  fallback?: AgentModelReference
  observer?: AgentModelReference
  settings: {
    timeoutMs: number
    maxRetries: number
    maxOutputTokens: number
    contextWindowBudget: number
    temperature?: number
  }
  verifications: AgentModelCapabilityVerification[]
  createdAt: string
  updatedAt: string
}

export interface PromptOptimizationProfile {
  id: string
  name: string
  providerId: string
  modelId: string
  systemPrompt: string
  /**
   * 富文本提示词文档（痕迹AI 画布的 `PromptDocumentV1`，定义于 `@/core/inputs/promptDocument`）。
   *
   * SDK 侧特意不引入 `PromptDocumentV1`——那是一个体量不小、仍在演进的画布专属文档格式，
   * 与"供应商无关的模型协议类型"无关，具体类型留给应用侧。这里只保留字段位置，类型标成
   * `unknown`；唯一真正读写这个字段内部结构的地方（`src/core/llm/promptOptimization.ts`）
   * 已经把它传给同样以 `unknown` 接收 `document` 的 `readPromptDocument()`，不需要显式转换。
   */
  systemPromptDocument?: unknown
  userTemplate: string
  userTemplateDocument?: unknown
  capabilities: Pick<LlmCapabilities, 'text' | 'image' | 'video'>
  isDefault: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface TextProcessingPromptTemplate {
  id: string
  name: string
  systemPrompt: string
  createdAt: string
  updatedAt: string
}

/**
 * `inputSchema`/`outputSchema` 原用项目全局的 `DynamicValue`（等价于 `any`，声明于
 * `src/types/dynamic-value.d.ts` 的 `declare global`）。SDK 是独立源码包，不依赖本仓库的全局
 * 环境声明，这里改用 `unknown`——比 `any` 更安全，且调用方目前都是原样透传，不做属性访问，
 * 收窄类型不影响任何现有用法。
 */
export interface LlmToolSchema {
  name: string
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
}

export interface LlmPolicy {
  allowedTools: string[]
  requireHumanConfirmation: boolean
  maxTokens?: number
}

export interface LlmMemoryScope {
  sessionId?: string
  conversationId?: string
  longTermNamespace?: string
}

export interface LlmConfigState {
  providers: LlmProviderConfig[]
  models: LlmModelConfig[]
  promptProfiles: PromptOptimizationProfile[]
  selectedPromptProfileId?: string
  textProcessingPromptTemplates: TextProcessingPromptTemplate[]
  agentProfiles: AgentModelProfile[]
  selectedAgentProfileId?: string
  tools: LlmToolSchema[]
  policy: LlmPolicy
  memory: LlmMemoryScope
}

export interface LlmTrace {
  providerId: string
  modelId: string
  startedAtMs: number
  elapsedMs: number
  inputChars: number
  outputChars: number
}

export type LlmStreamEvent =
  | { type: 'Token'; data: string }
  | { type: 'ReasoningToken'; data: string }
  | { type: 'Done'; data: LlmTrace }
  | { type: 'Error'; data: string }

export interface LlmImageUrlPart {
  type: 'image_url'
  imageUrl: {
    url: string
  }
}

export interface LlmVideoUrlPart {
  type: 'video_url'
  videoUrl: {
    url: string
  }
}

export interface LlmInputAudioPart {
  type: 'input_audio'
  inputAudio: {
    data: string
    format: string
  }
}

export interface LlmFilePart {
  type: 'file'
  file: {
    /** 宿主已取得的可访问 URL；SDK 不负责创建或上传 file_id。 */
    fileUrl?: string
    /** Base64/供应商已接受的内联内容。 */
    fileData?: string
    filename?: string
  }
}

export interface LlmTextPart {
  type: 'text'
  text: string
}

export type LlmMessageContentPart =
  | LlmTextPart
  | LlmImageUrlPart
  | LlmVideoUrlPart
  | LlmInputAudioPart
  | LlmFilePart

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | LlmMessageContentPart[] | null
  name?: string | null
}

export interface LlmChatRequest {
  requestId?: string
  providerId: string
  providerFamilyId?: string
  endpointProfile?: string
  credentialId?: string
  modelId: string
  adapter?: string
  baseUrl?: string
  reasoning?: LlmReasoningConfig
  messages: LlmChatMessage[]
  capabilities?: Partial<LlmCapabilities>
  tools?: LlmToolSchema[]
  policy?: Partial<LlmPolicy>
  memory?: LlmMemoryScope
  /** 原用项目全局的 `DynamicValueMap`（`Record<string, any>`），SDK 侧改用 `Record<string, unknown>`。 */
  metadata?: Record<string, unknown>
}
