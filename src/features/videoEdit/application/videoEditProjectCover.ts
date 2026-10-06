import { createLogger } from '@/core/logging'
import { saveDocumentCover } from '@/commands/documents'
import { clipSourceSeconds, videoEditClipMedia, videoEditDuration, videoEditVisibleTracks, type VideoEditClip, type VideoEditDocument } from '@/core/videoEdit/document'
import { videoEditFps } from '@/core/videoEdit/time'
import { notifyDocumentCoverChanged } from '@/features/documents/documentCovers'
import type { DocumentCoverSource } from '@/core/documents/types'

/*
 * 剪辑的列表封面（项目卡片用主剪辑的封面）：
 * - 用户“设为项目封面”过：用当时节目监视器的实际画面（截图直接存成封面），之后自动更新不覆盖；
 * - 否则取第一条序列约 1/3 处最上层的画面片段（开头常是黑场或片头）；那一帧没有画面时退回最早出现的画面片段。
 * 视频由主进程按片段里的源时间取一帧，图片直接用原图，存成通用文档封面（程序目录，按文档 ID）。
 * 保存或离开剪辑时更新；画面没变（同一来源、同一时间）不重复生成；没有画面片段时不动，卡片保持占位图。
 */

const logger = createLogger('features.videoEdit.projectCover')
/** 每份剪辑上次写封面用的来源，避免每次保存都重新生成。 */
const lastSources = new Map<string, string>()

function clipCoverSource(document: VideoEditDocument, clip: VideoEditClip, frame: number, fps: number): DocumentCoverSource | null {
  const media = videoEditClipMedia(document, clip)
  if (!media) return null
  if (media.kind === 'image') return { source: media.path, sourceKind: 'image' }
  if (media.kind !== 'video') return null
  const at = clipSourceSeconds(clip, Math.max(clip.start, Math.min(frame, clip.start + clip.duration - 1)), fps)
  return { source: media.path, sourceKind: 'video', atSeconds: Math.round(Math.max(0, at) * 1000) / 1000 }
}

/** 剪辑封面的来源：指定的封面帧或第一条序列约 1/3 处最上层的画面片段；没有画面时为 null。 */
export function videoEditCoverSource(document: VideoEditDocument): DocumentCoverSource | null {
  const poster = document.posterFrame
  const sequence = (poster && document.sequences.find(item => item.id === poster.sequenceId)) || document.sequences[0]
  if (!sequence) return null
  const fps = videoEditFps(sequence.frameRate)
  const visible = videoEditVisibleTracks(sequence)
  const pictures = sequence.clips.filter(clip => (clip.kind === 'video' || clip.kind === 'image') && visible.has(clip.track))
  if (!pictures.length) return null
  const frame = poster && poster.sequenceId === sequence.id ? poster.frame : Math.floor(videoEditDuration(sequence) / 3)
  // 同一帧上层轨道（编号大）压住下层
  const atFrame = pictures.filter(clip => frame >= clip.start && frame < clip.start + clip.duration).sort((left, right) => right.track - left.track)
  for (const clip of atFrame) { const source = clipCoverSource(document, clip, frame, fps); if (source) return source }
  const earliest = [...pictures].sort((left, right) => left.start - right.start || right.track - left.track)
  for (const clip of earliest) { const source = clipCoverSource(document, clip, clip.start, fps); if (source) return source }
  return null
}

/** 按剪辑当前内容更新封面；用户指定过封面帧时不自动覆盖。失败只记日志，不影响保存与离开。 */
export async function updateVideoEditProjectCover(document: VideoEditDocument): Promise<void> {
  if (document.posterFrame) return
  const source = videoEditCoverSource(document)
  if (!source) return
  const key = `${source.sourceKind}:${source.source}@${source.atSeconds ?? 0}`
  if (lastSources.get(document.id) === key) return
  lastSources.set(document.id, key)
  try {
    await saveDocumentCover({ docId: document.id, sources: [source] })
    notifyDocumentCoverChanged(document.id)
  } catch (error) {
    // 下次保存再试
    if (lastSources.get(document.id) === key) lastSources.delete(document.id)
    logger.warn('剪辑封面更新失败', { event: 'video_edit.document.cover.failed', context: { docId: document.id, sourceKind: source.sourceKind }, error: String(error) })
  }
}

/** “设为项目封面”：把节目监视器当前画面（data URL）直接存成封面。 */
export async function saveVideoEditPosterCover(docId: string, dataUrl: string): Promise<void> {
  lastSources.delete(docId)
  await saveDocumentCover({ docId, sources: [{ source: dataUrl, sourceKind: 'image' }] })
  notifyDocumentCoverChanged(docId)
}
