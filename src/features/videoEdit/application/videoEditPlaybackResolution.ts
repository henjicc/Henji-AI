import { createLogger } from '@/core/logging'
import { VIDEO_EDIT_DEFAULT_PLAYBACK_RESOLUTION, videoEditPlaybackResolutionSchema, type VideoEditPlaybackResolutionSetting } from '@/core/videoEdit/playbackResolution'
import { publishVideoEdit, requireVideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.playbackResolution')
/** 按剪辑记住的回放分辨率（本机视图偏好，不写进剪辑文件、不进撤销栈）。最多记住最近 200 份剪辑。 */
const STORAGE_KEY = 'videoEdit.playbackResolution.v1'
const MAX_REMEMBERED = 200
let remembered: Map<string, VideoEditPlaybackResolutionSetting> | undefined

function storage(): Storage | null { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
function load(): Map<string, VideoEditPlaybackResolutionSetting> {
  if (remembered) return remembered
  remembered = new Map()
  try {
    const raw: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? 'null')
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [projectId, value] of Object.entries(raw)) {
      const parsed = videoEditPlaybackResolutionSchema.safeParse(value)
      if (parsed.success) remembered.set(projectId, parsed.data)
    }
  } catch { /* 偏好损坏时回到默认值 */ }
  return remembered
}
function persist(values: Map<string, VideoEditPlaybackResolutionSetting>): void {
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(values))) } catch (error) { logger.debug('回放分辨率偏好未能写入本机', { event: 'video_edit.playback_resolution.persist_failed', error }) }
}

/** 当前选择（没选过为完整、暂停回到完整）。只读偏好，剪辑关闭后仍可读，不抛错。 */
export function getVideoEditPlaybackResolution(projectId: string): VideoEditPlaybackResolutionSetting {
  return { ...(load().get(projectId) ?? VIDEO_EDIT_DEFAULT_PLAYBACK_RESOLUTION) }
}

/** 界面与助手共用的唯一写入口：校验后记住并通知节目监视器（下一帧按新尺寸渲染）。 */
export function setVideoEditPlaybackResolution(projectId: string, value: Partial<VideoEditPlaybackResolutionSetting>): VideoEditPlaybackResolutionSetting {
  requireVideoEditInstance(projectId)
  const next = videoEditPlaybackResolutionSchema.parse({ ...getVideoEditPlaybackResolution(projectId), ...value })
  const values = load()
  const current = values.get(projectId) ?? VIDEO_EDIT_DEFAULT_PLAYBACK_RESOLUTION
  if (current.resolution === next.resolution && current.fullWhenPaused === next.fullWhenPaused) return next
  values.delete(projectId); values.set(projectId, next)
  while (values.size > MAX_REMEMBERED) values.delete(values.keys().next().value!)
  persist(values)
  logger.info('回放分辨率已更改', { event: 'video_edit.playback_resolution.changed', context: { projectId, resolution: next.resolution, fullWhenPaused: next.fullWhenPaused } })
  publishVideoEdit()
  return next
}

/** 仅测试：清掉内存里的偏好，下次从本机存储重新读取。 */
export function resetVideoEditPlaybackResolutionCache(): void { remembered = undefined }
