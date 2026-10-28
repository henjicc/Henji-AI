import { createHash } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import path from 'node:path'
import type { VideoEditExportJobRecord, VideoEditExportJobRegistration, VideoEditExportJobUpdate, VideoEditExportRegistrationRequest, VideoEditExportRegistrationResult } from '../../../../src/platform/contracts/videoEditExport'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.video_edit_export')

/** 一个页面：webContents 重载后编号不变，页面编号由预加载脚本每次加载重新生成。 */
export interface VideoEditExportPage { senderId: number; pageId: string }
/** 主进程独占创建文件时记下的身份；清理前再核一次，路径上换成别的文件就不删。 */
export interface VideoEditExportFileIdentity { dev: bigint; ino: bigint; birthtimeNs: bigint }
export interface VideoEditExportRegistryFiles {
  createExclusive(path: string): Promise<void>
  identify(path: string): Promise<VideoEditExportFileIdentity | null>
  remove(path: string): Promise<void>
}
export interface VideoEditExportRegistryLimits { jobs: number; snapshotBytes: number; totalSnapshotBytes: number; payloadChars: number }

interface Entry {
  id: string; projectId: string; name: string; presetName: string; outputPaths: string[]
  restorable: boolean; snapshotKey?: string; payload?: unknown
  state: VideoEditExportJobRecord['state']; progress: number; error?: string; outputPublished: boolean
  owner?: VideoEditExportPage
  /** 本项经主进程创建、尚未发布的文件；清理失败的仍留在这里，重试前再清一次。 */
  created: Map<string, VideoEditExportFileIdentity>
}

const DEFAULT_LIMITS: VideoEditExportRegistryLimits = { jobs: 200, snapshotBytes: 32 * 1024 * 1024, totalSnapshotBytes: 256 * 1024 * 1024, payloadChars: 1024 * 1024 }
const pathKey = (value: string): string => { const resolved = path.resolve(value); return process.platform === 'win32' ? resolved.toLowerCase() : resolved }
const samePage = (a: VideoEditExportPage | undefined, b: VideoEditExportPage): boolean => Boolean(a && a.senderId === b.senderId && a.pageId === b.pageId)
const sameFile = (a: VideoEditExportFileIdentity, b: VideoEditExportFileIdentity): boolean => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs
const INTERRUPTED_AFTER_PUBLISH = '成片已保存，但界面重新加载时收尾未完成；请从导出位置使用文件。'
type Snapshot = { key: string; bytes: number; json: string } | NonNullable<VideoEditExportRegistrationResult['reason']>
function serializedLength(value: unknown): number | undefined { try { return JSON.stringify(value ?? null).length } catch { return undefined } }

/**
 * 导出队列在主进程的内存登记（不落盘，应用退出即清空）。渲染层负责编码；这里替它独占创建输出文件，
 * 页面离开时保住排队项、把正在跑的项标成“已中断”，并只清理自己创建且尚未发布的文件。
 */
export class VideoEditExportJobRegistry {
  private readonly entries = new Map<string, Entry>()
  private readonly snapshots = new Map<string, { json: string; bytes: number; refs: number }>()
  private snapshotBytes = 0
  constructor(private readonly files: VideoEditExportRegistryFiles, private readonly limits: VideoEditExportRegistryLimits = DEFAULT_LIMITS) {}

  register(page: VideoEditExportPage, request: VideoEditExportRegistrationRequest): VideoEditExportRegistrationResult[] {
    for (const job of request.jobs) if (this.entries.has(job.id)) throw new Error('导出项已登记。')
    // 先按字节数判断单份与本批合计，超限的不解析、不算哈希；其余按内容去重，同一序列的多个格式只存一份。
    let batchBytes = 0
    const snapshots = request.snapshots.map((json): Snapshot => {
      const bytes = Buffer.byteLength(json, 'utf8')
      if (bytes > this.limits.snapshotBytes) return 'snapshot_too_large'
      batchBytes += bytes
      if (batchBytes > this.limits.totalSnapshotBytes) return 'registry_full'
      return { key: createHash('sha256').update(json).digest('hex'), bytes, json }
    })
    return request.jobs.map(job => this.registerOne(page, job, job.snapshotIndex === undefined ? 'snapshot_too_large' : snapshots[job.snapshotIndex]))
  }

  private registerOne(page: VideoEditExportPage, job: VideoEditExportJobRegistration, snapshot: Snapshot): VideoEditExportRegistrationResult {
    if (this.entries.size >= this.limits.jobs) return this.notRetained(job, 'registry_full')
    const entry: Entry = { id: job.id, projectId: job.projectId, name: job.name, presetName: job.presetName, outputPaths: [...job.outputPaths], restorable: false, state: 'queued', progress: 0, outputPublished: false, owner: page, created: new Map() }
    this.entries.set(job.id, entry)
    if (!job.restorable) return { id: job.id, retained: false }
    const payloadChars = serializedLength(job.payload)
    if (typeof snapshot === 'string') return this.notRetained(job, snapshot)
    if (payloadChars === undefined || payloadChars > this.limits.payloadChars) return this.notRetained(job, 'snapshot_too_large')
    const stored = this.snapshots.get(snapshot.key)
    if (!stored && this.snapshotBytes + snapshot.bytes > this.limits.totalSnapshotBytes) return this.notRetained(job, 'registry_full')
    if (stored) stored.refs++
    else { this.snapshots.set(snapshot.key, { json: snapshot.json, bytes: snapshot.bytes, refs: 1 }); this.snapshotBytes += snapshot.bytes }
    entry.restorable = true; entry.snapshotKey = snapshot.key; entry.payload = job.payload
    return { id: job.id, retained: true }
  }

  private notRetained(job: VideoEditExportJobRegistration, reason: NonNullable<VideoEditExportRegistrationResult['reason']>): VideoEditExportRegistrationResult {
    logger.warn('导出项不会在界面重载后保留', { event: 'video_edit_export.register.not_retained', context: { jobId: job.id, projectId: job.projectId, reason, jobs: this.entries.size, snapshotBytes: this.snapshotBytes } })
    return { id: job.id, retained: false, reason }
  }

  update(page: VideoEditExportPage, update: VideoEditExportJobUpdate): void {
    const entry = this.owned(page, update.id)
    if (!entry) return
    if (update.state === 'completed' || update.state === 'cancelled') {
      // 还有本项创建、未发布的文件记录（渲染层可能没删掉）：留到界面离开时按身份核对后清理，不再恢复。
      if (!entry.created.size || entry.outputPublished) { this.delete(entry); return }
      entry.restorable = false
    }
    entry.state = update.state; entry.progress = Math.min(1, Math.max(0, update.progress)); entry.error = update.error
  }

  /** 在同一次调用里独占创建并记下身份；渲染层无法让这里删除任何不是它创建的文件。 */
  async createOutput(page: VideoEditExportPage, id: string, outputPath: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) { await this.files.createExclusive(outputPath); return }
    if (!samePage(entry.owner, page)) throw new Error('这个导出项已由重新加载后的界面接管，旧界面不再写入。')
    if (!entry.outputPaths.some(value => pathKey(value) === pathKey(outputPath))) throw new Error('输出文件不属于这个导出项。')
    await this.files.createExclusive(outputPath)
    const identity = await this.files.identify(outputPath)
    if (identity) entry.created.set(outputPath, identity)
    // 创建期间页面离开或已被新页面接管：这个文件不会再有人写，立刻清掉。
    if (this.entries.get(id) !== entry || !samePage(entry.owner, page) || entry.state === 'interrupted') await this.cleanup(entry, 'late_create')
  }

  outputPublished(page: VideoEditExportPage, id: string): void {
    const entry = this.owned(page, id)
    if (entry) { entry.outputPublished = true; entry.created.clear() }
  }

  async discardLeftovers(page: VideoEditExportPage, id: string): Promise<void> {
    const entry = this.owned(page, id)
    if (entry && !entry.outputPublished) await this.cleanup(entry, 'retry')
  }

  remove(page: VideoEditExportPage, ids: readonly string[]): void {
    for (const id of ids) { const entry = this.owned(page, id); if (entry) this.delete(entry) }
  }

  /** 新页面取回无主的导出项并接管；同一 webContents 上一页面遗留的项先按离开处理。 */
  async restore(page: VideoEditExportPage): Promise<VideoEditExportJobRecord[]> {
    await this.release(entry => entry.owner?.senderId === page.senderId && entry.owner.pageId !== page.pageId, 'page_replaced')
    const restored: VideoEditExportJobRecord[] = []
    for (const entry of this.entries.values()) {
      if (entry.owner || !entry.restorable) continue
      entry.owner = page
      restored.push(this.record(entry))
    }
    if (restored.length) logger.info('页面取回导出队列', { event: 'video_edit_export.restore.completed', context: { jobs: restored.length, queued: restored.filter(job => job.state === 'queued').length, interrupted: restored.filter(job => job.state === 'interrupted').length } })
    return restored
  }

  /** 渲染进程退出或 webContents 销毁。页面导航不在这里判断：被拦下的导航不应中断导出，换页由 restore 识别。 */
  leave(senderId: number, reason: string): Promise<void> {
    return this.release(entry => entry.owner?.senderId === senderId, reason)
  }

  list(): VideoEditExportJobRecord[] { return [...this.entries.values()].map(entry => this.record(entry)) }

  private record(entry: Entry): VideoEditExportJobRecord {
    return { id: entry.id, projectId: entry.projectId, name: entry.name, presetName: entry.presetName, outputPaths: [...entry.outputPaths], snapshotJson: entry.snapshotKey ? this.snapshots.get(entry.snapshotKey)?.json : undefined, payload: entry.payload, state: entry.state, progress: entry.progress, ...(entry.error ? { error: entry.error } : {}), outputPublished: entry.outputPublished }
  }

  private owned(page: VideoEditExportPage, id: string): Entry | undefined {
    const entry = this.entries.get(id)
    return entry && samePage(entry.owner, page) ? entry : undefined
  }

  private delete(entry: Entry): void {
    this.entries.delete(entry.id)
    const stored = entry.snapshotKey ? this.snapshots.get(entry.snapshotKey) : undefined
    if (stored && --stored.refs === 0) { this.snapshots.delete(entry.snapshotKey!); this.snapshotBytes -= stored.bytes }
  }

  private async release(match: (entry: Entry) => boolean, reason: string): Promise<void> {
    const toClean: Entry[] = []
    for (const entry of [...this.entries.values()]) {
      if (!match(entry)) continue
      entry.owner = undefined
      if (entry.state === 'running') {
        logger.warn('导出因界面离开而中断', { event: 'video_edit_export.job.interrupted', context: { jobId: entry.id, projectId: entry.projectId, reason, outputPublished: entry.outputPublished, progress: entry.progress } })
        if (entry.outputPublished) { entry.state = 'failed'; entry.error = INTERRUPTED_AFTER_PUBLISH }
        else { entry.state = 'interrupted'; entry.error = undefined; toClean.push(entry) }
      }
      // 渲染层自己没删掉的未完成文件（失败、取消后清理失败）也在这里兜底。
      else if (entry.created.size && !entry.outputPublished) toClean.push(entry)
      if (!entry.restorable && !toClean.includes(entry)) this.delete(entry)
    }
    for (const entry of toClean) { await this.cleanup(entry, reason); if (!entry.restorable) this.delete(entry) }
  }

  private async cleanup(entry: Entry, reason: string): Promise<void> {
    for (const [outputPath, identity] of [...entry.created]) {
      const context = { jobId: entry.id, fileName: path.basename(outputPath), reason }
      try {
        const current = await this.files.identify(outputPath)
        entry.created.delete(outputPath)
        if (!current || !sameFile(current, identity)) { logger.info('未完成导出文件已不在原处，跳过清理', { event: 'video_edit_export.cleanup.skipped', context }); continue }
        await this.files.remove(outputPath)
        logger.info('已清理未完成的导出文件', { event: 'video_edit_export.cleanup.completed', context })
      } catch (error) {
        entry.created.set(outputPath, identity)
        logger.warn('清理未完成的导出文件失败', { event: 'video_edit_export.cleanup.failed', error, context })
      }
    }
  }
}

/** 只认进程退出与销毁：导航可能被守卫拦下，那时页面仍在写，不能判中断。 */
export function watchVideoEditExportSender(sender: EventEmitter, senderId: number, registry: VideoEditExportJobRegistry): void {
  sender.on('render-process-gone', () => { void registry.leave(senderId, 'render_process_gone') })
  sender.once('destroyed', () => { void registry.leave(senderId, 'destroyed') })
}
