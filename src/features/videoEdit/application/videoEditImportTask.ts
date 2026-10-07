import { listVideoEditInstances, publishVideoEdit, requireVideoEditInstance, subscribeVideoEdit, type VideoEditInstance } from './videoEditService'

export interface VideoEditImportProgress { phase: 'enumerating' | 'probing'; completed: number; total: number }
export interface VideoEditImportTask extends VideoEditImportProgress { controller: AbortController }
const tasks = new WeakMap<VideoEditInstance, VideoEditImportTask>()
export function videoEditImportTask(projectId: string): VideoEditImportTask | undefined { return tasks.get(requireVideoEditInstance(projectId)) }
export function cancelVideoEditImport(projectId: string): void { videoEditImportTask(projectId)?.controller.abort() }
export function reportVideoEditImport(task: VideoEditImportTask, progress: VideoEditImportProgress, callback?: (progress: VideoEditImportProgress) => void): void {
  Object.assign(task, progress); callback?.(progress); publishVideoEdit()
}
export async function withVideoEditImportTask<T>(projectId: string, signal: AbortSignal | undefined, operation: (task: VideoEditImportTask) => Promise<T>): Promise<T> {
  const owner = requireVideoEditInstance(projectId)
  if (tasks.has(owner)) throw new Error('素材正在导入，请等待完成或取消后重试。')
  const task: VideoEditImportTask = { phase: 'enumerating', completed: 0, total: 0, controller: new AbortController() }
  // Like proxy preparation, closing an owner cancels its task; a same-ID reopened document never receives late results.
  const unsubscribe = subscribeVideoEdit(() => { if (!listVideoEditInstances().includes(owner)) task.controller.abort(new Error('原剪辑已关闭，导入已取消。')) })
  const abort = (): void => task.controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true }); tasks.set(owner, task); publishVideoEdit()
  try { task.controller.signal.throwIfAborted(); return await operation(task) }
  finally { tasks.delete(owner); unsubscribe(); signal?.removeEventListener('abort', abort); publishVideoEdit() }
}
