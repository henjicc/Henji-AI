import { createLogger } from '@/core/logging'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import { videoEditComposition, videoEditDuration, type VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditExportSettingsSchema, type VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import { getPlatform } from '@/platform/runtime'
import { exportVideoEdit, videoEditExportTask, type VideoEditExportTask } from './videoEditExport'
import { videoEditExportPresetLibrary } from './videoEditExportPresets'
import { holdVideoEditActivity, listVideoEditInstances, publishVideoEdit, requireVideoEditInstance, saveVideoEdit, videoEditExportRange, type VideoEditInstance } from './videoEditService'
import { sameVideoEditMediaPath } from './videoEditMedia'

const logger = createLogger('features.videoEdit.exportQueue')
export interface VideoEditExportRequest { projectId: string; sequenceId?: string; presetId?: string; settings?: VideoEditExportSettings; range?: { startFrame: number; endFrame: number }; path?: string }
export interface VideoEditExportJob {
  id: string; owner: VideoEditInstance; name: string; presetName: string; snapshot: VideoEditComposition; settings: VideoEditExportSettings
  range: { startFrame: number; endFrame: number }; path: string
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; error?: string; task?: VideoEditExportTask
  controller: AbortController; release: () => void
}
export class VideoEditExportQueue {
  private jobs: VideoEditExportJob[] = []
  private draining = false
  private revision = 0
  private listeners = new Set<() => void>()
  constructor(private run: (job: VideoEditExportJob) => Promise<void>) {}
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  version = (): number => this.revision
  list(): readonly VideoEditExportJob[] { return this.jobs }
  private publish(): void { this.revision++; for (const listener of this.listeners) listener(); publishVideoEdit() }
  append(jobs: VideoEditExportJob[]): void {
    if (this.jobs.length + jobs.length > 128) throw new Error('导出列表最多保留 128 项，请清除已结束项后再加入。')
    this.jobs.push(...jobs); this.publish(); void this.drain()
  }
  pending(projectId?: string): boolean { return this.jobs.some(job => (!projectId || job.owner.document.id === projectId) && ['queued', 'running'].includes(job.state)) }
  clearFinished(): void { this.jobs = this.jobs.filter(job => ['queued', 'running'].includes(job.state)); this.publish() }
  cancel(id: string): void {
    const job = this.require(id)
    if (!['queued', 'running'].includes(job.state)) return
    job.controller.abort(); job.task?.controller.abort()
    if (job.state === 'queued') { job.state = 'cancelled'; job.release() }
    logger.info('取消导出项', { event: 'video_edit.export_queue.cancelled', context: { jobId: id } }); this.publish()
  }
  retry(id: string, release: () => void): void {
    const job = this.require(id)
    if (job.state !== 'failed' || job.task?.state === 'completed') throw new Error('只可重试未发布文件的失败项；已保存的成片请直接使用文件。')
    job.controller = new AbortController(); job.release = release; job.task = undefined; job.error = undefined; job.state = 'queued'
    // Explicit retries join the tail, preserving the order of already submitted work.
    this.jobs = [...this.jobs.filter(value => value !== job), job]; this.publish(); void this.drain()
  }
  require(id: string): VideoEditExportJob { const job = this.jobs.find(value => value.id === id); if (!job) throw new Error('原导出项已移除，请重新查询导出列表。'); return job }
  async wait(id: string, signal?: AbortSignal): Promise<VideoEditExportJob> {
    signal?.throwIfAborted()
    const terminal = (): boolean => !['queued', 'running'].includes(this.require(id).state)
    if (terminal()) return this.require(id)
    return new Promise((resolve, reject) => {
      const cleanup = (): void => { stop(); signal?.removeEventListener('abort', aborted) }
      const aborted = (): void => { cleanup(); reject(signal?.reason ?? new Error('已停止等待。')) }
      const stop = this.subscribe(() => { if (terminal()) { cleanup(); resolve(this.require(id)) } })
      signal?.addEventListener('abort', aborted, { once: true })
    })
  }
  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      let job: VideoEditExportJob | undefined
      while ((job = this.jobs.find(value => value.state === 'queued'))) {
        const current = job; current.state = 'running'; this.publish()
        logger.info('开始队列导出', { event: 'video_edit.export_queue.start', context: { jobId: current.id, projectId: current.owner.document.id } })
        try {
          await this.run(current)
          current.state = current.task?.state === 'cancelled' || current.controller.signal.aborted && current.task?.state !== 'completed' ? 'cancelled' : 'completed'
          logger.info('队列导出结束', { event: 'video_edit.export_queue.completed', context: { jobId: current.id, state: current.state } })
        } catch (error) {
          current.state = current.controller.signal.aborted && current.task?.state !== 'completed' ? 'cancelled' : 'failed'
          current.error = error instanceof Error ? error.message : '导出失败，请重试。'
          logger.error('队列导出失败', { event: 'video_edit.export_queue.failed', error, context: { jobId: current.id } })
        } finally { current.release(); this.publish() }
      }
    } finally { this.draining = false }
  }
}
export const videoEditExportQueue = new VideoEditExportQueue(async job => {
  job.controller.signal.throwIfAborted()
  if (!listVideoEditInstances().includes(job.owner)) throw new Error('原剪辑已关闭，请重新加入导出。')
  const result = await exportVideoEdit(job.owner.document.id, job.path, false, job.controller.signal, job.settings.loudness ?? undefined, {
    snapshot: job.snapshot, range: job.range, settings: job.settings, signal: job.controller.signal, onTask: task => { job.task = task },
  })
  if (!result && !job.controller.signal.aborted && job.task?.state !== 'cancelled') throw new Error('导出未生成文件，请重试。')
})
/** Validate the whole batch and obtain local paths before committing any item. */
export async function enqueueVideoEditExports(requests: readonly VideoEditExportRequest[], signal?: AbortSignal): Promise<VideoEditExportJob[]> {
  assertApplicationWritesAllowed(); signal?.throwIfAborted()
  if (!requests.length || requests.length > 32 || videoEditExportQueue.list().length + requests.length > 128) throw new Error('每次请加入 1–32 项，导出列表最多 128 项。')
  const releases: Array<() => void> = []
  try {
    const jobs = requests.map(request => {
      const owner = requireVideoEditInstance(request.projectId)
      const sequenceId = request.sequenceId ?? owner.activeSequenceId
      const snapshot = structuredClone(videoEditComposition(owner.document, sequenceId))
      const preset = request.presetId ? videoEditExportPresetLibrary.list().find(value => value.id === request.presetId) : undefined
      if (request.presetId && !preset) throw new Error('原预设不存在，请从 video_edit.export_preset 目录重新选择。')
      const settings = videoEditExportSettingsSchema.parse(request.settings ?? preset?.settings ?? { format: 'mp4', width: snapshot.width, height: snapshot.height, fps: null, videoBitrateMbps: 8, audioBitrateKbps: 192, fit: 'fit', loudness: null })
      if (settings.keepSequenceSize) { settings.width = snapshot.width; settings.height = snapshot.height; videoEditExportSettingsSchema.parse(settings) }
      const range = { ...(request.range ?? videoEditExportRange(owner, sequenceId)) }
      if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) || range.startFrame < 0 || range.endFrame <= range.startFrame || range.endFrame > videoEditDuration(snapshot)) throw new Error('导出范围必须是序列内有效的整数帧入出点（出点不包含）。')
      const release = holdVideoEditActivity(request.projectId, 'export'); releases.push(release)
      return { id: crypto.randomUUID(), owner, name: snapshot.name, presetName: preset?.name ?? '自定义导出', snapshot, settings, range, path: request.path ?? '', state: 'queued' as const, controller: new AbortController(), release }
    })
    const platform = getPlatform()
    for (const job of jobs) {
      signal?.throwIfAborted()
      if (!job.path) {
        const path = await platform.system.dialog.save({ defaultPath: `${job.name} - ${job.presetName.replace(/[\\/:*?"<>|]/g, '-')}.${job.settings.format}`, filters: [{ name: job.settings.format.toUpperCase(), extensions: [job.settings.format] }] })
        if (!path) { for (const release of releases) release(); return [] }
        job.path = path
      }
      if (!job.path.toLowerCase().endsWith(`.${job.settings.format}`)) throw new Error(`输出文件需要 .${job.settings.format} 扩展名。`)
      if (await platform.system.fs.exists(job.path)) throw new Error('请选择新的文件名导出，避免覆盖已有文件。')
      if (videoEditExportQueue.list().some(value => ['queued', 'running'].includes(value.state) && sameVideoEditMediaPath(value.path, job.path)) || jobs.some(other => other !== job && other.path && sameVideoEditMediaPath(other.path, job.path))) throw new Error('多个导出不能使用同一个输出文件，请选择不同文件名。')
    }
    for (const owner of new Set(jobs.map(job => job.owner))) await saveVideoEdit(owner.document.id)
    signal?.throwIfAborted()
    if (jobs.some(job => !listVideoEditInstances().includes(job.owner))) throw new Error('原剪辑已关闭，未加入导出。')
    assertApplicationWritesAllowed()
    if (jobs.some(job => videoEditExportQueue.list().some(value => ['queued', 'running'].includes(value.state) && sameVideoEditMediaPath(value.path, job.path)))) throw new Error('输出位置已被另一个导出占用，请选择不同文件名。')
    videoEditExportQueue.append(jobs); return jobs
  } catch (error) { for (const release of releases) release(); throw error }
}
export function retryVideoEditExportJob(id: string): void {
  assertApplicationWritesAllowed()
  const job = videoEditExportQueue.require(id)
  if (!listVideoEditInstances().includes(job.owner)) throw new Error('原剪辑已关闭，请重新加入导出。')
  const release = holdVideoEditActivity(job.owner.document.id, 'export')
  try { videoEditExportQueue.retry(id, release) } catch (error) { release(); throw error }
}
export function videoEditQueuedExportTask(projectId: string, id: string): VideoEditExportTask | undefined {
  const owner = requireVideoEditInstance(projectId)
  return videoEditExportQueue.list().find(job => job.owner === owner && (job.id === id || job.task?.id === id))?.task ?? (videoEditExportTask(projectId)?.id === id ? videoEditExportTask(projectId) : undefined)
}
registerApplicationCloseGuard(async () => { if (videoEditExportQueue.pending()) throw new Error('仍有待导出的项目，请等待完成或在导出列表取消后再关闭。') })
