import type { VideoEditMedia } from '@/core/videoEdit/document'
import { toFetchableMediaUrl } from '@/services/imageSource'

/**
 * 交给 Worker 的素材副本：录屏事件页换成可 fetch 的地址（Worker 只能 fetch），文档继续保留磁盘路径。
 * 只在主线程调用（渲染会话、重构与注意力分析的 Worker 客户端）。
 */
export function withFetchableRecordingPages<T extends Pick<VideoEditMedia, 'recordingCursor'>>(media: T): T {
  return media.recordingCursor ? { ...media, recordingCursor: { ...media.recordingCursor, pages: media.recordingCursor.pages.map(page => ({ ...page, path: toFetchableMediaUrl(page.path) })) } } : media
}
