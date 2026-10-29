import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import type { VideoEditExportJobRegistration, VideoEditExportPlatform, VideoEditExportRegistrationResult } from '@/platform/contracts/videoEditExport'

/*
 * 渲染层到主进程导出登记的唯一入口。正式队列必须登记成功才开始导出，确保提交后始终能恢复。
 */
const logger = createLogger('features.videoEdit.exportRegistry')

/** 桌面桥本身不存在（测试替身或预加载缺失），区别于主进程拒绝某个请求。 */
class RegistryUnavailable extends Error {}
let unavailableLogged = false
function call<T>(work: (platform: VideoEditExportPlatform) => Promise<T>): Promise<T> {
  let pending: Promise<T>
  try { pending = work(getPlatform().videoEditExport) } catch (error) {
    if (!unavailableLogged) { unavailableLogged = true; logger.warn('导出队列登记不可用，界面重新加载后无法恢复导出', { event: 'video_edit.export_registry.unavailable', error }) }
    return Promise.reject(new RegistryUnavailable(error instanceof Error ? error.message : String(error), { cause: error }))
  }
  return pending
}
const failedJobs = new Set<string>()
/** 同步失败每项只记一次，避免每秒一次的进度同步刷屏。 */
function syncFailed(jobId: string, event: string) {
  return (error: unknown): void => {
    if (error instanceof RegistryUnavailable || failedJobs.has(jobId)) return
    failedJobs.add(jobId)
    logger.warn('导出登记同步失败，界面重新加载后这一项可能无法恢复', { event, error, context: { jobId } })
  }
}

export const VIDEO_EDIT_EXPORT_NOT_RETAINED_REASONS = {
  snapshot_too_large: '这个序列太大，界面重新加载后无法保留这一项。',
  registry_full: '待导出的项目太多，界面重新加载后无法保留这一项。',
  failed: '没能登记这一项，界面重新加载后无法保留。',
} as const
export type VideoEditExportNotRetainedReason = keyof typeof VIDEO_EDIT_EXPORT_NOT_RETAINED_REASONS

/** 登记一批导出；返回每项是否会在重载后保留。快照按引用去重，同一序列的多项只传一份。 */
export async function registerVideoEditExportJobs(jobs: ReadonlyArray<Omit<VideoEditExportJobRegistration, 'snapshotIndex'> & { snapshot?: unknown }>): Promise<Map<string, VideoEditExportNotRetainedReason | null>> {
  const snapshots: string[] = []
  const indexes = new Map<unknown, number>()
  let results: VideoEditExportRegistrationResult[]
  try {
    const registrations = jobs.map(({ snapshot, ...job }) => {
      if (snapshot === undefined) return job
      let index = indexes.get(snapshot)
      if (index === undefined) { index = snapshots.push(JSON.stringify(snapshot)) - 1; indexes.set(snapshot, index) }
      return { ...job, snapshotIndex: index }
    })
    results = await call(platform => platform.register({ snapshots, jobs: registrations }))
  } catch (error) {
    for (const job of jobs) logger.warn('导出项未登记，界面重新加载后不会保留', { event: 'video_edit.export_registry.register_failed', error, context: { jobId: job.id, projectId: job.projectId } })
    throw error
  }
  const outcome = new Map<string, VideoEditExportNotRetainedReason | null>()
  for (const result of results) {
    const job = jobs.find(value => value.id === result.id)
    if (!job?.restorable) continue
    const reason = result.retained ? null : result.reason ?? 'failed'
    if (reason) throw new Error(VIDEO_EDIT_EXPORT_NOT_RETAINED_REASONS[reason])
    outcome.set(result.id, reason)
  }
  if (jobs.some(job => job.restorable && !outcome.has(job.id))) throw new Error('没能保留完整导出队列，请重试。')
  return outcome
}

export function syncVideoEditExportJob(update: { id: string; state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; progress: number; error?: string }): void {
  call(platform => platform.update(update)).catch(syncFailed(update.id, 'video_edit.export_registry.update_failed'))
}
export function removeVideoEditExportJobs(ids: readonly string[]): void {
  if (!ids.length) return
  call(platform => platform.remove([...ids])).catch(syncFailed(ids[0], 'video_edit.export_registry.remove_failed'))
}
export function discardVideoEditExportLeftovers(id: string): Promise<void> {
  return call(platform => platform.discardLeftovers(id)).catch(syncFailed(id, 'video_edit.export_registry.discard_failed'))
}
export function restoreVideoEditExportRecords(): ReturnType<VideoEditExportPlatform['restore']> {
  return call(platform => platform.restore()).catch(error => {
    if (!(error instanceof RegistryUnavailable)) logger.warn('没能取回界面重新加载前的导出队列', { event: 'video_edit.export_registry.restore_failed', error })
    return []
  })
}

/** 导出写文件的两个时机：独占创建输出文件，以及发布成片之前。 */
export interface VideoEditExportOutputs {
  create(path: string): Promise<void>
  published(): Promise<void>
  /** 只对临时登记有意义：文件已发布或已删干净才撤销登记；leftover=true 时保留，由主进程兜底清理。 */
  finish?(leftover: boolean): void
}
export function videoEditExportOutputs(id: string, onPublished?: () => void): VideoEditExportOutputs {
  return {
    async create(path) {
      try { await call(platform => platform.createOutput(id, path)) } catch (error) {
        if (!(error instanceof RegistryUnavailable)) throw error
        await getPlatform().system.fs.writeFile(path, new Uint8Array(), { exclusive: true })
      }
    },
    async published() {
      onPublished?.()
      await call(platform => platform.outputPublished(id)).catch(syncFailed(id, 'video_edit.export_registry.publish_failed'))
    },
  }
}
/**
 * 不进导出队列的单次导出（如发送到画布）：只登记输出文件，重载后清理未完成文件、不恢复。
 * 已知限制：清理靠新页面加载时取回登记或渲染进程退出触发；重载后新页面一直加载失败时，要等窗口销毁才清理。
 */
export function transientVideoEditExportOutputs(job: { id: string; projectId: string; name: string; outputPaths: string[] }): VideoEditExportOutputs {
  void registerVideoEditExportJobs([{ ...job, presetName: '', restorable: false }]).catch(syncFailed(job.id, 'video_edit.export_registry.register_failed'))
  syncVideoEditExportJob({ id: job.id, state: 'running', progress: 0 })
  return { ...videoEditExportOutputs(job.id), finish: leftover => { if (leftover) syncVideoEditExportJob({ id: job.id, state: 'failed', progress: 0 }); else removeVideoEditExportJobs([job.id]) } }
}
