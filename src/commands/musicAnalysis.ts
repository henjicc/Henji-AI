import { getPlatform } from '@/platform'
import type { MusicAnalysisProgress, MusicAnalysisResponse } from '@/platform/contracts/musicAnalysis'

/*
 * 音乐结构分析：解码、节拍模型推理与缓存都在主进程与本地推理后台进程完成；渲染层只发起、取消与订阅进度。
 */

/** 分析一个本机音频文件；signal 取消时同时取消主进程任务。 */
export async function analyzeMusicStructure(source: string, signal?: AbortSignal, onProgress?: (event: MusicAnalysisProgress) => void): Promise<MusicAnalysisResponse> {
  signal?.throwIfAborted()
  const platform = getPlatform().musicAnalysis
  const requestId = crypto.randomUUID()
  const unsubscribe = onProgress ? platform.onProgress(event => { if (event.requestId === requestId) onProgress(event) }) : () => undefined
  const abort = (): void => { void platform.cancel(requestId).catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const result = await platform.analyze({ requestId, source })
    signal?.throwIfAborted()
    return result
  } finally { signal?.removeEventListener('abort', abort); unsubscribe() }
}
