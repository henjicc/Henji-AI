import { detectAudioEditRetakes, type AudioEditRetake, type AudioEditRetakeOptions } from '@/core/audioEdit/retakes'
import type { AudioEditTranscriptBlock } from '@/core/audioEdit/types'
import type { AudioEditRetakeRequest, AudioEditRetakeResponse } from './audioEditRetakes.worker'

/**
 * 重念检测放在 Worker 里跑：一小时口播的对齐计算约一秒，不占界面线程。每次检测用一个一次性 Worker，算完即释放。
 * 没有 Worker 的环境（单元测试）直接在当前线程计算，结果相同。
 */
export async function detectAudioEditRetakesOffThread(blocks: readonly AudioEditTranscriptBlock[], options: AudioEditRetakeOptions, signal?: AbortSignal): Promise<AudioEditRetake[]> {
  signal?.throwIfAborted()
  if (typeof Worker === 'undefined') return detectAudioEditRetakes(blocks, options)
  const worker = new Worker(new URL('./audioEditRetakes.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<AudioEditRetake[]>((resolve, reject) => {
      const abort = (): void => reject(signal?.reason ?? new Error('已取消'))
      signal?.addEventListener('abort', abort, { once: true })
      worker.onmessage = (event: MessageEvent<AudioEditRetakeResponse>) => {
        signal?.removeEventListener('abort', abort)
        if ('retakes' in event.data) resolve(event.data.retakes)
        else reject(new Error(event.data.error))
      }
      worker.onerror = (event) => { signal?.removeEventListener('abort', abort); reject(new Error(event.message || '重念检测失败')) }
      worker.postMessage({ blocks: [...blocks], options } satisfies AudioEditRetakeRequest)
    })
  } finally { worker.terminate() }
}
