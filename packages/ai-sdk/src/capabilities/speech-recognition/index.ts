import type {
  CapabilityDescriptor,
  CapabilityModule,
  CapabilityRealtimeModule,
} from '../types'
import type { CapabilityMediaSource } from '../media'

export interface SpeechRecognitionInput {
  audio: CapabilityMediaSource
  language?: string
  hints?: readonly string[]
  punctuation?: boolean
  timestamps?: boolean
  options?: Readonly<Record<string, unknown>>
}

export interface SpeechRecognitionWord {
  text: string
  speakerId?: number
  startMs?: number
  endMs?: number
  confidence?: number
}

export interface SpeechRecognitionSegment {
  text: string
  speakerId?: number
  startMs?: number
  endMs?: number
  confidence?: number
  words?: readonly SpeechRecognitionWord[]
}

export interface SpeechRecognitionOutput {
  text: string
  language?: string
  durationMs?: number
  segments?: readonly SpeechRecognitionSegment[]
  /** 按 token 计费的模型返回的用量；按音频时长计费的模型不返回。 */
  usage?: { inputTokens?: number; outputTokens?: number }
  providerMetadata?: unknown
}

export type SpeechRecognitionEvent =
  | { type: 'started'; sessionId?: string }
  | { type: 'processing'; taskId: string; status: string }
  /**
   * 当前所有尚未定稿的文字，不含已经以 final 发出的部分；每条都替换上一条，`segment` 与 `text` 对应。
   * 同一批服务端结果里先发新的 final 再发 partial，所以调用方显示“已定稿 + 最新 partial”即可。
   */
  | { type: 'partial'; text: string; segment?: SpeechRecognitionSegment }
  /**
   * 刚定稿的那一句；调用方据此提交该句并清空当前未定稿文字，之后的 partial 只含后续内容。
   * 每句只发一次，供应商之后对已定稿句的修订只体现在 completed 的 `segments` 里。
   */
  | { type: 'final'; text: string; segment?: SpeechRecognitionSegment }
  | { type: 'completed'; output: SpeechRecognitionOutput }

export interface SpeechRecognitionRealtimeStart {
  mediaType: string
  sampleRateHz?: number
  channels?: number
  language?: string
  hints?: readonly string[]
  punctuation?: boolean
  options?: Readonly<Record<string, unknown>>
}

export interface SpeechRecognitionAudioChunk {
  bytes: Uint8Array
  timestampMs?: number
}

export type SpeechRecognitionModule = CapabilityModule<
  SpeechRecognitionInput,
  SpeechRecognitionOutput,
  SpeechRecognitionEvent
>

export type SpeechRecognitionRealtimeModule = CapabilityRealtimeModule<
  SpeechRecognitionRealtimeStart,
  SpeechRecognitionAudioChunk,
  SpeechRecognitionEvent,
  SpeechRecognitionOutput
>

export interface SpeechRecognitionDescriptorInput
  extends Omit<CapabilityDescriptor, 'kind' | 'contract' | 'operations' | 'executionModes'> {
  realtime?: boolean
  streaming?: boolean
  mediaTypes?: readonly string[]
  features?: readonly string[]
}

/** 建立可发现的 ASR 描述，不绑定百炼或任何具体协议。 */
export function defineSpeechRecognitionDescriptor(
  input: SpeechRecognitionDescriptorInput
): CapabilityDescriptor {
  const { realtime, streaming, mediaTypes, features = [], ...descriptor } = input
  const executionModes = realtime
    ? ['realtime' as const]
    : [streaming ? 'event-stream' as const : 'request-response' as const]
  return {
    ...descriptor,
    kind: 'speech-recognition',
    contract: {
      input: [{ kind: 'audio', required: true, mediaTypes }],
      output: [
        { kind: 'text', required: true },
        { kind: 'structured-data' },
      ],
    },
    operations: ['speech-recognition', 'speech-to-text'],
    executionModes,
    features: [...new Set([
      ...features,
      ...(realtime ? ['realtime'] : []),
      ...(streaming ? ['streaming'] : []),
    ])],
  }
}
