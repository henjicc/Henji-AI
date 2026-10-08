import { joinVideoEditOutputPath } from './videoEditExportQueue'
import { createLogger } from '@/core/logging'
import { videoEditCaptionSchema, videoEditMarkerSchema, importVideoEditCaptions, exportVideoEditCaptions, type VideoEditCaption, type VideoEditMarker } from '@/core/videoEdit/timedContent'
import { getPlatform } from '@/platform/runtime'
import { editVideoSequence, requireVideoEditInstance, videoEditExportRange } from './videoEditService'

const logger = createLogger('features.videoEdit.timedContent')
export function createVideoEditMarker(projectId: string, sequenceId: string, values: Omit<VideoEditMarker, 'id'>): string {
  const marker = videoEditMarkerSchema.parse({ ...values, id: crypto.randomUUID() })
  editVideoSequence(projectId, sequenceId, sequence => ({ ...sequence, markers: [...(sequence.markers ?? []), marker] }))
  return marker.id
}
export function createVideoEditCaption(projectId: string, sequenceId: string, values: Omit<VideoEditCaption, 'id'>): string {
  const caption = videoEditCaptionSchema.parse({ ...values, id: crypto.randomUUID() })
  editVideoSequence(projectId, sequenceId, sequence => ({ ...sequence, captions: [...(sequence.captions ?? []), caption] }))
  return caption.id
}
export function updateVideoEditTimedContent(projectId: string, sequenceId: string, kind: 'marker', id: string, values: Partial<Omit<VideoEditMarker, 'id'>>): void
export function updateVideoEditTimedContent(projectId: string, sequenceId: string, kind: 'caption', id: string, values: Partial<Omit<VideoEditCaption, 'id'>>): void
export function updateVideoEditTimedContent(projectId: string, sequenceId: string, kind: 'marker' | 'caption', id: string, values: Partial<Omit<VideoEditMarker, 'id'>> | Partial<Omit<VideoEditCaption, 'id'>>): void {
  editVideoSequence(projectId, sequenceId, sequence => {
    const schema = kind === 'marker' ? videoEditMarkerSchema : videoEditCaptionSchema
    const key = kind === 'marker' ? 'markers' : 'captions'
    if (!sequence[key]?.some(value => value.id === id)) throw new Error('此字幕或标记已移除，请重新选择。')
    return { ...sequence, [key]: sequence[key]!.map(value => value.id === id ? schema.parse({ ...value, ...values }) : value) }
  })
}
export function removeVideoEditTimedContent(projectId: string, sequenceId: string, kind: 'marker' | 'caption', ids: string[]): void {
  editVideoSequence(projectId, sequenceId, sequence => {
    const key = kind === 'marker' ? 'markers' : 'captions'
    if (ids.some(id => !sequence[key]?.some(value => value.id === id))) throw new Error('此字幕或标记不属于原序列。')
    return { ...sequence, [key]: sequence[key]!.filter(value => !ids.includes(value.id)) }
  })
}
export function appendVideoEditCaptionText(projectId: string, sequenceId: string, source: string, options: { offset?: number; clipId?: string } = {}): string[] {
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('原序列已移除，请重新选择。')
  const clip = options.clipId ? sequence.clips.find(clip => clip.id === options.clipId) : undefined
  if (options.clipId && !clip) throw new Error('原字幕片段已移除，请重新选择。')
  const captions = importVideoEditCaptions(source, sequence.frameRate, { offset: options.offset, clip })
  editVideoSequence(projectId, sequenceId, sequence => ({ ...sequence, captions: [...(sequence.captions ?? []), ...captions] }))
  return captions.map(caption => caption.id)
}
export async function importVideoEditCaptionFile(projectId: string, sequenceId: string, options: { offset?: number; clipId?: string } = {}, signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted()
  const owner = requireVideoEditInstance(projectId); const before = owner.document
  const chosen = await getPlatform().system.dialog.open({ multiple: false, filters: [{ name: '字幕', extensions: ['srt', 'vtt'] }] })
  signal?.throwIfAborted()
  const path = Array.isArray(chosen) ? chosen[0] : chosen
  if (!path) return []
  logger.info('开始导入剪辑字幕', { event: 'video_edit.caption.import.start', context: { projectId, sequenceId } })
  try {
    const text = await getPlatform().system.fs.readTextFile(path)
    signal?.throwIfAborted()
    if (requireVideoEditInstance(projectId) !== owner || owner.document !== before) throw new Error('原剪辑已有新修改，请重新导入字幕。')
    const ids = appendVideoEditCaptionText(projectId, sequenceId, text, options)
    logger.info('剪辑字幕导入完成', { event: 'video_edit.caption.import.complete', context: { projectId, sequenceId, count: ids.length } })
    return ids
  } catch (error) { if (!signal?.aborted) logger.error('剪辑字幕导入失败', { event: 'video_edit.caption.import.failed', context: { projectId, sequenceId }, error }); throw error }
}
export async function exportVideoEditSubtitles(projectId: string, format: 'srt' | 'vtt', sequenceId = requireVideoEditInstance(projectId).activeSequenceId, signal?: AbortSignal, clock: 'sequence' | 'range' = 'range', outputDirectory?: string): Promise<{ saved: boolean; verified: boolean }> {
  signal?.throwIfAborted()
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  if (!sequence || !sequence.captions?.length) throw new Error('此序列没有可导出的字幕。')
  const range = videoEditExportRange(owner, sequenceId)
  const text = exportVideoEditCaptions(sequence, format, { ...range, clock })
  if (!text.replace(/^WEBVTT\s*/, '').trim()) throw new Error('序列入出点范围内没有字幕。')
  let path: string | null
  if (outputDirectory) {
    // 能力调用：自动取不重名文件，不弹保存对话框。
    const platform = getPlatform(); await platform.system.fs.mkdir(outputDirectory, { recursive: true })
    const base = sequence.name.replace(/[\\/:*?"<>|]/g, '-').trim() || '字幕'
    for (let attempt = 1; ; attempt++) {
      path = joinVideoEditOutputPath(outputDirectory, `${attempt === 1 ? base : `${base} (${attempt})`}.${format}`)
      if (!await platform.system.fs.exists(path)) break
    }
  } else path = await getPlatform().system.dialog.save({ defaultPath: `${sequence.name}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] })
  signal?.throwIfAborted()
  if (!path) return { saved: false, verified: false }
  if (!path.toLowerCase().endsWith(`.${format}`)) throw new Error(`请将字幕保存为.${format}文件。`)
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭，请重新导出。')
  logger.info('开始导出剪辑字幕', { event: 'video_edit.caption.export.start', context: { projectId, sequenceId, format } })
  try {
    await getPlatform().system.fs.writeTextFile(path, text)
    const verified = await getPlatform().system.fs.readTextFile(path) === text
    if (!verified) throw new Error('字幕已写入，但回读结果不一致，请检查目标文件后重试。')
    if (requireVideoEditInstance(projectId) !== owner) throw new Error('字幕文件已写出，但原剪辑会话已关闭，请检查原输出。')
    signal?.throwIfAborted()
    logger.info('剪辑字幕导出完成', { event: 'video_edit.caption.export.complete', context: { projectId, sequenceId, format } })
    return { saved: true, verified }
  } catch (error) { if (!signal?.aborted) logger.error('剪辑字幕导出失败', { event: 'video_edit.caption.export.failed', context: { projectId, sequenceId, format }, error }); throw error }
}
