import { createLogger } from '@/core/logging'
import { videoEditDuration, videoEditPictureFilter, type VideoEditDocument } from '@/core/videoEdit/document'
import { videoEditFps } from '@/core/videoEdit/time'
import { notifyDocumentCoverChanged } from '@/features/documents/documentCovers'
import { getDocumentHoverFrames, saveDocumentCover } from '@/commands/documents'
import type { DocumentCoverSource } from '@/core/documents/types'
import { VIDEO_EDIT_COVER_POSITION, videoEditClipFrameSource, videoEditHoverContentKey } from './videoEditHoverPreview'

/*
 * 剪辑的列表封面（项目卡片用主剪辑的封面）：
 * - 用户“设为项目封面”过：用当时节目监视器的实际画面（截图直接存成封面），之后自动更新不覆盖；
 * - 否则取第一条序列正中间的画面：开头常是黑场、淡入或片头，播放头停在哪也与“这部片子长什么样”无关。
 *   优先用后台生成的合成预览帧（代码效果、调色、字幕都在画面里），还没生成时用那一帧最上层画面片段的原始画面；
 *   那一帧没有画面时退回最早出现的画面片段。
 * 保存、离开剪辑以及中间的合成预览帧生成好时更新；同一来源不重复生成；都取不到时不动，卡片保持占位图。
 */

const logger = createLogger('features.videoEdit.projectCover')
/** 每份剪辑上次写封面用的来源，避免每次保存都重新生成。 */
const lastSources = new Map<string, string>()

/** 剪辑封面的原始画面来源：指定的封面帧或第一条序列正中间最上层的画面片段；没有画面时为 null。 */
export function videoEditCoverSource(document: VideoEditDocument): DocumentCoverSource | null {
  const poster = document.posterFrame
  const sequence = (poster && document.sequences.find(item => item.id === poster.sequenceId)) || document.sequences[0]
  if (!sequence) return null
  const fps = videoEditFps(sequence.frameRate)
  const picture = videoEditPictureFilter(sequence)
  const pictures = sequence.clips.filter(clip => (clip.kind === 'video' || clip.kind === 'image') && picture.has(clip))
  if (!pictures.length) return null
  const frame = poster && poster.sequenceId === sequence.id ? poster.frame : Math.floor(videoEditDuration(sequence) * VIDEO_EDIT_COVER_POSITION)
  // 同一帧上层轨道（编号大）压住下层
  const atFrame = pictures.filter(clip => frame >= clip.start && frame < clip.start + clip.duration).sort((left, right) => right.track - left.track)
  for (const clip of atFrame) { const source = videoEditClipFrameSource(document, clip, frame, fps); if (source) return source }
  const earliest = [...pictures].sort((left, right) => left.start - right.start || right.track - left.track)
  for (const clip of earliest) { const source = videoEditClipFrameSource(document, clip, clip.start, fps); if (source) return source }
  return null
}

/** 中间位置的合成预览帧；预览帧属于旧内容或还没生成时为 null。 */
async function compositeCoverSource(document: VideoEditDocument): Promise<DocumentCoverSource | null> {
  const stored = await getDocumentHoverFrames(document.id)
  const frame = stored?.frames.find(item => item.position === VIDEO_EDIT_COVER_POSITION)
  if (!frame || stored!.contentKey !== await videoEditHoverContentKey(document)) return null
  return { source: frame.path, sourceKind: 'image' }
}

/**
 * 按剪辑当前内容更新封面；用户指定过封面帧时不自动覆盖。失败只记日志，不影响保存与离开。
 */
export async function updateVideoEditProjectCover(document: VideoEditDocument): Promise<void> {
  if (document.posterFrame) return
  let source: DocumentCoverSource | null
  try { source = await compositeCoverSource(document) ?? videoEditCoverSource(document) }
  catch (error) {
    logger.warn('读取剪辑封面画面失败', { event: 'video_edit.document.cover.source_failed', context: { docId: document.id }, error: String(error) })
    return
  }
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
