import type { JsonObject, JsonValue } from '../types/runtime'
import type { LlmReasoningConfig } from './reasoning'

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
}

export interface LlmChatMessageDto {
  role: LlmRole
  content?: string | LlmContentPart[] | null
  name?: string
}

export interface LlmChatRequestDto {
  requestId?: string
  providerId: string
  modelId: string
  adapter?: string
  baseUrl?: string
  reasoning?: LlmReasoningConfig
  messages: LlmChatMessageDto[]
  capabilities?: JsonObject
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
}
