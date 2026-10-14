import { recordingDocumentSchema } from '@/core/screenRecording/document'
import type { RecordingDocument, RecordingMedia } from '@/core/screenRecording/document'
import { videoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform'
import { importVideoEditSources } from '@/features/videoEdit'
import { openVideoEditDocument, saveVideoEdit } from '@/features/videoEdit'
import type { RecordingDestination } from './recordingService'
import { recordingMediaSpans } from './recordingTimeline'

/** Real mono-time intervals share one origin. Pause/device gaps remain empty; audio latency is already compensated. */
export function placeRecordingMedia(document: VideoEditDocument, recording: RecordingDocument, media: RecordingMedia[], itemIds: string[], target: RecordingDestination): VideoEditDocument {
  if (!target.sequenceId) return document
  const sequence = document.sequences.find(sequence => sequence.id === target.sequenceId)
  if (!sequence) throw new Error('录制期间目标序列已移除，素材尚未导入；请选择其他序列重试')
  const fps = videoEditComposition(document, sequence.id).fps
  const origin = Math.min(...media.map(item => item.monoUs))
  const trackIndices = new Map<string, number>()
  for (const kind of (['microphone', 'systemAudio', 'screen', 'camera'] as const).filter(kind => media.some(item => item.kind === kind))) {
    const index = Math.max(-1, ...sequence.tracks.map(track => track.index)) + 1
    sequence.tracks.push({ id: crypto.randomUUID(), name: { screen: '屏幕', camera: '摄像头', microphone: '麦克风', systemAudio: '系统声音' }[kind], index, kind: kind === 'screen' || kind === 'camera' ? 'video' : 'audio', locked: false, enabled: true, muted: false, solo: false })
    trackIndices.set(kind, index)
  }
  const linkId = crypto.randomUUID()
  for (const [index, source] of media.entries()) {
    const item = document.items.find(item => item.id === itemIds[index])
    const imported = document.media.find(value => value.id === item?.mediaId)
    if (!item || !imported) throw new Error('录制素材导入结果不完整')
    for (const { startUs: start, endUs: end } of recordingMediaSpans(recording, source, Math.round(imported.durationSeconds * 1e6))) {
      const duration = Math.floor((end - start) * fps / 1e6 + 1e-6)
      if (duration < 1) continue
      const clip = makeVideoEditItemClip(document, item.id, sequence.id, { frame: (target.frame ?? 0) + Math.round((start - origin) * fps / 1e6), track: trackIndices.get(source.kind), duration, sourceInUs: start - source.monoUs, sourceOutUs: end - source.monoUs, ...(source.kind === 'screen' || source.kind === 'camera' ? { sourceComponent: 'video' as const } : {}) })
      sequence.clips.push({ ...clip, linkId })
    }
  }
  return document
}
export async function importRecordingToVideo(id: string, target: RecordingDestination, signal?: AbortSignal): Promise<string[]> {
  const read = await getPlatform().documents.readDocument({ id })
  if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
  const recording = recordingDocumentSchema.parse(read.content)
  if (!['stopped', 'interrupted'].includes(recording.status)) throw new Error('请先停止录制或恢复已中断会话')
  const media = recording.media.filter(media => media.durationUs > 0)
  if (!media.length) throw new Error('会话没有已保存的录制片段')
  await openVideoEditDocument({ id: target.documentId }, { focus: false })
  const items = await importVideoEditSources(target.documentId, media.map(item => ({ path: item.path })), undefined, signal,
    (document, ids) => placeRecordingMedia(document, recording, media, ids, target))
  await saveVideoEdit(target.documentId)
  return items
}
