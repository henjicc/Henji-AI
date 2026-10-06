import { createLogger } from '@/core/logging'
import { saveDocumentCover } from '@/commands/documents'
import { videoEditClipMedia, type VideoEditDocument } from '@/core/videoEdit/document'
import type { DocumentCoverSource } from '@/core/documents/types'

/*
 * 剪辑的列表封面（项目卡片用主剪辑的封面）：取第一个序列里最早出现的画面片段（视频或图片），
 * 视频由主进程取一帧，图片直接用原图，存成通用文档封面（程序目录，按文档 ID）。
 * 保存或离开剪辑时更新；画面没变（同一个来源）不重复生成；没有画面片段时不动，卡片保持占位图。
 */

const logger = createLogger('features.videoEdit.projectCover')
/** 每份剪辑上次写封面用的来源，避免每次保存都重新生成。 */
const lastSources = new Map<string, string>()
const listeners = new Set<(docId: string) => void>()

/** 剪辑封面的来源：第一个序列里起点最早的画面片段（同一起点取上层轨道）；没有时为 null。 */
export function videoEditCoverSource(document: VideoEditDocument): DocumentCoverSource | null {
  const sequence = document.sequences[0]
  if (!sequence) return null
  const disabled = new Set(sequence.tracks.filter(track => !track.enabled).map(track => track.index))
  const candidates = sequence.clips
    .filter(clip => (clip.kind === 'video' || clip.kind === 'image') && !disabled.has(clip.track))
    .sort((left, right) => left.start - right.start || right.track - left.track)
  for (const clip of candidates) {
    const media = videoEditClipMedia(document, clip)
    if (media && (media.kind === 'video' || media.kind === 'image')) return { source: media.path, sourceKind: media.kind }
  }
  return null
}

/** 封面写好后通知（项目列表据此重读封面）。 */
export function subscribeVideoEditCoverChanged(listener: (docId: string) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 按剪辑当前内容更新封面；失败只记日志，不影响保存与离开。 */
export async function updateVideoEditProjectCover(document: VideoEditDocument): Promise<void> {
  const source = videoEditCoverSource(document)
  if (!source) return
  const key = `${source.sourceKind}:${source.source}`
  if (lastSources.get(document.id) === key) return
  lastSources.set(document.id, key)
  try {
    await saveDocumentCover({ docId: document.id, sources: [source] })
    for (const listener of listeners) listener(document.id)
  } catch (error) {
    // 下次保存再试
    if (lastSources.get(document.id) === key) lastSources.delete(document.id)
    logger.warn('剪辑封面更新失败', { event: 'video_edit.document.cover.failed', context: { docId: document.id, sourceKind: source.sourceKind }, error: String(error) })
  }
}
