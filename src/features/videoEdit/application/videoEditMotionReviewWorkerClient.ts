import type { VideoEditMotionReviewRequest, VideoEditMotionReviewResponse, VideoEditMotionReviewResult } from '../engine/videoEditMotionReviewWorker'
import { codeTextFontGeneration, measureCodeText } from '../videoEditGlyphMetrics'

export async function analyzeVideoEditMotionStructure(request: VideoEditMotionReviewRequest, signal: AbortSignal): Promise<VideoEditMotionReviewResult> {
  signal.throwIfAborted()
  const fontGeneration = codeTextFontGeneration()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../engine/videoEditMotionReviewWorker.ts', import.meta.url), { type: 'module' })
    let settled = false
    const finish = (error?: unknown, result?: VideoEditMotionReviewResult): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
      worker.terminate()
      if (error !== undefined) reject(error)
      else resolve(result!)
    }
    const abort = (): void => { finish(signal.reason ?? new DOMException('运动结构分析已取消。', 'AbortError')) }
    worker.onmessage = (event: MessageEvent<VideoEditMotionReviewResponse>): void => {
      if (settled) return
      if (signal.aborted) { abort(); return }
      try {
        if (fontGeneration !== codeTextFontGeneration()) throw new Error('分析期间字体已改变，请重新查询。')
        if ('measureText' in event.data) {
          const { id, request: measurement } = event.data.measureText
          const layout = measureCodeText(measurement)
          if (fontGeneration !== codeTextFontGeneration()) throw new Error('分析期间字体已改变，请重新查询。')
          worker.postMessage({ measurement: { id, layout } }); return
        }
        if ('error' in event.data) finish(new Error(event.data.error))
        else finish(undefined, event.data.result)
      } catch (error) { finish(error) }
    }
    worker.onerror = event => finish(new Error(event.message || '运动结构分析失败。'))
    worker.onmessageerror = () => finish(new Error('运动结构分析结果传递失败。'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    try { worker.postMessage(request) } catch (error) { finish(error) }
  })
}
