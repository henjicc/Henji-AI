import { vi } from 'vitest'
import { buildSpeechSubtitles } from '@/core/videoEdit/speechSubtitles'
import type { SpeechSubtitleWorkerRequest, SpeechSubtitleWorkerResponse } from '@/features/videoEdit/engine/videoEditSpeechSubtitleWorker'

/** Control only the thread boundary; execute the real alignment and cue builder. */
export class SpeechSubtitleTestWorker {
  static instances: SpeechSubtitleTestWorker[] = []
  static autoRun = false
  requests: SpeechSubtitleWorkerRequest[] = []
  onmessage: ((event: MessageEvent<SpeechSubtitleWorkerResponse>) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  constructor() { SpeechSubtitleTestWorker.instances.push(this) }
  postMessage(request: SpeechSubtitleWorkerRequest): void {
    this.requests.push(structuredClone(request))
    if (SpeechSubtitleTestWorker.autoRun) void this.respond()
  }
  async respond(): Promise<void> {
    const { original, timings, clip, rate, options, pauses, textScope } = this.requests[0]
    try {
      const result = await buildSpeechSubtitles(original, timings, clip, rate, options, undefined, pauses, textScope)
      this.onmessage?.({ data: { result } } as MessageEvent<SpeechSubtitleWorkerResponse>)
    } catch (error) {
      this.onmessage?.({ data: { error: error instanceof Error ? error.message : '字幕对齐失败' } } as MessageEvent<SpeechSubtitleWorkerResponse>)
    }
  }
}
