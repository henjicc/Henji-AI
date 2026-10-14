import type { VideoEditScreenAttentionRequest, VideoEditScreenAttentionResult } from '../engine/videoEditScreenAttentionAnalysis'
import { getPlatform } from '@/platform/runtime'
import { toFetchableMediaUrl } from '@/services/imageSource'

/** Authorize original local page paths once at this Worker boundary, then convert only the Worker copy. */
export async function analyzeVideoEditScreenAttentionOffThread(request: VideoEditScreenAttentionRequest, signal: AbortSignal): Promise<VideoEditScreenAttentionResult> {
  const directories = new Set<string>()
  for (const media of request.composition.media) for (const page of media.recordingCursor?.pages ?? []) {
    signal.throwIfAborted()
    const normalized = page.path.replace(/\\/g, '/')
    const key = normalized.slice(0, normalized.lastIndexOf('/'))
    if (!directories.has(key)) {
      await getPlatform().media.allowRoot(await getPlatform().system.paths.dirname(page.path)); directories.add(key)
    }
  }
  signal.throwIfAborted()
  const composition = { ...request.composition, media: request.composition.media.map(media => ({ ...media, ...(media.recordingCursor ? { recordingCursor: { ...media.recordingCursor, pages: media.recordingCursor.pages.map(page => ({ ...page, path: toFetchableMediaUrl(page.path) })) } } : {}) })) }
  const worker = new Worker(new URL('../engine/videoEditScreenAttentionWorker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const finish = (): void => { worker.terminate(); signal.removeEventListener('abort', abort) }
    const abort = (): void => { finish(); reject(signal.reason ?? new Error('注意力推近已取消。')) }
    worker.onmessage = (event: MessageEvent<{ result: VideoEditScreenAttentionResult } | { error: string }>): void => { finish(); if ('error' in event.data) reject(new Error(event.data.error)); else resolve(event.data.result) }
    worker.onerror = event => { finish(); reject(new Error(event.message)) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    try { worker.postMessage({ ...request, composition }) } catch (error) { finish(); reject(error) }
  })
}
