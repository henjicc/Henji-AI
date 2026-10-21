import type { MediaCacheCategory, MediaCacheSettings, MediaCacheUsage } from '../../core/media/mediaCache'
import type { HardwareCapabilitiesReport, HardwareCapabilitiesState, HardwareEncodeResult } from '../../core/media/hardwareCapabilities'
import type { VideoRenderCacheEntry, VideoRenderCacheStoredEntry } from '../../core/videoEdit/renderCacheStore'

export const MEDIA_CACHE_CHANNELS = {
  settings: 'mediaCache:settings', setSettings: 'mediaCache:set-settings', usage: 'mediaCache:usage', clear: 'mediaCache:clear', changed: 'mediaCache:changed',
  renderList: 'mediaCache:render-list', renderBegin: 'mediaCache:render-begin', renderCommit: 'mediaCache:render-commit', renderDiscard: 'mediaCache:render-discard', renderRemove: 'mediaCache:render-remove',
  hardware: 'mediaCache:hardware', detectHardware: 'mediaCache:detect-hardware',
} as const

/** 作品目录下可重建缓存的设置、占用与清除，以及预渲染文件的存取。 */
export interface MediaCachePlatform {
  getSettings(): Promise<MediaCacheSettings>
  setSettings(patch: Partial<MediaCacheSettings>): Promise<MediaCacheSettings>
  usage(): Promise<MediaCacheUsage>
  clear(category: MediaCacheCategory | 'all'): Promise<{ removedFiles: number; removedBytes: number; skippedFiles: number }>
  /** 设置或占用变化（清除、自动清理）时通知。 */
  onChanged(listener: () => void): () => void
  renderList(projectId: string): Promise<VideoRenderCacheStoredEntry[]>
  /** 建好临时文件并返回路径，渲染层按块写入后 commit。 */
  renderBegin(request: { projectId: string; windowKey: string; profile: string }): Promise<string>
  renderCommit(request: { temporaryPath: string; entry: VideoRenderCacheEntry }): Promise<VideoRenderCacheStoredEntry>
  renderDiscard(temporaryPath: string): Promise<void>
  renderRemove(request: { projectId: string; windowKeys?: string[]; keepSequenceIds?: string[] }): Promise<number>
  /** 已记录的本机硬件编解码能力，以及是否需要重新检测。 */
  hardwareCapabilities(): Promise<HardwareCapabilitiesState>
  /** 检测解码能力并与渲染层测得的编码能力一起记录。 */
  detectHardwareCapabilities(encode: HardwareEncodeResult[]): Promise<HardwareCapabilitiesReport>
}
