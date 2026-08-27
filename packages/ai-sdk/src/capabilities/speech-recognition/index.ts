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
  startMs?: number
  endMs?: number
  confidence?: number
}

export interface SpeechRecognitionSegment {
  text: string
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
  providerMetadata?: unknown
}

export type SpeechRecognitionEvent =
  | { type: 'started'; sessionId?: string }
  | { type: 'processing'; taskId: string; status: string }
  | { type: 'partial'; text: string; segment?: SpeechRecognitionSegment }
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
