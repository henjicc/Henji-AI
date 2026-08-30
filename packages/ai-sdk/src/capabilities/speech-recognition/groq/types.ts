export type GroqTranscriptionResponseFormat = 'json' | 'text' | 'verbose_json'
export type GroqTimestampGranularity = 'segment' | 'word'

export interface GroqAsrOptions {
  prompt?: string
  responseFormat?: GroqTranscriptionResponseFormat
  temperature?: number
  timestampGranularities?: readonly GroqTimestampGranularity[]
}

export interface GroqAsrModuleOptions {
  /** Groq OpenAI-compatible API root. */
  apiBaseUrl?: string
  /** Local upload guard. Defaults to the Free plan's documented 25 MB limit; paid hosts may raise it explicitly. */
  maxFileBytes?: number
}
