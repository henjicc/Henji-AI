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
  /** Local upload guard. Defaults to the documented 25 MB attachment limit; larger files require a remote URL, even on paid plans. */
  maxFileBytes?: number
}
