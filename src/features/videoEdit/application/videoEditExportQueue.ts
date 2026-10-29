import { z } from 'zod'
import { createLogger } from '@/core/logging'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import { videoEditComposition, videoEditDuration, type VideoEditComposition } from '@/core/videoEdit/document'
import { resolveVideoEditExportSettings, videoEditSequenceExportSettings, videoEditExportPaths, VIDEO_EDIT_DEFAULT_EXPORT_PRESET_ID, videoEditExportSettingsSchema, type VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import { getPlatform } from '@/platform/runtime'
import type { VideoEditExportJobRecord } from '@/platform/contracts/videoEditExport'
import { exportVideoEdit, videoEditExportTask, type VideoEditExportTask } from './videoEditExport'
import { videoEditExportPresetLibrary } from './videoEditExportPresets'
import { discardVideoEditExportLeftovers, registerVideoEditExportJobs, removeVideoEditExportJobs, restoreVideoEditExportRecords, syncVideoEditExportJob, videoEditExportOutputs, type VideoEditExportNotRetainedReason } from './videoEditExportRegistry'
import { holdVideoEditActivity, listVideoEditInstances, publishVideoEdit, requireVideoEditInstance, saveVideoEdit, subscribeVideoEdit, videoEditDocumentOperations, videoEditExportRange, type VideoEditInstance } from './videoEditService'
import { videoEditMediaPathKey } from './videoEditMedia'
import { adaptVideoEditExportPreset, assertVideoEditExportSupported } from '../engine/videoEditExportEncoder'

const logger = createLogger('features.videoEdit.exportQueue')
export interface VideoEditExportRequest { projectId: string; sequenceId?: string; presetId?: string; settings?: VideoEditExportSettings; loudnessRequested?: boolean; range?: { startFrame: number; endFrame: number }; path?: string; fileName?: string
  /** 助手/外部智能体调用：校验通过后在此目录自动取不重名文件，不弹本机保存对话框（无人可点时会一直等待）。 */
  outputDirectory?: () => Promise<string> }
export interface VideoEditExportJob {
  id: string; owner: VideoEditInstance; name: string; presetName: string; snapshot: VideoEditComposition; settings: VideoEditExportSettings
  range: { startFrame: number; endFrame: number }; rangeSource: 'explicit' | 'in-out' | 'content'; path: string
  /** interrupted：界面重新加载时正在导出，未完成文件已清理，可按原快照重试。 */
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; error?: string; task?: VideoEditExportTask
  controller: AbortController; release: () => void
  startedAt?: number; finishedAt?: number
  loudnessRequested?: boolean
  /** 成片已写完并开始发布；之后的失败不删除文件、不可重试。 */
  outputPublished?: boolean
  /** 从界面重载前的登记接回：按当时提交的快照导出。 */
  restored?: boolean
  /** 接回时登记里记着的进度（中断项停在哪）；本页重新开始导出这一项后以任务进度为准。 */
  restoredProgress?: number
  /** 界面重载后不会保留这一项的原因；保留时为空。 */
  notRetained?: VideoEditExportNotRetainedReason
}
/** 主进程里的队列登记：渲染层重载后据此恢复排队项、标出中断项。 */
export interface VideoEditExportJobMirror {
  register(jobs: readonly VideoEditExportJob[]): Promise<void>
  update(job: VideoEditExportJob): void
  remove(ids: readonly string[]): void
}
const PROGRESS_SYNC_MS = 1000
export class VideoEditExportQueue {
  private jobs: VideoEditExportJob[] = []
  private draining = false
  private revision = 0
  private listeners = new Set<() => void>()
  private synced = new WeakMap<VideoEditExportJob, VideoEditExportJob['state']>()
  private registering = new Set<VideoEditExportJob>()
  private registered = new WeakSet<VideoEditExportJob>()
  constructor(private run: (job: VideoEditExportJob) => Promise<void>, private mirror?: VideoEditExportJobMirror) {}
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  version = (): number => this.revision
  list(): readonly VideoEditExportJob[] { return this.jobs }
  private publish(): void {
    this.revision++
    for (const job of this.jobs) if (!this.registering.has(job) && this.synced.get(job) !== job.state) { this.synced.set(job, job.state); this.mirror?.update(job) }
    for (const listener of this.listeners) listener(); publishVideoEdit()
  }
  append(jobs: VideoEditExportJob[]): Promise<void> {
    for (const job of jobs) { this.synced.set(job, job.state); this.registering.add(job) }
    this.jobs = this.jobs.concat(jobs); this.publish()
    return this.registerAndStart(jobs)
  }
  private async registerAndStart(jobs: VideoEditExportJob[]): Promise<void> {
    try {
      // 主进程确认接收快照以后才能开始写文件，也才能对调用方确认提交成功。
      if (this.mirror) await this.mirror.register(jobs)
      for (const job of jobs) this.registered.add(job)
    } catch (error) {
      for (const job of jobs) { if (job.state !== 'cancelled') { job.state = 'failed'; job.error = '没能登记导出，请重试。'; job.release() } }
      throw error
    } finally { for (const job of jobs) this.registering.delete(job); this.publish(); void this.drain() }
  }
  /** 接回主进程登记里上一页面留下的项：已登记过，不再重复登记；本地状态与登记不同的随即同步过去。 */
  restore(entries: ReadonlyArray<{ job: VideoEditExportJob; registeredState: VideoEditExportJob['state'] }>): void {
    for (const { job, registeredState } of entries) { this.synced.set(job, registeredState); this.registered.add(job) }
    this.jobs = this.jobs.concat(entries.map(entry => entry.job)); this.publish(); void this.drain()
  }
  pending(projectId?: string): boolean { return this.jobs.some(job => (!projectId || job.owner.document.id === projectId) && ['queued', 'running'].includes(job.state)) }
  clearFinished(): void {
    const keep = (job: VideoEditExportJob): boolean => this.registering.has(job) || ['queued', 'running'].includes(job.state)
    const removed = this.jobs.filter(job => !keep(job)).map(job => job.id)
    this.jobs = this.jobs.filter(keep)
    if (removed.length) this.mirror?.remove(removed)
    this.publish()
  }
  cancel(id: string): void {
    const job = this.require(id)
    if (!['queued', 'running'].includes(job.state)) return
    job.controller.abort(); job.task?.controller.abort()
    if (job.state === 'queued') { job.state = 'cancelled'; job.release() }
    logger.info('取消导出项', { event: 'video_edit.export_queue.cancelled', context: { jobId: id } }); this.publish()
  }
  retry(id: string, release: () => void): Promise<void> {
    const job = this.require(id)
    if (!retryableVideoEditExportJob(job)) throw new Error('只可重试未发布文件的失败或中断项；已保存的成片请直接使用文件。')
    if (job.state === 'interrupted') logger.info('重试中断的导出', { event: 'video_edit.export_queue.interrupted_retry', context: { jobId: id, projectId: job.owner.document.id } })
    job.controller = new AbortController(); job.release = release; job.task = undefined; job.restoredProgress = undefined; job.error = undefined; job.startedAt = undefined; job.finishedAt = undefined; job.state = 'queued'
    // Explicit retries join the tail, preserving the order of already submitted work.
    this.jobs = [...this.jobs.filter(value => value !== job), job]
    if (!this.registered.has(job)) { this.registering.add(job); this.publish(); return this.registerAndStart([job]) }
    this.publish(); void this.drain(); return Promise.resolve()
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
      while ((job = this.jobs.find(value => value.state === 'queued' && !this.registering.has(value)))) {
        const current = job; current.state = 'running'; current.startedAt = Date.now(); this.publish()
        logger.info('开始队列导出', { event: 'video_edit.export_queue.start', context: { jobId: current.id, projectId: current.owner.document.id } })
        const progress = this.mirror ? setInterval(() => this.mirror?.update(current), PROGRESS_SYNC_MS) : undefined
        try {
          await this.run(current)
          current.state = current.task?.state === 'cancelled' || current.controller.signal.aborted && current.task?.state !== 'completed' ? 'cancelled' : 'completed'
          logger.info('队列导出结束', { event: 'video_edit.export_queue.completed', context: { jobId: current.id, state: current.state } })
        } catch (error) {
          current.state = current.controller.signal.aborted && current.task?.state !== 'completed' ? 'cancelled' : 'failed'
          current.error = error instanceof Error ? error.message : '导出失败，请重试。'
          logger.error('队列导出失败', { event: 'video_edit.export_queue.failed', error, context: { jobId: current.id } })
        } finally { clearInterval(progress); current.finishedAt = Date.now(); current.release(); this.publish() }
      }
    } finally { this.draining = false }
  }
}
/** 导出项当前进度：本页任务的进度；接回后还没重新开始的，用中断时登记的进度。 */
export function videoEditExportJobProgress(job: VideoEditExportJob): number {
  return job.state === 'completed' ? 1 : job.task?.progress ?? job.restoredProgress ?? 0
}
export function retryableVideoEditExportJob(job: VideoEditExportJob): boolean {
  return (job.state === 'failed' || job.state === 'interrupted') && job.task?.state !== 'completed' && !job.outputPublished
}
/** 主进程原样保存、重载后用来重建导出项的数据；只在渲染层解释。快照单独登记，可多项共用。 */
const restorePayloadSchema = z.object({
  settings: videoEditExportSettingsSchema, path: z.string().min(1),
  range: z.object({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }),
  rangeSource: z.enum(['explicit', 'in-out', 'content']), loudnessRequested: z.boolean(),
})
function parseSnapshotJson(json: string | undefined): unknown { try { return json === undefined ? undefined : JSON.parse(json) } catch { return undefined } }
const restoredSnapshotSchema = z.custom<VideoEditComposition>(value => typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string' && typeof (value as { fps?: unknown }).fps === 'number')
const videoEditExportJobRegistry: VideoEditExportJobMirror = {
  async register(jobs) {
    const outcome = await registerVideoEditExportJobs(jobs.map(job => ({
      id: job.id, projectId: job.owner.document.id, name: job.name, presetName: job.presetName, outputPaths: videoEditExportPaths(job.path, job.settings), restorable: true, snapshot: job.snapshot,
      payload: { settings: job.settings, path: job.path, range: job.range, rangeSource: job.rangeSource, loudnessRequested: job.loudnessRequested ?? false } satisfies z.infer<typeof restorePayloadSchema>,
    })))
    for (const job of jobs) { const reason = outcome.get(job.id); if (reason) job.notRetained = reason }
  },
  update: job => syncVideoEditExportJob({ id: job.id, state: job.state, progress: videoEditExportJobProgress(job), ...(job.error ? { error: job.error } : {}) }),
  remove: ids => removeVideoEditExportJobs(ids),
}
export const videoEditExportQueue = new VideoEditExportQueue(async job => {
  job.controller.signal.throwIfAborted()
  if (!listVideoEditInstances().includes(job.owner)) throw new Error('原剪辑已关闭，请重新加入导出。')
  // 重试前先清掉这一项上次留下、清理失败的未完成文件，免得被当成“已有文件”拒绝。
  await discardVideoEditExportLeftovers(job.id)
  const result = await exportVideoEdit(job.owner.document.id, job.path, false, job.controller.signal, job.settings.loudness ?? undefined, {
    queueId: job.id, presetName: job.presetName, rangeSource: job.rangeSource, snapshot: job.snapshot, range: job.range, settings: job.settings, signal: job.controller.signal, loudnessRequested: job.loudnessRequested ?? false, onTask: task => { job.task = task },
    outputs: videoEditExportOutputs(job.id, () => { job.outputPublished = true }),
  })
  if (!result && !job.controller.signal.aborted && job.task?.state !== 'cancelled') throw new Error('导出未生成文件，请重试。')
}, videoEditExportJobRegistry)

/** 上一页面留下、等待原剪辑重新打开的导出项。 */
let waitingRestore: VideoEditExportJobRecord[] = []
export function listWaitingVideoEditExports(projectId?: string): readonly VideoEditExportJobRecord[] { return projectId ? waitingRestore.filter(record => record.projectId === projectId) : waitingRestore }
export function cancelWaitingVideoEditExport(id: string): void {
  waitingRestore = waitingRestore.filter(record => record.id !== id); removeVideoEditExportJobs([id])
  logger.info('取消等待原剪辑打开的导出项', { event: 'video_edit.export_queue.cancelled', context: { jobId: id } }); publishVideoEdit()
}
/** 原剪辑已打开的恢复项接回队列；查询与界面读取前也调用一次，保证看到的是接回后的状态。 */
export function adoptRestoredVideoEditExports(): void {
  if (!waitingRestore.length) return
  const instances = listVideoEditInstances()
  const adopted: Array<{ job: VideoEditExportJob; registeredState: VideoEditExportJob['state'] }> = []
  waitingRestore = waitingRestore.filter(record => {
    const owner = instances.find(instance => instance.document.id === record.projectId)
    if (!owner) return true
    const payload = restorePayloadSchema.safeParse(record.payload); const snapshot = restoredSnapshotSchema.safeParse(parseSnapshotJson(record.snapshotJson))
    if (!payload.success || !snapshot.success) {
      const error = '导出恢复信息无法读取，请按原设置重新提交，或移除这条失败记录。'
      if (record.state !== 'failed' || record.error !== error) {
        record.state = 'failed'; record.error = error
        syncVideoEditExportJob({ id: record.id, state: 'failed', progress: record.progress, error })
        logger.warn('导出恢复信息无法读取，保留失败记录', { event: 'video_edit.export_queue.restore_failed', context: { jobId: record.id, projectId: record.projectId } })
      }
      return true
    }
    let release = (): void => undefined
    let state = record.state === 'running' ? 'interrupted' as const : record.state
    if (state === 'queued') { try { release = holdVideoEditActivity(owner.document.id, 'export') } catch { state = 'interrupted' } }
    adopted.push({ registeredState: record.state, job: { id: record.id, owner, name: record.name, presetName: record.presetName, snapshot: snapshot.data, ...payload.data, state, release, controller: new AbortController(), restored: true, restoredProgress: record.progress, outputPublished: record.outputPublished, ...(record.error ? { error: record.error } : {}) } })
    return false
  })
  if (!adopted.length) return
  logger.info('恢复界面重新加载前的导出队列', { event: 'video_edit.export_queue.restored', context: { jobs: adopted.length, queued: adopted.filter(entry => entry.job.state === 'queued').length, interrupted: adopted.filter(entry => entry.job.state === 'interrupted').length } })
  videoEditExportQueue.restore(adopted)
}
/** 页面加载时取回主进程登记；原剪辑重新打开后排队项按原快照接着导出。 */
export async function restoreVideoEditExports(): Promise<void> {
  const records = await restoreVideoEditExportRecords()
  if (!records.length) return
  waitingRestore = waitingRestore.concat(records.filter(record => !waitingRestore.some(value => value.id === record.id) && !videoEditExportQueue.list().some(job => job.id === record.id)))
  adoptRestoredVideoEditExports(); publishVideoEdit()
}
subscribeVideoEdit(adoptRestoredVideoEditExports)
const initialRestore = restoreVideoEditExports()
export function waitForVideoEditExportRestore(): Promise<void> { return initialRestore }
/** Validate the whole batch and obtain local paths before committing any item. */
export async function enqueueVideoEditExports(requests: readonly VideoEditExportRequest[], signal?: AbortSignal): Promise<VideoEditExportJob[]> {
  await waitForVideoEditExportRestore()
  assertApplicationWritesAllowed(); signal?.throwIfAborted()
  if (!requests.length) throw new Error('请选择要导出的序列。')
  const releases: Array<() => void> = []
  try {
    // Reuse the same immutable composition snapshot across different formats of one sequence.
    const snapshots = new Map<VideoEditInstance, Map<string, VideoEditComposition>>()
    const jobs = requests.map(request => {
      const owner = requireVideoEditInstance(request.projectId)
      const sequenceId = request.sequenceId ?? owner.activeSequenceId
      let sequences = snapshots.get(owner)
      if (!sequences) { sequences = new Map(); snapshots.set(owner, sequences) }
      let snapshot = sequences.get(sequenceId)
      if (!snapshot) { snapshot = structuredClone(videoEditComposition(owner.document, sequenceId)); sequences.set(sequenceId, snapshot) }
      const requestedPreset = request.presetId ?? (!request.settings ? VIDEO_EDIT_DEFAULT_EXPORT_PRESET_ID : undefined)
      const preset = requestedPreset ? videoEditExportPresetLibrary.list().find(value => value.id === requestedPreset) : undefined
      if (request.presetId && !preset) throw new Error('原预设不存在，请从 video_edit.export_preset 目录重新选择。')
      const settings = resolveVideoEditExportSettings(request.settings ?? (preset?.id === VIDEO_EDIT_DEFAULT_EXPORT_PRESET_ID ? videoEditSequenceExportSettings(snapshot) : preset!.settings), snapshot)
      const range = { ...(request.range ?? videoEditExportRange(owner, sequenceId)) }
      const marks = sequenceId === owner.activeSequenceId ? owner : owner.sequenceViews.get(sequenceId)
      const rangeSource: VideoEditExportJob['rangeSource'] = request.range ? 'explicit' : marks?.inFrame != null || marks?.outFrame != null ? 'in-out' : 'content'
      if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) || range.startFrame < 0 || range.endFrame <= range.startFrame || range.endFrame > videoEditDuration(snapshot)) throw new Error('导出范围必须是序列内有效的整数帧入出点（出点不包含）。')
      const release = holdVideoEditActivity(request.projectId, 'export'); releases.push(release)
      return { id: crypto.randomUUID(), owner, name: snapshot.name, presetName: preset?.name ?? '自定义导出', snapshot, settings, loudnessRequested: request.loudnessRequested ?? Boolean(request.settings?.loudness || request.presetId && request.presetId !== VIDEO_EDIT_DEFAULT_EXPORT_PRESET_ID && preset?.settings.loudness), range, rangeSource, path: request.path ?? '', state: 'queued' as const, controller: new AbortController(), release }
    })
    for (const [index, job] of jobs.entries()) {
      signal?.throwIfAborted()
      if (!requests[index].settings) job.settings = await adaptVideoEditExportPreset(job.settings)
      await assertVideoEditExportSupported(job.settings)
    }
    const platform = getPlatform()
    const paths = new Set<string>()
    for (const [index, job] of jobs.entries()) {
      signal?.throwIfAborted()
      const directory = !job.path ? await requests[index].outputDirectory?.() : undefined
      if (!job.path && directory) {
        await platform.system.fs.mkdir(directory, { recursive: true })
        const base = (requests[index].fileName ?? `${job.name} - ${job.presetName}`).replace(/\.[^./\\]+$/, '').replace(/[\\/:*?"<>|]/g, '-').trim() || '导出'
        for (let attempt = 1; ; attempt++) {
          const candidate = joinVideoEditOutputPath(directory, `${attempt === 1 ? base : `${base} (${attempt})`}.${job.settings.format}`)
          const outputs = videoEditExportPaths(candidate, job.settings)
          const taken = await Promise.all(outputs.map(output => platform.system.fs.exists(output)))
          if (!taken.some(Boolean) && !outputs.some(output => paths.has(videoEditMediaPathKey(output)))) { job.path = candidate; break }
        }
      }
      if (!job.path) {
        const path = await platform.system.dialog.save({ defaultPath: requests[index].fileName ?? `${job.name} - ${job.presetName.replace(/[\\/:*?"<>|]/g, '-')}.${job.settings.format}`, filters: [{ name: job.settings.format.toUpperCase(), extensions: [job.settings.format] }] })
        if (!path) { for (const release of releases) release(); return [] }
        job.path = path
      }
      if (!job.path.toLowerCase().endsWith(`.${job.settings.format}`)) throw new Error(`输出文件需要 .${job.settings.format} 扩展名。`)
      for (const outputPath of videoEditExportPaths(job.path, job.settings)) {
        if (await platform.system.fs.exists(outputPath)) throw new Error('请选择新的文件名导出，避免覆盖已有成片或字幕文件。')
        const key = videoEditMediaPathKey(outputPath)
        if (paths.has(key)) throw new Error('多个导出不能使用同一个输出文件，请选择不同文件名。')
        paths.add(key)
      }
    }
    for (const owner of new Set(jobs.map(job => job.owner))) await saveVideoEdit(owner.document.id)
    signal?.throwIfAborted()
    const owners = new Set(listVideoEditInstances())
    if (jobs.some(job => !owners.has(job.owner))) throw new Error('原剪辑已关闭，未加入导出。')
    assertApplicationWritesAllowed()
    const occupied = new Set([...videoEditExportQueue.list().filter(value => ['queued', 'running'].includes(value.state)).flatMap(value => videoEditExportPaths(value.path, value.settings)), ...waitingRestore.flatMap(record => record.outputPaths)].map(videoEditMediaPathKey))
    if ([...paths].some(key => occupied.has(key))) throw new Error('输出位置已被另一个导出占用，请选择不同文件名。')
    releases.length = 0
    await videoEditExportQueue.append(jobs); return jobs
  } catch (error) { for (const release of releases) release(); throw error }
}
/** 剪辑所在项目的“导出”文件夹：助手与外部智能体的产物默认放这里，不弹保存对话框。 */
export async function videoEditProjectOutputDirectory(projectId: string): Promise<string> {
  const container = requireVideoEditInstance(projectId).session.documentMeta.container
  if (container.kind !== 'project') throw new Error('剪辑不在项目里，无法确定输出位置；请指定 destination（快速下载或预设目录）。')
  const project = await videoEditDocumentOperations().findProject(container.projectId)
  if (!project) throw new Error('剪辑所在项目找不到，请指定 destination。')
  return joinVideoEditOutputPath(project.path, '导出')
}
/** 在目录中取不重名的文件路径（重名加“ (2)”序号），不覆盖已有文件。 */
export async function uniqueVideoEditOutputPath(directory: string, name: string, extension: string): Promise<string> {
  const platform = getPlatform(); await platform.system.fs.mkdir(directory, { recursive: true })
  const base = name.replace(/[\\/:*?"<>|]/g, '-').trim() || '输出'
  for (let attempt = 1; ; attempt++) {
    const candidate = joinVideoEditOutputPath(directory, `${attempt === 1 ? base : `${base} (${attempt})`}.${extension}`)
    if (!await platform.system.fs.exists(candidate)) return candidate
  }
}
/** 目录与文件名拼接，沿用目录自身的分隔符。 */
export function joinVideoEditOutputPath(directory: string, name: string): string {
  const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/'
  return `${directory.replace(/[\\/]+$/, '')}${separator}${name}`
}
export function retryVideoEditExportJob(id: string): Promise<void> {
  assertApplicationWritesAllowed()
  const job = videoEditExportQueue.require(id)
  if (!listVideoEditInstances().includes(job.owner)) throw new Error('原剪辑已关闭，请重新加入导出。')
  const release = holdVideoEditActivity(job.owner.document.id, 'export')
  try { return videoEditExportQueue.retry(id, release) } catch (error) { release(); throw error }
}
export function videoEditQueuedExportTask(projectId: string, id: string): VideoEditExportTask | undefined {
  const owner = requireVideoEditInstance(projectId)
  return videoEditExportQueue.list().find(job => job.owner === owner && (job.id === id || job.task?.id === id))?.task ?? (videoEditExportTask(projectId)?.id === id ? videoEditExportTask(projectId) : undefined)
}
registerApplicationCloseGuard(async () => { if (videoEditExportQueue.pending()) throw new Error('仍有待导出的项目，请等待完成或在导出列表取消后再关闭。') })
