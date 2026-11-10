import { z } from 'zod'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import { VIDEO_EDIT_RENDER_SAMPLE_LIMIT, videoEditRenderMeasurementSchema, videoEditRenderPerformance, type VideoEditRenderMeasurement, type VideoEditRenderPerformance } from '@/core/videoEdit/renderPerformance'

const logger = createLogger('features.videoEdit.renderCache')
// 与代码元数据缓存共用程序目录的剪辑派生记录；只是一份可重建的本机观测，不属于工程或用户设置。
// 样本按窗口指纹记，指纹已含渲染引擎版本：引擎一变旧样本不再命中，随条数与天数上限淘汰，记录键里不带版本。
/** 整份观测一条记录，键是固定字符串 `video-edit-render-performance` 的 SHA-256。 */
const key = 'f75ecfa9c17ede4bb0e77690f48d02a0d7a69d90ce59e46d57fc38d314e2d68c'
const MAX_SEGMENTS = 256
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const cacheSchema = z.array(z.tuple([z.string().max(200), videoEditRenderMeasurementSchema])).max(MAX_SEGMENTS)
const measurements = new Map<string, VideoEditRenderMeasurement>()
const summaries = new Map<string, VideoEditRenderPerformance>()
let loading: Promise<void> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let saving = Promise.resolve()
let dirty = false

export function loadVideoEditRenderPerformance(): Promise<void> {
  return loading ??= (async () => {
    try {
      const stored = await getPlatform().mediaCache.readVideoEditRecord(key)
      if (stored === null) return
      for (const [content, value] of cacheSchema.parse(JSON.parse(stored))) {
        if (Date.now() - value.updatedAt > MAX_AGE_MS || measurements.has(content)) continue
        measurements.set(content, value)
      }
    } catch (error) { logger.warn('播放性能缓存读取失败，将重新观测', { event: 'video_edit.render_cache.measurement_load_failed', error }) }
  })()
}

export function readVideoEditRenderPerformance(content: string): VideoEditRenderPerformance | undefined {
  const value = measurements.get(content)
  if (!value || Date.now() - value.updatedAt > MAX_AGE_MS) return undefined
  let summary = summaries.get(content)
  if (!summary) { summary = videoEditRenderPerformance(value); summaries.set(content, summary) }
  return summary
}

/** 记一帧观测：呈现的帧传渲染耗时，被播放时钟跳过的帧传 null。 */
export function recordVideoEditRenderPerformance(content: string, fps: number, elapsedMs: number | null): VideoEditRenderPerformance {
  let value = measurements.get(content)
  if (!value || value.fps !== fps || Date.now() - value.updatedAt > MAX_AGE_MS) value = { fps, updatedAt: Date.now(), samples: [] }
  value.samples.push(elapsedMs === null ? null : Math.round(elapsedMs * 100) / 100)
  if (value.samples.length > VIDEO_EDIT_RENDER_SAMPLE_LIMIT) value.samples.shift()
  value.updatedAt = Date.now()
  measurements.delete(content); measurements.set(content, value)
  summaries.delete(content)
  dirty = true
  while (measurements.size > MAX_SEGMENTS) {
    const oldest = measurements.keys().next().value!
    measurements.delete(oldest); summaries.delete(oldest)
  }
  // 不逐帧 I/O；定期快照且串行写入，停止/关闭节目时另有显式冲刷。
  timer ??= setTimeout(() => { void flushVideoEditRenderPerformance() }, 5000)
  return readVideoEditRenderPerformance(content)!
}

export async function flushVideoEditRenderPerformance(): Promise<void> {
  clearTimeout(timer); timer = undefined
  await loadVideoEditRenderPerformance()
  if (!dirty) return saving
  dirty = false
  const value = JSON.stringify([...measurements])
  saving = saving.then(async () => {
    try { await getPlatform().mediaCache.writeVideoEditRecord(key, value) }
    catch (error) { logger.warn('播放性能缓存保存失败，本次观测仍保留在内存', { event: 'video_edit.render_cache.measurement_save_failed', error }) }
  })
  return saving
}
