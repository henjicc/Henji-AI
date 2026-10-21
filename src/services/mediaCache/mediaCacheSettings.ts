import { createLogger } from '@/core/logging'
import { APPLICATION_SETTINGS_CHANGED_EVENT } from '@/core/settings/events'
import { DEFAULT_MEDIA_CACHE_SETTINGS, mediaCacheSettingsSchema, type MediaCacheSettings } from '@/core/media/mediaCache'
import { getPlatform } from '@/platform/runtime'

/**
 * 缓存设置在渲染层的同步投影：权威值在主进程设置表（主进程执行容量上限与按时间清理），
 * 启动时读入；修改先更新投影再写主进程，失败时回滚并抛出。
 */
const logger = createLogger('services.mediaCache')
let snapshot: MediaCacheSettings = { ...DEFAULT_MEDIA_CACHE_SETTINGS }
let loading: Promise<MediaCacheSettings> | undefined
const listeners = new Set<() => void>()
function notify(): void {
  for (const listener of listeners) listener()
  try { window.dispatchEvent(new Event(APPLICATION_SETTINGS_CHANGED_EVENT)) } catch { /* no window in workers */ }
}

export function getMediaCacheSettings(): MediaCacheSettings { return snapshot }
export function subscribeMediaCacheSettings(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }

/** 启动时与主进程通知变化时调用；宿主不可用时保持默认值。 */
export function loadMediaCacheSettings(): Promise<MediaCacheSettings> {
  loading ??= (async () => {
    try {
      snapshot = mediaCacheSettingsSchema.parse(await getPlatform().mediaCache.getSettings())
      notify()
    } catch (error) { logger.warn('缓存设置读取失败，暂用默认值', { event: 'media_cache.settings.load_failed', error }) }
    return snapshot
  })().finally(() => { loading = undefined })
  return loading
}

export async function updateMediaCacheSettings(patch: Partial<MediaCacheSettings>): Promise<MediaCacheSettings> {
  const before = snapshot
  snapshot = mediaCacheSettingsSchema.parse({ ...snapshot, ...patch })
  notify()
  try {
    snapshot = mediaCacheSettingsSchema.parse(await getPlatform().mediaCache.setSettings(patch))
    notify()
    return snapshot
  } catch (error) {
    snapshot = before; notify()
    logger.warn('缓存设置未保存', { event: 'media_cache.settings.save_failed', error })
    throw error
  }
}

let watching = false
/** 应用启动时调用一次：读入设置，并在主进程通知设置变化时重新读取。 */
export function initializeMediaCacheSettings(): void {
  if (watching) return
  watching = true
  void loadMediaCacheSettings()
  try { getPlatform().mediaCache.onChanged(() => { void loadMediaCacheSettings() }) } catch { /* host without media cache (tests) */ }
}
