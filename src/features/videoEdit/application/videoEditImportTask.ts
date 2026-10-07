import { createLogger } from '@/core/logging'
import { listVideoEditInstances, requireVideoEditInstance, subscribeVideoEdit, type VideoEditInstance } from './videoEditService'

export interface VideoEditImportProgress { phase: 'enumerating' | 'probing'; completed: number; total: number; totalKnown?: boolean; discovered?: number }
export interface VideoEditImportTask extends VideoEditImportProgress { controller: AbortController; queued: number; requests: number; imported: number; skipped: number }
interface Request { task: VideoEditImportTask; ready: Promise<void>; run: () => Promise<() => void>; pending: boolean; cleanup?: () => void | Promise<void>; reject: (error: unknown) => void }
interface Queue { owner: VideoEditInstance; task: VideoEditImportTask; requests: Request[]; running: boolean; failed: boolean; dispose: () => void }
const tasks = new WeakMap<VideoEditInstance, Queue>()
const requestQueues = new WeakMap<VideoEditImportTask, Queue>()
const completedListeners = new Set<(projectId: string, imported: number, skipped: number) => void>()
const progressListeners = new Set<() => void>()
let progressRevision = 0
export function subscribeVideoEditImport(listener: () => void): () => void { progressListeners.add(listener); return () => { progressListeners.delete(listener) } }
export function videoEditImportRevision(): number { return progressRevision }
function publishProgress(): void { progressRevision++; for (const listener of progressListeners) listener() }
const logger = createLogger('features.videoEdit.importQueue')
export function subscribeVideoEditImportCompletion(listener: (projectId: string, imported: number, skipped: number) => void): () => void { completedListeners.add(listener); return () => { completedListeners.delete(listener) } }
export function videoEditImportTask(projectId: string): VideoEditImportTask | undefined { return tasks.get(requireVideoEditInstance(projectId))?.task }
export function cancelVideoEditImport(projectId: string): void { videoEditImportTask(projectId)?.controller.abort(); publishProgress() }
function publish(queue: Queue): void {
  const values = queue.requests.map(request => request.task)
  const totalKnown = values.every(task => task.totalKnown)
  Object.assign(queue.task, {
    phase: totalKnown ? 'probing' : 'enumerating', totalKnown,
    completed: values.reduce((sum, task) => sum + task.completed, 0), total: values.reduce((sum, task) => sum + task.total, 0),
    discovered: values.reduce((sum, task) => sum + (task.discovered ?? task.total), 0),
    queued: queue.requests.filter(request => request.pending).length, requests: values.length,
    imported: values.reduce((sum, task) => sum + task.imported, 0), skipped: values.reduce((sum, task) => sum + task.skipped, 0),
  })
  publishProgress()
}
export function reportVideoEditImport(task: VideoEditImportTask, progress: VideoEditImportProgress, callback?: (progress: VideoEditImportProgress) => void): void {
  Object.assign(task, progress)
  const queue = requestQueues.get(task)
  if (queue) { publish(queue); callback?.({ ...queue.task }) }
  else { callback?.(progress); publishProgress() }
}
async function drain(queue: Queue): Promise<void> {
  if (queue.running) return
  queue.running = true
  const finishers: Array<() => void> = []
  try {
    let next = 0
    const cleaned = new Set<Request>()
    while (next < queue.requests.length) {
      while (next < queue.requests.length) {
        const request = queue.requests[next++]
        request.pending = false; publish(queue)
        finishers.push(await request.run())
      }
      for (let index = queue.requests.length - 1; index >= 0; index--) {
        const request = queue.requests[index]
        if (request.pending || cleaned.has(request)) continue
        cleaned.add(request)
        try { await request.cleanup?.() } catch (error) {
          queue.failed = true; finishers[index] = () => request.reject(error)
          logger.warn('清理空素材箱失败', { event: 'video_edit.media.queue.cleanup_failed', error, context: { projectId: queue.owner.document.id } })
        }
      }
    }
  } finally {
    publish(queue)
    tasks.delete(queue.owner); queue.dispose(); publishProgress()
    logger.info('素材导入队列结束', { event: 'video_edit.media.queue.completed', context: { projectId: queue.owner.document.id, requests: queue.task.requests, imported: queue.task.imported, skipped: queue.task.skipped, cancelled: queue.task.controller.signal.aborted } })
    try {
      if (!queue.failed && !queue.task.controller.signal.aborted && listVideoEditInstances().includes(queue.owner)) for (const listener of completedListeners) listener(queue.owner.document.id, queue.task.imported, queue.task.skipped)
    } finally { for (const finish of finishers) finish() }
  }
}
export function withVideoEditImportTask<T>(projectId: string, signal: AbortSignal | undefined, operation: (task: VideoEditImportTask) => Promise<T>, options: { total?: number; prepare?: (task: VideoEditImportTask) => Promise<void>; cleanup?: () => void | Promise<void> } = {}): Promise<T> {
  const owner = requireVideoEditInstance(projectId)
  let queue = tasks.get(owner)
  if (!queue) {
    const task: VideoEditImportTask = { phase: 'enumerating', completed: 0, total: 0, discovered: 0, totalKnown: false, queued: 0, requests: 0, imported: 0, skipped: 0, controller: new AbortController() }
    const unsubscribe = subscribeVideoEdit(() => { if (!listVideoEditInstances().includes(owner)) task.controller.abort(new Error('原剪辑已关闭，导入已取消。')) })
    queue = { owner, task, requests: [], running: false, failed: false, dispose: unsubscribe }; tasks.set(owner, queue)
    logger.info('素材导入队列开始', { event: 'video_edit.media.queue.start', context: { projectId } })
  }
  const current = queue
  const abort = (): void => current.task.controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  const task = { ...current.task, completed: 0, total: options.total ?? 0, discovered: options.total ?? 0, totalKnown: options.total !== undefined, imported: 0, skipped: 0 }
  requestQueues.set(task, current)
  return new Promise<T>((resolve, reject) => {
    const request: Request = { task, pending: true, ready: Promise.resolve(), cleanup: options.cleanup, reject, run: async () => {
      try { await request.ready; task.controller.signal.throwIfAborted(); const result = await operation(task); return () => resolve(result) }
      catch (error) { current.failed = true; logger.debug('素材导入请求未完成', { event: 'video_edit.media.queue.failed', error, context: { projectId, cancelled: task.controller.signal.aborted } }); return () => reject(error) }
      finally { signal?.removeEventListener('abort', abort) }
    } }
    current.requests.push(request); publish(current)
    // Enumeration and immediate bin creation also run for waiting requests. Probing remains FIFO.
    request.ready = Promise.resolve().then(() => { task.controller.signal.throwIfAborted(); return options.prepare?.(task) })
    void request.ready.catch(() => undefined)
    void Promise.resolve().then(() => drain(current))
  })
}
