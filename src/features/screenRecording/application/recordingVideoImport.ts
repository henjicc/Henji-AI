import { recordingDocumentSchema } from '@/core/screenRecording/document'
import type { RecordingDocument, RecordingMedia } from '@/core/screenRecording/document'
import { videoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform'
import { importVideoEditSources, prepareVideoEditRecordingGain } from '@/features/videoEdit'
import { appendVideoEditSequence, createVideoEditProject, makeRecordingClipEffect, openVideoEditDocument, saveVideoEdit, suggestRecordingClipZoom, switchVideoEditSequence } from '@/features/videoEdit'
import type { CaptureEvent } from '@/core/captureLog/events'
import { RECORDING_CURSOR_EFFECT } from '@/core/videoEdit/recordingCursor'
import { RECORDING_ZOOM_EFFECT } from '@/core/videoEdit/recordingZoom'
import { openApplicationSurface } from '@/features/navigation'
import type { RecordingDestination } from './recordingService'
import { recordingMediaSpans, recordingRange } from '@/core/screenRecording/range'
import { recordingMovieCursorSources } from './recordingMovieSources'

/** Every track is cut to the shared recorded range and placed from its start. Pause/device gaps remain empty; audio latency is already compensated. */
export function placeRecordingMedia(document: VideoEditDocument, recording: RecordingDocument, media: RecordingMedia[], itemIds: string[], target: RecordingDestination, events: readonly CaptureEvent[] = []): VideoEditDocument {
  if (!target.sequenceId) return document
  const sequence = document.sequences.find(sequence => sequence.id === target.sequenceId)
  if (!sequence) throw new Error('录制期间目标序列已移除，素材尚未导入；请选择其他序列重试')
  const fps = videoEditComposition(document, sequence.id).fps
  const origin = recordingRange(recording).startUs
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
      // A screen clip with its pointer log is a recording clip: the pointer is redrawn exactly where and how it was
      // (the person's own size and colour, no smoothing that would lag behind fast moves) and zooms in on the clicks.
      // The frame stays off until asked for: the picture keeps its full size.
      if (source.kind === 'screen' && imported.recordingCursor) clip.effects = [makeRecordingClipEffect(RECORDING_CURSOR_EFFECT, undefined, { smoothing: 0, ...recording.source?.cursor }), makeRecordingClipEffect(RECORDING_ZOOM_EFFECT, suggestRecordingClipZoom(imported, imported.recordingCursor, events))]
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
  const events: CaptureEvent[] = []
  const cursors = await recordingMovieCursorSources(recording, signal ?? new AbortController().signal, event => { if (event.kind === 'click' || event.kind === 'key') events.push(event) })
  await openVideoEditDocument({ id: target.documentId }, { focus: false })
  const items = await importVideoEditSources(target.documentId, media.map(item => ({ path: item.path })), undefined, signal,
    async (document, ids) => {
      const counts = new Map<RecordingMedia['kind'], number>()
      for (const [index, source] of media.entries()) {
        const cursor = cursors.get(source.id)
        const item = document.items.find(item => item.id === ids[index])
        const imported = document.media.find(value => value.id === item?.mediaId)
        if (cursor && imported) imported.recordingCursor = cursor
        // Recorded files are named by ids on disk; in the editor they read as what they are.
        const count = (counts.get(source.kind) ?? 0) + 1; counts.set(source.kind, count)
        if (item) item.name = `${{ screen: '屏幕', microphone: '麦克风', systemAudio: '系统声音', camera: '摄像头' }[source.kind]} ${count}`
      }
      const before = new Set(document.sequences.flatMap(sequence => sequence.clips.map(clip => clip.id)))
      placeRecordingMedia(document, recording, media, ids, target, events)
      if (target.sequenceId) {
        const microphoneItems = new Set(ids.filter((_, index) => media[index].kind === 'microphone'))
        const composition = videoEditComposition(document, target.sequenceId)
        const clips = composition.clips.filter(clip => !before.has(clip.id) && microphoneItems.has(clip.itemId))
        if (clips.length) {
          const gains = await prepareVideoEditRecordingGain(composition, clips.map(clip => clip.id), signal)
          for (const clip of document.sequences.find(sequence => sequence.id === target.sequenceId)!.clips) {
            const gainDb = gains.get(clip.id)
            if (gainDb !== undefined) clip.gainDb = gainDb
          }
        }
      }
      return document
    })
  await saveVideoEdit(target.documentId)
  if (target.sequenceId) await rememberEditTarget(id, target.documentId, target.sequenceId)
  return items
}

/** The session remembers where it went, so opening the recording again opens that edit. */
async function rememberEditTarget(id: string, documentId: string, sequenceId: string): Promise<void> {
  const read = await getPlatform().documents.readDocument({ id })
  const content = recordingDocumentSchema.parse(read.content)
  if (content.compositions.some(value => value.documentId === documentId && value.compositionId === sequenceId)) return
  content.compositions.push({ documentId, compositionId: sequenceId })
  await getPlatform().documents.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content })
}

/**
 * Recording ends in the editor: a new project sized like the recording (or the edit it was started from),
 * with the pointer already redrawn on the screen clip. Reopening a recording returns to that edit.
 */
export async function openRecordingInEditor(id: string, destination: RecordingDestination | null = null, signal?: AbortSignal): Promise<{ documentId: string; sequenceId?: string }> {
  const read = await getPlatform().documents.readDocument({ id })
  if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
  const recording = recordingDocumentSchema.parse(read.content)
  let target: RecordingDestination | null = null
  if (destination) {
    target = destination
    await importRecordingToVideo(id, target, signal)
  } else {
    const movie = recording.directorRun?.movie
    const previous = recording.compositions.at(-1) ?? (movie?.sequenceIds[0] ? { documentId: movie.documentId, compositionId: movie.sequenceIds[0] } : undefined)
    if (previous) {
      try { await openVideoEditDocument({ id: previous.documentId }, { focus: false }); target = { documentId: previous.documentId, sequenceId: previous.compositionId } }
      catch { target = null } // That edit was deleted: start a fresh one.
    }
    if (!target) {
      const instance = await createVideoEditProject()
      const options = recording.source?.options
      const sequenceId = appendVideoEditSequence(instance.document.id, { name: read.meta.name, ...(options ? { width: options.width, height: options.height, frameRate: { numerator: options.fps, denominator: 1 } } : {}) })
      target = { documentId: instance.document.id, sequenceId, frame: 0 }
      await importRecordingToVideo(id, target, signal)
    }
  }
  await openVideoEditDocument({ id: target.documentId })
  if (target.sequenceId) {
    try { switchVideoEditSequence(target.documentId, target.sequenceId, { fromStart: true }) } catch { /* The sequence was removed; the edit still opens. */ }
  }
  openApplicationSurface('workspace.video_edit')
  return target
}
