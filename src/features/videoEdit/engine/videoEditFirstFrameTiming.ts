import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.performance')
export interface VideoEditTimingContext { projectId: string; sequenceId: string; startedAt: number }
interface WindowTiming { context: VideoEditTimingContext; observer?: PerformanceObserver; timer: ReturnType<typeof setTimeout>; tasks: Array<{ at: number; durationMs: number }>; firstFrameAt?: number; publications: number; commits: number }
const windows = new Map<string, WindowTiming>()
const now = (): number => performance.timeOrigin + performance.now()

export function videoEditTimingEvent(context: VideoEditTimingContext, stage: string, details: Record<string, unknown> = {}): void {
  const data = { ...context, elapsedMs: now() - context.startedAt, ...details }
  const event = `video_edit.${stage}`
  performance.mark(event, { detail: data })
  performance.clearMarks(event)
  logger.info('剪辑画面阶段计时', { event, context: data })
}
function finish(projectId: string, reason: string): void {
  const value = windows.get(projectId)
  if (!value) return
  value.observer?.takeRecords().forEach(entry => value.tasks.push({ at: performance.timeOrigin + entry.startTime - value.context.startedAt, durationMs: entry.duration }))
  value.observer?.disconnect(); clearTimeout(value.timer); windows.delete(projectId)
  const afterFirst = value.firstFrameAt === undefined ? [] : value.tasks.filter(task => task.at + task.durationMs > value.firstFrameAt!)
  videoEditTimingEvent(value.context, 'program.window.completed', { reason, firstFrameMs: value.firstFrameAt, publications: value.publications, commits: value.commits, postFirstFrameLongTaskCount: afterFirst.length, postFirstFrameLongTaskMaxMs: Math.max(0, ...afterFirst.map(task => task.durationMs)), longTasks: value.tasks, longTaskCount: value.tasks.length, longTaskMaxMs: Math.max(0, ...value.tasks.map(task => task.durationMs)) })
}
export function beginVideoEditFirstFrame(projectId: string, sequenceId: string, reason: 'open' | 'switch'): void {
  finish(projectId, 'superseded')
  if (!sequenceId) return
  const context = { projectId, sequenceId, startedAt: now() }
  const value: WindowTiming = { context, tasks: [], publications: 0, commits: 0, timer: setTimeout(() => finish(projectId, 'timeout'), 30000) }
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    value.observer = new PerformanceObserver(list => list.getEntries().forEach(entry => value.tasks.push({ at: performance.timeOrigin + entry.startTime - context.startedAt, durationMs: entry.duration })))
    value.observer.observe({ type: 'longtask' })
  }
  windows.set(projectId, value)
  videoEditTimingEvent(context, 'program.first_frame.start', { reason })
}
export function videoEditTimingContext(projectId: string | undefined, sequenceId: string): VideoEditTimingContext | undefined {
  const context = projectId ? windows.get(projectId)?.context : undefined
  return context?.sequenceId === sequenceId ? context : undefined
}
export function recordVideoEditFirstFrame(projectId: string, sequenceId: string, details: Record<string, unknown>): void {
  const value = windows.get(projectId)
  if (!value || value.context.sequenceId !== sequenceId || value.firstFrameAt !== undefined) return
  value.firstFrameAt = now() - value.context.startedAt
  videoEditTimingEvent(value.context, 'program.first_frame', { ...details, presentation: 'gpu-completed' })
  clearTimeout(value.timer); value.timer = setTimeout(() => finish(projectId, 'presented'), 1000)
}
export function countVideoEditTiming(kind: 'publications' | 'commits'): void { for (const value of windows.values()) value[kind]++ }
export function endVideoEditTiming(projectId: string): void { finish(projectId, 'closed') }
