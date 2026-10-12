/** Source audio clock, milliseconds. An output index addresses the corresponding generated audio. */
export type SpeechTimings = {
  granularity: 'char' | 'word' | 'sentence'
  items: Array<{ text: string; startMs: number; endMs: number; confidence?: number }>
}
/** Stored in generation metadata.outputTimings; absent means the provider supplied no timestamps. */
export type GenerationOutputTimings = Array<{ outputIndex: number; timings: SpeechTimings }>
