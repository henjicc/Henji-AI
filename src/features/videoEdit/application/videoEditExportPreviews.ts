import { videoEditComposition, type VideoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import { prepareVideoEditRenderWindows } from './videoEditRenderCache'
import { requireVideoEditInstance } from './videoEditService'

type PreviewWindow = Awaited<ReturnType<typeof prepareVideoEditRenderWindows>>[number]

/** 已就绪文件按导出快照读取；排队后编辑过的序列不能借用当前序列的预览。 */
export async function videoEditExportPreviews(projectId: string, snapshot: VideoEditComposition, settings: VideoEditExportSettings, signal: AbortSignal): Promise<PreviewWindow[]> {
  if (settings.usePreviews !== true || !settings.videoEnabled) return []
  const owner = requireVideoEditInstance(projectId)
  const document = owner.document, contentVersion = owner.contentVersion
  if (document.revision !== snapshot.revision || !document.sequences.some(sequence => sequence.id === snapshot.id)
    || JSON.stringify(videoEditComposition(document, snapshot.id)) !== JSON.stringify(snapshot)) return []
  // 预览含序列字幕；关闭烧录时，只能复用本身就没有可见字幕的画面。
  if (settings.captionMode !== 'burn' && [snapshot, ...(snapshot.sequences ?? [])].some(sequence => sequence.captionTrackEnabled !== false && sequence.captions?.length)) return []
  signal.throwIfAborted()
  const windows = await prepareVideoEditRenderWindows(projectId, snapshot, signal)
  signal.throwIfAborted()
  // 文档不可变，等待后的身份与内容版本复核无需再次序列化整份合成。
  if (owner.document !== document || owner.contentVersion !== contentVersion || document.revision !== snapshot.revision) return []
  return windows.filter(window => window.width >= settings.width && window.height >= settings.height && window.fps === (settings.followSequence.fps ? snapshot.fps : settings.fps ?? snapshot.fps))
}
