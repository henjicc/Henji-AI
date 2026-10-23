import { videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditEdgeTracks, videoEditEmptyTrackIds } from '@/core/videoEdit/tracks'
import { RECORDING_CURSOR_EFFECT } from '@/core/videoEdit/recordingCursor'
import { RECORDING_ZOOM_EFFECT } from '@/core/videoEdit/recordingZoom'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform'
import { importVideoEditSources, makeRecordingClipEffect, openVideoEditDocument, saveVideoEdit, suggestRecordingClipZoom } from '@/features/videoEdit'
import type { RecordingDestination } from './recordingService'

const logger = createLogger('features.screenRecording.web_recording_import')

export interface WebRecordingVideoImportResult { itemIds: string[]; clipIds: string[]; video: 'replay' | 'backup'; cursor: boolean; warnings: string[] }

/**
 * 网页录制进剪辑：是一段普通视频片段（最新的重演视频，没有就用备份录屏），行为轨已换算成该视频上的光标事件，
 * 片段带上现有的鼠标效果（重新画光标与点击）与按点击建议的自动缩放。给 sequenceId 时放到 frame 处的空视频轨，
 * 否则只进素材库。一次保存，可撤销。
 */
export async function importWebRecordingToVideo(recordingId: string, target: RecordingDestination, prefer: 'replay' | 'backup' | 'auto' = 'auto', signal?: AbortSignal): Promise<WebRecordingVideoImportResult> {
  const source = await getPlatform().webReplay.editSource(recordingId, prefer)
  signal?.throwIfAborted()
  await openVideoEditDocument({ id: target.documentId }, { focus: false })
  const clipIds: string[] = []
  const itemIds = await importVideoEditSources(target.documentId, [{ path: source.video }], undefined, signal, (document, ids) => {
    const item = document.items.find(value => value.id === ids[0])
    const media = document.media.find(value => value.id === item?.mediaId)
    if (!item || !media) throw new Error('网页录制的视频没能导入素材库')
    if (source.title) item.name = source.title
    if (source.cursor) media.recordingCursor = source.cursor
    if (!target.sequenceId) return document
    const sequence = document.sequences.find(value => value.id === target.sequenceId)
    if (!sequence) throw new Error('目标序列不存在，请选择其他序列重试')
    // 只复用整条为空且未锁定的视频轨，没有就在边上加一条。
    let track = videoEditEmptyTrackIds(sequence, 'video').map(id => sequence.tracks.find(value => value.id === id)!).find(value => !value.locked)
    if (!track) { track = videoEditEdgeTracks(sequence, 'video', 1)[0]; sequence.tracks.push(track) }
    const fps = videoEditComposition(document, sequence.id).fps
    const duration = Math.floor(media.durationSeconds * fps + 1e-6)
    if (duration < 1) throw new Error('网页录制的视频太短，没有可放入的画面')
    const clip = makeVideoEditItemClip(document, item.id, sequence.id, { frame: target.frame ?? 0, track: track.index, duration })
    if (media.recordingCursor) clip.effects = [makeRecordingClipEffect(RECORDING_CURSOR_EFFECT, undefined, { smoothing: 0 }), makeRecordingClipEffect(RECORDING_ZOOM_EFFECT, suggestRecordingClipZoom(media, media.recordingCursor, source.events))]
    sequence.clips.push(clip)
    clipIds.push(clip.id)
    return document
  })
  await saveVideoEdit(target.documentId)
  logger.info('网页录制已导入剪辑', { event: 'web_replay.import_video.completed', context: { recordingId, documentId: target.documentId, video: source.kind, cursor: Boolean(source.cursor), clips: clipIds.length } })
  return { itemIds, clipIds, video: source.kind, cursor: Boolean(source.cursor), warnings: source.warnings }
}
