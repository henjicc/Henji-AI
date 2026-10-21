import { z } from 'zod'

/**
 * 可重建的媒体缓存（预渲染、代理、智能分析、缩略图条与波形、口播处理）的公共契约：
 * 分类、设置与占用快照。缓存放在作品目录下的隐藏文件夹里，随作品所在磁盘；删了都能重建，不是持久格式。
 */
export const MEDIA_CACHE_CATEGORIES = ['render', 'proxy', 'analysis', 'preview', 'audio_edit'] as const
export type MediaCacheCategory = (typeof MEDIA_CACHE_CATEGORIES)[number]
export const mediaCacheCategorySchema = z.enum(MEDIA_CACHE_CATEGORIES)

export const MEDIA_CACHE_RETENTION_DAYS = [7, 30, 90, 0] as const
export type MediaCacheRetentionDays = (typeof MEDIA_CACHE_RETENTION_DAYS)[number]
export const mediaCacheRetentionDaysSchema = z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)])

export const VIDEO_RENDER_CACHE_FORMATS = ['auto', 'avc', 'hevc'] as const
export type VideoRenderCacheFormat = (typeof VIDEO_RENDER_CACHE_FORMATS)[number]
export const VIDEO_RENDER_CACHE_QUALITIES = ['standard', 'high'] as const
export type VideoRenderCacheQuality = (typeof VIDEO_RENDER_CACHE_QUALITIES)[number]

/** 总容量上限最低 10GB；自动上限取所在盘可用空间的 10% 与 50GB 中较小者，再不低于最低值。 */
export const MEDIA_CACHE_MIN_BUDGET_GB = 10
export const MEDIA_CACHE_AUTO_BUDGET_MAX_GB = 50
export const MEDIA_CACHE_MAX_BUDGET_GB = 4096
export const mediaCacheBudgetGbSchema = z.number().int().min(MEDIA_CACHE_MIN_BUDGET_GB).max(MEDIA_CACHE_MAX_BUDGET_GB)

export const mediaCacheSettingsSchema = z.object({
  /** null 表示自动（按所在盘可用空间计算）。 */
  budgetGb: mediaCacheBudgetGbSchema.nullable(),
  retentionDays: mediaCacheRetentionDaysSchema,
  renderFormat: z.enum(VIDEO_RENDER_CACHE_FORMATS),
  renderQuality: z.enum(VIDEO_RENDER_CACHE_QUALITIES),
}).strict()
export type MediaCacheSettings = z.infer<typeof mediaCacheSettingsSchema>
export const DEFAULT_MEDIA_CACHE_SETTINGS: MediaCacheSettings = { budgetGb: null, retentionDays: 30, renderFormat: 'auto', renderQuality: 'standard' }

export interface MediaCacheUsage {
  categories: Array<{ category: MediaCacheCategory; bytes: number; files: number }>
  totalBytes: number
  /** 当前生效的总容量上限（自动时按此刻可用空间计算）。 */
  budgetBytes: number
  /** 自动上限的计算值，界面在“自动”旁说明。 */
  autoBudgetBytes: number
  /** 缓存所在磁盘的可用空间；读不到时为 null。 */
  availableBytes: number | null
}

const GB = 1024 ** 3
export function formatMediaCacheBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(0, Math.round(bytes / 1024))} KB`
  if (bytes < GB) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${(bytes / GB).toFixed(bytes < 100 * GB ? 1 : 0)} GB`
}
export function autoMediaCacheBudgetBytes(availableBytes: number | null): number {
  const tenth = availableBytes === null ? MEDIA_CACHE_AUTO_BUDGET_MAX_GB * GB : availableBytes * 0.1
  return Math.max(MEDIA_CACHE_MIN_BUDGET_GB * GB, Math.min(MEDIA_CACHE_AUTO_BUDGET_MAX_GB * GB, Math.floor(tenth)))
}

export interface MediaCacheFileEntry { file: string; size: number; usedMs: number }

/**
 * 纯计算：先删超过保留天数未使用的文件，再按最久未用删到总量不超过上限的 80%。
 * `protect` 返回 true 的文件（正在写入、正在使用）跳过。
 */
export function planMediaCacheEviction(entries: readonly MediaCacheFileEntry[], options: { nowMs: number; retentionDays: MediaCacheRetentionDays; budgetBytes: number; protect?: (entry: MediaCacheFileEntry) => boolean }): MediaCacheFileEntry[] {
  const removable = entries.filter(entry => !options.protect?.(entry))
  const remove = new Set<MediaCacheFileEntry>()
  if (options.retentionDays > 0) {
    const cutoff = options.nowMs - options.retentionDays * 24 * 60 * 60 * 1000
    for (const entry of removable) if (entry.usedMs < cutoff) remove.add(entry)
  }
  let total = entries.reduce((sum, entry) => sum + (remove.has(entry) ? 0 : entry.size), 0)
  if (total > options.budgetBytes) {
    const target = options.budgetBytes * 0.8
    for (const entry of [...removable].sort((a, b) => a.usedMs - b.usedMs)) {
      if (total <= target) break
      if (remove.has(entry)) continue
      remove.add(entry); total -= entry.size
    }
  }
  return [...remove]
}
