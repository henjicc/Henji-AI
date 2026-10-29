import type { VideoEditScreenAttentionRequest, VideoEditScreenAttentionResult } from '../engine/videoEditScreenAttentionAnalysis'
import { toFetchableMediaUrl } from '@/services/imageSource'

/** 只在 Worker 的副本里转换为可 fetch 的 URL，文档继续保留原始路径。 */
export async function analyzeVideoEditScreenAttentionOffThread(request: VideoEditScreenAttentionRequest, signal: AbortSignal): Promise<VideoEditScreenAttentionResult> {
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
