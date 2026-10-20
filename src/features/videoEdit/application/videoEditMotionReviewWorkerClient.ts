import type { CodeAuthorFrameObservation } from '@/core/videoEdit/codeAuthorProgram'
import type { CodeMotionObserver } from '@/core/videoEdit/codeMotionReview'
import type { VideoEditMotionReviewRequest, VideoEditMotionReviewResponse, VideoEditMotionReviewResult } from '../engine/videoEditMotionReviewWorker'
import { codeTextFontGeneration } from '../videoEditGlyphMetrics'

export async function analyzeVideoEditMotionStructure(request: VideoEditMotionReviewRequest, signal: AbortSignal, observe?: CodeMotionObserver): Promise<VideoEditMotionReviewResult> {
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
    worker.onmessage = async (event: MessageEvent<VideoEditMotionReviewResponse>): Promise<void> => {
      if (settled) return
      if (signal.aborted) { abort(); return }
      try {
        if (fontGeneration !== codeTextFontGeneration()) throw new Error('分析期间字体已改变，请重新查询。')
        if ('observeFrame' in event.data) {
          const { id, composition, frame } = event.data.observeFrame
          if (!observe) throw new Error('运动检查缺少正式渲染观察入口。')
          const observed: CodeAuthorFrameObservation = await observe(composition, frame)
          if (settled) return
          if (fontGeneration !== codeTextFontGeneration()) throw new Error('分析期间字体已改变，请重新查询。')
          if (!observed) throw new Error('渲染会话没有返回作者图层观察。')
          if (observed.sequenceId !== composition.id || observed.revision !== composition.revision || observed.frame !== frame) throw new Error('运动观察对应的画面已改变，请重试。')
          worker.postMessage({ observation: { id, value: observed } }); return
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
