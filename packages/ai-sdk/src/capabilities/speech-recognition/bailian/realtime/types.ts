export type BailianRealtimeAsrProtocol = 'fun-duplex' | 'qwen-realtime'

export interface BailianRealtimeAsrOptions {
  format?: 'pcm' | 'wav' | 'mp3' | 'opus' | 'speex' | 'aac' | 'amr'
  maxSentenceSilenceMs?: number
  vocabularyId?: string
  semanticPunctuationEnabled?: boolean
  multiThresholdModeEnabled?: boolean
  heartbeat?: boolean
  speechNoiseThreshold?: number
  turnDetection?: 'server_vad' | 'manual'
  vadThreshold?: number
  vadSilenceDurationMs?: number
}

export interface BailianRealtimeModuleOptions {
  funWebSocketUrl?: string
  qwenWebSocketUrl?: string
  /** Fun-ASR 要求 UUID task_id；宿主需要强随机标识时可注入自己的生成器。 */
  taskIdFactory?(requestId: string): string
}
