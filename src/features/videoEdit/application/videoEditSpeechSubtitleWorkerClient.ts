import { buildSpeechSubtitles, type SpeechSubtitle } from '@/core/videoEdit/speechSubtitles'
import type { SpeechSubtitleWorkerRequest, SpeechSubtitleWorkerResponse } from '../engine/videoEditSpeechSubtitleWorker'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.speechSubtitles')

/** Both original-subtitle generation and re-segmentation use the same CPU kernel. */
export async function buildVideoEditSpeechSubtitles(...args: Parameters<typeof buildSpeechSubtitles>): Promise<SpeechSubtitle[]> {
  const [original, timings, clip, rate, options, signal, pauses, textScope] = args
  signal?.throwIfAborted()
  // Bound the inline worst-case comparisons, rather than allowing long equal-length
  // but unrelated scripts to block the UI. Small cues avoid Worker startup overhead.
  const recognizedLength = timings.items.reduce((count, item) => count + item.text.length, 0)
  if (original.length + recognizedLength <= 8192 && original.length * recognizedLength <= 262144) return buildSpeechSubtitles(...args)
  const started = performance.now()
  logger.info('开始对齐原文字幕', { event: 'video_edit.speech_alignment.start', context: { characters: original.length, recognizedCharacters: recognizedLength } })
  try {
    const result = await new Promise<SpeechSubtitle[]>((resolve, reject) => {
      const target = new Worker(new URL('../engine/videoEditSpeechSubtitleWorker.ts', import.meta.url), { type: 'module' })
      let settled = false
      const finish = (error?: unknown, result?: SpeechSubtitle[]): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        target.onmessage = null; target.onerror = null; target.onmessageerror = null
        target.terminate()
        if (error !== undefined) reject(error)
        else resolve(result!)
      }
      const abort = (): void => { finish(signal?.reason ?? new DOMException('原文字幕对齐已取消。', 'AbortError')) }
      target.onmessage = (event: MessageEvent<SpeechSubtitleWorkerResponse>): void => {
        if (signal?.aborted) { abort(); return }
        if ('error' in event.data) finish(new Error(event.data.error))
        else finish(undefined, event.data.result)
      }
      target.onerror = event => finish(new Error(event.message || '原文字幕对齐失败，请重试。'))
      target.onmessageerror = () => finish(new Error('原文字幕结果传递失败，请重试。'))
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) { abort(); return }
      try { target.postMessage({ original, timings, clip, rate, options, pauses, textScope } satisfies SpeechSubtitleWorkerRequest) }
      catch (error) { finish(error) }
    })
    signal?.throwIfAborted()
    logger.info('原文字幕对齐完成', { event: 'video_edit.speech_alignment.completed', context: { durationMs: performance.now() - started, count: result.length } })
    return result
  } catch (error) {
    if (signal?.aborted) logger.info('原文字幕对齐已取消', { event: 'video_edit.speech_alignment.cancelled' })
    else logger.error('原文字幕对齐失败', error, { event: 'video_edit.speech_alignment.failed' })
    throw error
  }
}
