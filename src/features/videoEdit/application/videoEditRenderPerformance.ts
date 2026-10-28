import { z } from 'zod'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import { VIDEO_EDIT_RENDER_SAMPLE_LIMIT, videoEditRenderMeasurementSchema, videoEditRenderPerformance, type VideoEditRenderMeasurement, type VideoEditRenderPerformance } from '@/core/videoEdit/renderPerformance'

const logger = createLogger('features.videoEdit.renderCache')
// 与代码元数据缓存共用配置数据库；只是一份可重建的本机观测，不属于工程或用户设置。
// 样本按窗口指纹记，指纹已含渲染引擎版本：引擎一变旧样本不再命中，随条数与天数上限淘汰，键名里不带版本。
// 样本记的是“是否按时呈现”（.shown），与只记耗时的旧样本键不同，旧样本不参与判断。
const key = 'cache.video-edit.render-performance.shown'
/** 键名带渲染版本号时写下的旧样本（版本 1–6，带或不带 .shown）：用不上了，每次打开应用后首次读取时删一遍，不存在的键删了也无妨。 */
const LEGACY_KEYS = Array.from({ length: 6 }, (_, index) => [`cache.video-edit.render-performance.v${index + 1}`, `cache.video-edit.render-performance.v${index + 1}.shown`]).flat()
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
    // 清理失败不影响读取当前样本。
    void (async () => { await Promise.all(LEGACY_KEYS.map(legacy => getPlatform().settings.delete(legacy))) })()
      .catch(error => logger.warn('旧播放性能缓存未清理', { event: 'video_edit.render_cache.measurement_cleanup_failed', error }))
    try {
      const stored = await getPlatform().settings.get(key)
      if (!stored) return
      for (const [content, value] of cacheSchema.parse(JSON.parse(stored.value))) {
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
    try { await getPlatform().settings.set(key, value, 'json') }
    catch (error) { logger.warn('播放性能缓存保存失败，本次观测仍保留在内存', { event: 'video_edit.render_cache.measurement_save_failed', error }) }
  })
  return saving
}
