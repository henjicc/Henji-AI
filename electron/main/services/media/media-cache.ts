import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  autoMediaCacheBudgetBytes, DEFAULT_MEDIA_CACHE_SETTINGS, MEDIA_CACHE_CATEGORIES, mediaCacheSettingsSchema, planMediaCacheEviction,
  type MediaCacheCategory, type MediaCacheFileEntry, type MediaCacheSettings, type MediaCacheUsage,
} from '../../../../src/core/media/mediaCache'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import { createContentDiskCache, type ContentDiskCache, type ContentDiskCacheOptions } from './content-disk-cache'

/*
 * 可重建媒体缓存的唯一位置与管理入口。
 *
 * - 位置：作品目录下的隐藏文件夹（中文作品目录 `.痕迹AI缓存`，英文 `.Henji AI Cache`），随作品所在磁盘；
 *   数据库、密钥、日志、设置等小而关键的数据仍在程序目录。作品目录变化（重启后生效）时，旧位置的缓存删一次，不搬迁。
 * - 分类：预渲染、代理、智能分析（智能区域、跟踪、镜头检测、声音能量）、缩略图条与波形、口播处理。
 *   各类内部仍用通用磁盘缓存（按内容命名、原子写入、最近使用刷新修改时间）。
 * - 管理：总容量上限与按最后使用时间清理在这里跨类统一执行；启动时清理旧位置与孤儿条目。
 */

export const MEDIA_CACHE_FOLDER_NAMES = { zh: '.痕迹AI缓存', en: '.Henji AI Cache' } as const
/** 每类缓存在缓存根下的子目录；分析与预览类再按来源细分。 */
const CATEGORY_FOLDERS: Readonly<Record<MediaCacheCategory, string>> = {
  render: 'render', proxy: 'proxy', analysis: 'analysis', preview: 'preview', audio_edit: 'audio-edit',
}
export const MEDIA_CACHE_SETTING_KEYS = {
  budgetGb: 'media_cache_budget_gb', retentionDays: 'media_cache_retention_days',
  renderFormat: 'video_render_cache_format', renderQuality: 'video_render_cache_quality',
  /** 上一次使用的缓存根；与当前不同说明作品目录已更换，旧位置清理一次。 */
  lastRoot: 'media_cache_last_root',
  /** 旧版放在程序目录与 userData 的缓存已清理（只做一次）。 */
  legacyCleaned: 'media_cache_legacy_cleaned',
} as const

export interface MediaCacheHost {
  /** 当前作品目录与其界面语言（决定缓存文件夹名）；读不到时缓存停用。 */
  userRoot(): { root: string; locale: 'zh' | 'en' } | undefined
  settings: { get(key: string): string | null; set(key: string, value: string, type: 'string' | 'number'): void; delete(key: string): void }
  /** 旧版缓存目录（程序目录与 userData 下），启动时删除一次。 */
  legacyDirectories(): string[]
  /** 仍存在的剪辑文档 ID（孤儿预渲染检查用）；读不到时返回 undefined，不做孤儿清理。 */
  liveDocumentIds?(kind: 'video_edit' | 'audio_edit'): Promise<ReadonlySet<string> | undefined>
  logger: { info(message: string, data: Record<string, unknown>): void; warn(message: string, data: Record<string, unknown>): void }
}

/** 删除条目前询问：正在使用（例如正在播放的预渲染文件）的条目返回 true 跳过。 */
type ProtectFile = (file: string) => boolean
/** 孤儿条目由各类缓存自己判断（只有它们知道元数据格式）。 */
type OrphanCollector = (live: { video_edit?: ReadonlySet<string>; audio_edit?: ReadonlySet<string> }) => Promise<number>

const ENFORCE_INTERVAL_MS = 60_000
const STALE_TEMPORARY_MS = 24 * 60 * 60 * 1000

export class MediaCacheManager {
  private root: string | null | undefined
  private enforcing: Promise<void> | undefined
  private lastEnforce = 0
  private readonly protectors = new Set<ProtectFile>()
  private readonly orphanCollectors = new Set<OrphanCollector>()
  private readonly listeners = new Set<() => void>()
  /** 应用退出后不再开始任何维护或设置读写（主进程退出流程会关闭数据库）。 */
  private stopped = false

  constructor(private readonly host: MediaCacheHost) {}

  /** 缓存根；作品目录在运行期间不变（更换后重启），第一次解析后沿用。 */
  cacheRoot(): string | undefined {
    if (this.root === undefined) {
      let user: ReturnType<MediaCacheHost['userRoot']>
      try { user = this.host.userRoot() } catch { user = undefined }
      this.root = user ? path.join(user.root, MEDIA_CACHE_FOLDER_NAMES[user.locale]) : null
    }
    return this.root ?? undefined
  }

  categoryDirectory(category: MediaCacheCategory, ...parts: string[]): string | undefined {
    const root = this.cacheRoot()
    return root ? path.join(root, CATEGORY_FOLDERS[category], ...parts) : undefined
  }

  /** 通用磁盘缓存放进某类缓存目录；写入后按节流触发跨类总量检查。 */
  createCache(category: MediaCacheCategory, folder: string | undefined, options: Omit<ContentDiskCacheOptions, 'directory'>): ContentDiskCache {
    const directory = (): string | undefined => folder ? this.categoryDirectory(category, folder) : this.categoryDirectory(category)
    const cache = createContentDiskCache({ ...options, directory })
    const after = <T>(value: T): T => { this.scheduleEnforce(); return value }
    return { ...cache, write: async (key, bytes) => after(await cache.write(key, bytes)), adopt: async (key, temporary) => after(await cache.adopt(key, temporary)) }
  }

  stop(): void { this.stopped = true }

  protect(callback: ProtectFile): () => void { this.protectors.add(callback); return () => { this.protectors.delete(callback) } }
  registerOrphanCollector(callback: OrphanCollector): void { this.orphanCollectors.add(callback) }
  onChange(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private changed(): void { for (const listener of this.listeners) { try { listener() } catch { /* listener failure must not stop cache work */ } } }

  readSettings(): MediaCacheSettings {
    const read = (key: string): string | null => { try { return this.host.settings.get(key) } catch { return null } }
    const number = (key: string): number | null => { const raw = read(key); return raw === null || raw === '' ? null : Number(raw) }
    const candidate = {
      budgetGb: number(MEDIA_CACHE_SETTING_KEYS.budgetGb),
      retentionDays: number(MEDIA_CACHE_SETTING_KEYS.retentionDays) ?? DEFAULT_MEDIA_CACHE_SETTINGS.retentionDays,
      renderFormat: read(MEDIA_CACHE_SETTING_KEYS.renderFormat) ?? DEFAULT_MEDIA_CACHE_SETTINGS.renderFormat,
      renderQuality: read(MEDIA_CACHE_SETTING_KEYS.renderQuality) ?? DEFAULT_MEDIA_CACHE_SETTINGS.renderQuality,
    }
    // 每项独立回退：一项被外部改坏不影响其他项。
    const result = { ...DEFAULT_MEDIA_CACHE_SETTINGS }
    for (const key of Object.keys(result) as Array<keyof MediaCacheSettings>) {
      const parsed = mediaCacheSettingsSchema.shape[key].safeParse(candidate[key])
      if (parsed.success) (result as Record<string, unknown>)[key] = parsed.data
    }
    return result
  }

  writeSettings(patch: Partial<MediaCacheSettings>): MediaCacheSettings {
    const next = mediaCacheSettingsSchema.parse({ ...this.readSettings(), ...patch })
    const keys = MEDIA_CACHE_SETTING_KEYS
    if (next.budgetGb === null) this.host.settings.delete(keys.budgetGb)
    else this.host.settings.set(keys.budgetGb, String(next.budgetGb), 'number')
    this.host.settings.set(keys.retentionDays, String(next.retentionDays), 'number')
    this.host.settings.set(keys.renderFormat, next.renderFormat, 'string')
    this.host.settings.set(keys.renderQuality, next.renderQuality, 'string')
    this.host.logger.info('缓存设置已更新', { event: 'media_cache.settings.updated', context: { ...next } })
    this.scheduleEnforce(true)
    this.changed()
    return next
  }

  private async availableBytes(): Promise<number | null> {
    const root = this.cacheRoot()
    if (!root) return null
    let probe = root
    // 缓存目录可能还没建：向上找到已存在的目录读磁盘空间。
    for (;;) {
      try { const disk = await fs.statfs(probe); return Number(disk.bavail) * Number(disk.bsize) } catch { /* try parent */ }
      const parent = path.dirname(probe)
      if (parent === probe) return null
      probe = parent
    }
  }

  async budgetBytes(cachedBytes: number): Promise<{ budgetBytes: number; autoBudgetBytes: number; availableBytes: number | null }> {
    const availableBytes = await this.availableBytes()
    // 自动上限把缓存自己已占的空间也算作可用，避免缓存越大、可用越少、上限越小，来回清掉刚写的文件。
    const autoBudgetBytes = autoMediaCacheBudgetBytes(availableBytes === null ? null : availableBytes + cachedBytes)
    const fixed = this.readSettings().budgetGb
    return { budgetBytes: fixed === null ? autoBudgetBytes : fixed * 1024 ** 3, autoBudgetBytes, availableBytes }
  }

  private async listFiles(category?: MediaCacheCategory): Promise<Array<MediaCacheFileEntry & { category: MediaCacheCategory; temporary: boolean }>> {
    const files: Array<MediaCacheFileEntry & { category: MediaCacheCategory; temporary: boolean }> = []
    for (const current of category ? [category] : MEDIA_CACHE_CATEGORIES) {
      const directory = this.categoryDirectory(current)
      if (!directory) continue
      const walk = async (folder: string): Promise<void> => {
        let entries
        try { entries = await fs.readdir(folder, { withFileTypes: true }) } catch { return }
        for (const entry of entries) {
          const target = path.join(folder, entry.name)
          if (entry.isSymbolicLink()) continue
          if (entry.isDirectory()) { await walk(target); continue }
          if (!entry.isFile()) continue
          try {
            const stat = await fs.stat(target)
            files.push({ file: target, size: stat.size, usedMs: stat.mtimeMs, category: current, temporary: entry.name.endsWith('.tmp') })
          } catch { /* removed concurrently */ }
        }
      }
      await walk(directory)
    }
    return files
  }

  async usage(): Promise<MediaCacheUsage> {
    const files = await this.listFiles()
    const categories = MEDIA_CACHE_CATEGORIES.map(category => {
      const own = files.filter(file => file.category === category)
      return { category, bytes: own.reduce((sum, file) => sum + file.size, 0), files: own.length }
    })
    const totalBytes = categories.reduce((sum, item) => sum + item.bytes, 0)
    return { categories, totalBytes, ...(await this.budgetBytes(totalBytes)) }
  }

  private isProtected(file: string): boolean {
    for (const protect of this.protectors) { try { if (protect(file)) return true } catch { /* ignore */ } }
    return false
  }

  /** 清除一类或全部缓存；正在使用的文件跳过（下次清理再删）。 */
  async clear(category: MediaCacheCategory | 'all'): Promise<{ removedFiles: number; removedBytes: number; skippedFiles: number }> {
    const files = await this.listFiles(category === 'all' ? undefined : category)
    let removedFiles = 0, removedBytes = 0, skippedFiles = 0
    for (const file of files) {
      if ((file.temporary && Date.now() - file.usedMs < STALE_TEMPORARY_MS) || this.isProtected(file.file)) { skippedFiles++; continue }
      try { await removeUnmanagedCachePath(file.file, { force: true }); removedFiles++; removedBytes += file.size } catch { skippedFiles++ }
    }
    this.host.logger.info('缓存已清除', { event: 'media_cache.clear.completed', context: { category, removedFiles, removedBytes, skippedFiles } })
    this.changed()
    return { removedFiles, removedBytes, skippedFiles }
  }

  /** 跨类执行保留天数与总容量上限；写入后节流调用，设置变化时立即调用。 */
  scheduleEnforce(immediate = false): void {
    if (this.stopped) return
    if (!immediate && Date.now() - this.lastEnforce < ENFORCE_INTERVAL_MS) return
    void this.enforce().catch(error => this.host.logger.warn('缓存容量检查失败', { event: 'media_cache.enforce.failed', error }))
  }

  enforce(): Promise<void> {
    this.enforcing ??= (async () => {
      this.lastEnforce = Date.now()
      if (this.stopped) return
      const settings = this.readSettings()
      const files = await this.listFiles()
      const { budgetBytes } = await this.budgetBytes(files.reduce((sum, file) => sum + file.size, 0))
      const now = Date.now()
      const staleTemporary = files.filter(file => file.temporary && now - file.usedMs > STALE_TEMPORARY_MS)
      const plan = planMediaCacheEviction(files.filter(file => !file.temporary), { nowMs: now, retentionDays: settings.retentionDays, budgetBytes, protect: entry => this.isProtected(entry.file) })
      let removedFiles = 0, removedBytes = 0
      for (const entry of [...staleTemporary, ...plan]) {
        try { await removeUnmanagedCachePath(entry.file, { force: true }); removedFiles++; removedBytes += entry.size } catch { /* in use: next round */ }
      }
      if (removedFiles) {
        this.host.logger.info('已按缓存设置清理', { event: 'media_cache.enforce.completed', context: { removedFiles, removedBytes, budgetBytes, retentionDays: settings.retentionDays } })
        this.changed()
      }
    })().finally(() => { this.enforcing = undefined })
    return this.enforcing
  }

  /**
   * 启动维护（后台，不阻塞界面）：旧版缓存目录删一次；作品目录更换后删旧位置的缓存；
   * 给缓存根加隐藏属性；清理孤儿条目；执行一次容量与保留检查。
   */
  async startupMaintenance(): Promise<void> {
    const root = this.cacheRoot()
    if (!root || this.stopped) return
    const settings = this.host.settings
    if (settings.get(MEDIA_CACHE_SETTING_KEYS.legacyCleaned) !== '1') {
      let removed = 0
      for (const directory of this.host.legacyDirectories()) {
        if (this.stopped) return
        try { await fs.access(directory) } catch { continue }
        try { await removeUnmanagedCachePath(directory, { recursive: true, force: true }); removed++ }
        catch (error) { this.host.logger.warn('旧版缓存目录未能删除', { event: 'media_cache.legacy.failed', error, context: { directory } }) }
      }
      settings.set(MEDIA_CACHE_SETTING_KEYS.legacyCleaned, '1', 'string')
      this.host.logger.info('旧版缓存位置已清理', { event: 'media_cache.legacy.completed', context: { removed } })
    }
    const last = settings.get(MEDIA_CACHE_SETTING_KEYS.lastRoot)
    if (last && path.resolve(last) !== path.resolve(root) && Object.values(MEDIA_CACHE_FOLDER_NAMES).includes(path.basename(last) as never)) {
      try {
        await removeUnmanagedCachePath(last, { recursive: true, force: true })
        this.host.logger.info('作品目录已更换，旧位置的缓存已删除', { event: 'media_cache.previous_root.removed', context: { previous: last } })
      } catch (error) { this.host.logger.warn('旧位置的缓存未能删除', { event: 'media_cache.previous_root.failed', error, context: { previous: last } }) }
    }
    if (this.stopped) return
    settings.set(MEDIA_CACHE_SETTING_KEYS.lastRoot, root, 'string')
    await fs.mkdir(root, { recursive: true })
    if (process.platform === 'win32') await new Promise<void>(resolve => { execFile('attrib', ['+h', root], { windowsHide: true }, () => resolve()) })
    if (this.stopped) return
    if (this.host.liveDocumentIds && this.orphanCollectors.size) {
      const live = { video_edit: await this.host.liveDocumentIds('video_edit'), audio_edit: await this.host.liveDocumentIds('audio_edit') }
      let removed = 0
      for (const collect of this.orphanCollectors) {
        try { removed += await collect(live) } catch (error) { this.host.logger.warn('孤儿缓存检查失败', { event: 'media_cache.orphans.failed', error }) }
      }
      if (removed) this.host.logger.info('已清理孤儿缓存', { event: 'media_cache.orphans.completed', context: { removed } })
    }
    await this.enforce()
  }
}
