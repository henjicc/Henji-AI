import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.performance')
export interface VideoEditTimingContext { projectId: string; sequenceId: string; startedAt: number }
interface WindowTiming {
  context: VideoEditTimingContext; observer?: PerformanceObserver; timer: ReturnType<typeof setTimeout>; tasks: Array<{ at: number; durationMs: number }>; firstFrameAt?: number; publications: number; commits: number
  /** 首帧之前各阶段的累计耗时（主线程与 Worker 两边上报的阶段计时）。 */
  stages: Record<string, number>
  /** 等首帧呈现后才启动的后台工作。 */
  waiters: Array<() => void>
  /** 首帧已知来不了（面板隐藏、窗口不可见、渲染失败），后台工作已放行；计时窗口照常等首帧或超时。 */
  waitReleased?: string
}
const windows = new Map<string, WindowTiming>()
const firstFrameListeners = new Set<() => void>()
const now = (): number => performance.timeOrigin + performance.now()

function noteStage(context: VideoEditTimingContext, stage: string, durationMs: unknown): void {
  const value = windows.get(context.projectId)
  if (!value || value.context.startedAt !== context.startedAt || value.firstFrameAt !== undefined || typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return
  value.stages[stage] = (value.stages[stage] ?? 0) + durationMs
}
export function videoEditTimingEvent(context: VideoEditTimingContext, stage: string, details: Record<string, unknown> = {}): void {
  const data = { ...context, elapsedMs: now() - context.startedAt, ...details }
  const event = `video_edit.${stage}`
  performance.mark(event, { detail: data })
  performance.clearMarks(event)
  logger.info('剪辑画面阶段计时', { event, context: data })
  noteStage(context, stage, details.durationMs)
}
/** Worker 的阶段计时经日志消息转到主线程，这里并进同一个首帧窗口。 */
export function noteVideoEditWorkerTiming(event: string, context: Record<string, unknown>): void {
  const { projectId, sequenceId, startedAt } = context
  if (!event.startsWith('video_edit.render.') || typeof projectId !== 'string' || typeof sequenceId !== 'string' || typeof startedAt !== 'number') return
  noteStage({ projectId, sequenceId, startedAt }, event.slice('video_edit.'.length), context.durationMs)
}
function release(waiters: Array<() => void>): void {
  for (const resolve of waiters) resolve()
  for (const listener of firstFrameListeners) listener()
}
/** 结束计时窗口；被新窗口取代时把等待者交给新窗口，其他情况（呈现、超时、关闭）放行等待者。 */
function finish(projectId: string, reason: string): Array<() => void> {
  const value = windows.get(projectId)
  if (!value) return []
  value.observer?.takeRecords().forEach(entry => value.tasks.push({ at: performance.timeOrigin + entry.startTime - value.context.startedAt, durationMs: entry.duration }))
  value.observer?.disconnect(); clearTimeout(value.timer); windows.delete(projectId)
  const afterFirst = value.firstFrameAt === undefined ? [] : value.tasks.filter(task => task.at + task.durationMs > value.firstFrameAt!)
  videoEditTimingEvent(value.context, 'program.window.completed', { reason, firstFrameMs: value.firstFrameAt, publications: value.publications, commits: value.commits, postFirstFrameLongTaskCount: afterFirst.length, postFirstFrameLongTaskMaxMs: Math.max(0, ...afterFirst.map(task => task.durationMs)), longTasks: value.tasks, longTaskCount: value.tasks.length, longTaskMaxMs: Math.max(0, ...value.tasks.map(task => task.durationMs)) })
  if (reason === 'superseded') return value.waiters
  release(value.waiters)
  return []
}
function watchVisibility(): void {
  if (visibilityWatched || typeof document === 'undefined') return
  visibilityWatched = true
  // 窗口最小化或切到后台时画面不刷新，首帧要等回到前台；后台任务不跟着干等。
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') for (const projectId of windows.keys()) releaseVideoEditFirstFrameWait(projectId, 'window-hidden') })
}
let visibilityWatched = false
export function beginVideoEditFirstFrame(projectId: string, sequenceId: string, reason: 'open' | 'switch'): void {
  const waiters = finish(projectId, 'superseded')
  if (!sequenceId) { release(waiters); return }
  const context = { projectId, sequenceId, startedAt: now() }
  const value: WindowTiming = { context, tasks: [], publications: 0, commits: 0, stages: {}, waiters, timer: setTimeout(() => finish(projectId, 'timeout'), 30000) }
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    value.observer = new PerformanceObserver(list => list.getEntries().forEach(entry => value.tasks.push({ at: performance.timeOrigin + entry.startTime - context.startedAt, durationMs: entry.duration })))
    value.observer.observe({ type: 'longtask' })
  }
  windows.set(projectId, value)
  for (const listener of firstFrameListeners) listener()
  videoEditTimingEvent(context, 'program.first_frame.start', { reason })
  watchVisibility()
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') releaseVideoEditFirstFrameWait(projectId, 'window-hidden')
}
export function videoEditTimingContext(projectId: string | undefined, sequenceId: string): VideoEditTimingContext | undefined {
  const context = projectId ? windows.get(projectId)?.context : undefined
  return context?.sequenceId === sequenceId ? context : undefined
}
const sum = (stages: Record<string, number>, keys: readonly string[]): number => keys.reduce((total, key) => total + (stages[key] ?? 0), 0)
/** 把首帧前的阶段归成几段，看清时间花在哪；各段可能并行，相加不等于总耗时。 */
function firstFramePhases(stages: Record<string, number>, details: Record<string, unknown>): Record<string, number> {
  const render = (details.renderStages ?? {}) as Record<string, number>
  const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0
  return {
    contentCheck: sum(stages, ['render.prepare.content', 'render.update.content']),
    fonts: sum(stages, ['render.prepare.fonts', 'render.update.fonts']),
    code: sum(stages, ['render.prepare.code', 'render.update.code']) + Object.entries(render).reduce((total, [key, value]) => /^(?:code|author)/.test(key) ? total + number(value) : total, 0),
    workerDocument: sum(stages, ['render.prepare.init', 'render.update.worker']),
    decoderSession: sum(stages, ['render.prepare.native_status', 'render.prepare.native_connect', 'render.native.openDecoder']),
    firstDecode: number(details.decodeMs),
    gpu: number(details.gpuMs) + sum(stages, ['render.compositor.device', 'render.compositor.pipelines']),
  }
}
export function recordVideoEditFirstFrame(projectId: string, sequenceId: string, details: Record<string, unknown>): void {
  const value = windows.get(projectId)
  if (!value || value.context.sequenceId !== sequenceId || value.firstFrameAt !== undefined) return
  value.firstFrameAt = now() - value.context.startedAt
  videoEditTimingEvent(value.context, 'program.first_frame', { ...details, presentation: 'gpu-completed', phases: firstFramePhases(value.stages, details), stages: value.stages })
  release(value.waiters); value.waiters = []
  clearTimeout(value.timer); value.timer = setTimeout(() => finish(projectId, 'presented'), 1000)
}
const waiting = (value: WindowTiming | undefined): boolean => !!value && value.firstFrameAt === undefined && value.waitReleased === undefined
/** 该工程正在等首帧：打开或切换序列后、画面上屏前，且没有已知原因让首帧来不了。 */
export function videoEditFirstFramePending(projectId: string): boolean { return waiting(windows.get(projectId)) }
/** 首帧已知来不了时立即放行后台任务（计时窗口不结束，首帧真来了照常记录）。 */
export function releaseVideoEditFirstFrameWait(projectId: string, reason: string): void {
  const value = windows.get(projectId)
  if (!waiting(value)) return
  value!.waitReleased = reason
  logger.info('首帧暂时出不来，先放行后台任务', { event: 'video_edit.program.first_frame.wait_released', context: { ...value!.context, reason } })
  release(value!.waiters); value!.waiters = []
}
/** 首帧上屏（或计时窗口因超时、关闭结束）后放行；参照 PR / 达芬奇先出画面、后台再建缓存。 */
export function whenVideoEditFirstFrame(projectId: string): Promise<void> {
  const value = windows.get(projectId)
  if (!waiting(value)) return Promise.resolve()
  return new Promise(resolve => value!.waiters.push(resolve))
}
export function subscribeVideoEditFirstFrame(listener: () => void): () => void { firstFrameListeners.add(listener); return () => { firstFrameListeners.delete(listener) } }
export function countVideoEditTiming(kind: 'publications' | 'commits'): void { for (const value of windows.values()) value[kind]++ }
export function endVideoEditTiming(projectId: string): void { finish(projectId, 'closed') }
