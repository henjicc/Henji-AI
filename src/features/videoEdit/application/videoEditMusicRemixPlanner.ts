import { planMusicRemix, type MusicRemixPlan, type MusicRemixRequest } from '@/core/audioAnalysis/music/musicRemixPlan'
import type { MusicRemixWorkerResponse } from '@/core/audioAnalysis/music/musicRemixWorker'

/** 在 Worker 里求重构路径；没有 Worker 的环境（单元测试）直接调用同一个纯函数。 */
export async function planMusicRemixOffThread(request: MusicRemixRequest, signal?: AbortSignal): Promise<MusicRemixPlan> {
  signal?.throwIfAborted()
  if (typeof Worker === 'undefined') return planMusicRemix(request)
  const worker = new Worker(new URL('../../../core/audioAnalysis/music/musicRemixWorker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<MusicRemixPlan>((resolve, reject) => {
      const abort = (): void => reject(signal?.reason ?? new DOMException('已取消', 'AbortError'))
      signal?.addEventListener('abort', abort, { once: true })
      worker.onmessage = (event: MessageEvent<MusicRemixWorkerResponse>): void => { signal?.removeEventListener('abort', abort); if (event.data.kind === 'plan') resolve(event.data.plan); else reject(new Error(event.data.message)) }
      worker.onerror = event => { signal?.removeEventListener('abort', abort); reject(new Error(event.message || '重构路径计算失败。')) }
      worker.postMessage(request)
    })
  } finally { worker.terminate() }
}
