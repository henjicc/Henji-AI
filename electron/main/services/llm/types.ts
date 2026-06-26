import type { JsonObject, JsonValue } from '../ai-runtime/types'

export type { JsonObject, JsonValue }

export type LlmRole = 'system' | 'user' | 'assistant'

export interface LlmContentPart {
  type: string
  text?: string
  imageUrl?: JsonValue
  videoUrl?: JsonValue
  inputAudio?: JsonValue
}

export interface LlmChatMessage {
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
  reasoning?: boolean
  messages: LlmChatMessage[]
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

export interface LlmStreamOutput {
  output: string
  reasoningOutput: string
}
