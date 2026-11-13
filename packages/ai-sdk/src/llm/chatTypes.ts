import type { JsonObject, JsonValue } from '../types/runtime'
import type { LlmReasoningConfig } from './reasoning'
import type { LlmCapabilities, LlmStructuredOutputConfig } from './types'
import type { LlmApiProtocol } from './providerProtocolCore'

export type { JsonObject, JsonValue }

/**
 * 原生 SSE 流式聊天路径（`llm:chatStream`）的请求/响应 DTO。
 *
 * 任务 4.2 从 `electron/main/services/llm/types.ts` 迁入。文件名刻意不叫 `types.ts`——
 * 本目录（`packages/ai-sdk/src/llm/`）已有一个 4.1 迁入的 `types.ts`（模型目录/供应商预设
 * 相关的应用侧桥接类型），两者职责不同，同名会互相遮蔽或强迫合并，`chatTypes.ts` 与
 * `modelStep.ts`（同目录下 Vercel AI SDK 模型步类型）保持同样的"按路径命名"风格。
 */

export type LlmRole = 'system' | 'user' | 'assistant'

export interface LlmContentPart {
  type: string
  text?: string
  imageUrl?: JsonValue
  videoUrl?: JsonValue
  inputAudio?: JsonValue
  file?: JsonValue
}

export interface LlmChatMessageDto {
  role: LlmRole
  content?: string | LlmContentPart[] | null
  name?: string
}

export interface LlmChatRequestDto {
  requestId?: string
  providerId: string
  providerFamilyId?: string
  endpointProfile?: string
  credentialId?: string
  modelId: string
  adapter?: string
  /** 省略时用供应商预设与端点配置（含智谱等的区域端点）；传入则按自定义地址请求，协议路径由 SDK 拼接。 */
  baseUrl?: string
  /**
   * 请求协议。省略时按供应商预设的 responsesModelIds 与模型目录自动选择：
   * 已确认支持 Responses 的模型走 Responses，其余走 Chat Completions。显式传入则以它为准。
   */
  apiProtocol?: LlmApiProtocol
  reasoning?: LlmReasoningConfig
  messages: LlmChatMessageDto[]
  /**
   * 只对未登记的模型生效（自定义地址、手动添加的模型）。
   * 已登记的供应商与模型由 SDK 按内置目录与供应商预设推断，调用方传入的值被忽略。
   */
  capabilities?: Partial<LlmCapabilities>
  /** 0–2。模型声明固定采样、或该供应商思考时采样参数无效 / 报错时由 SDK 省略。 */
  temperature?: number
  /** 0–1，省略规则同 temperature。 */
  topP?: number
  /**
   * true 时按供应商与模型挂内置联网工具（由服务端执行搜索）；不支持的组合与结构化输出请求不挂。
   * 搜索按供应商的工具价格另行计费。
   */
  webSearch?: boolean
  structuredOutput?: LlmStructuredOutputConfig
  /** 正整数；不设置时不下发限制，由供应商或模型默认值决定。 */
  maxOutputTokens?: number
  tools?: JsonValue
  policy?: JsonObject
  memory?: JsonObject
  metadata?: JsonObject
}

export interface LlmTraceDto {
  providerId: string
  modelId: string
  startedAtMs: number
  elapsedMs: number
  inputChars: number
  outputChars: number
  /** 发出请求到第一个字的毫秒数（含思考内容） */
  firstTokenMs?: number | null
  /** 首字之后的输出 token 速度（个/秒） */
  outputTokensPerSecond?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
}

export type LlmStreamEventDto =
  | { type: 'Token'; data: string }
  | { type: 'ReasoningToken'; data: string }
  | { type: 'Done'; data: LlmTraceDto }
  | { type: 'Error'; data: string }

export type LlmStreamEmitter = (event: LlmStreamEventDto) => void

export interface LlmUsageDto {
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  totalTokens: number | null
}

export interface LlmStreamOutput {
  output: string
  reasoningOutput: string
  usage: LlmUsageDto | null
  finishReason: string | null
  /** 供应商明确因输出 token 上限结束时为 true。 */
  truncated: boolean
  toolCalls?: LlmStreamToolCall[]
}

export interface LlmStreamToolCall {
  index: number
  id: string
  type: string
  function: { name: string; arguments: string }
}
