import type { VideoEditReframeAnalysisRequest, VideoEditReframeAnalysisResult } from '../engine/videoEditReframeAnalysis'
export function analyzeVideoEditReframeOffThread(request: VideoEditReframeAnalysisRequest, signal?: AbortSignal): Promise<VideoEditReframeAnalysisResult> {
  signal?.throwIfAborted()
  const worker = new Worker(new URL('../engine/videoEditReframeWorker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const finish = (): void => { worker.terminate(); signal?.removeEventListener('abort', abort) }
    const abort = (): void => { finish(); reject(signal?.reason ?? new Error('自动重构已取消。')) }
    worker.onmessage = (event: MessageEvent<{ result: VideoEditReframeAnalysisResult } | { error: string }>): void => { finish(); if ('error' in event.data) reject(new Error(event.data.error)); else resolve(event.data.result) }
    worker.onerror = event => { finish(); reject(new Error(event.message)) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    try { worker.postMessage(request) } catch (error) { finish(); reject(error) }
  })
}
