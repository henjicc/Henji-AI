import { recordingDocumentSchema, recordingNeedsRecovery } from '@/core/screenRecording/document'
import type { RecordingDocument, RecordingMedia } from '@/core/screenRecording/document'
import { videoEditComposition, type VideoEditClip, type VideoEditDocument } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditEmptyTrackIds, videoEditEdgeTracks } from '@/core/videoEdit/tracks'
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
  const previous = document.sequences.find(sequence => sequence.id === target.sequenceId)
  if (!previous) throw new Error('录制期间目标序列已移除，素材尚未导入；请选择其他序列重试')
  const sequence = { ...previous, tracks: previous.tracks.map(track => ({ ...track })), clips: [...previous.clips] }
  document = { ...document, sequences: document.sequences.map(value => value === previous ? sequence : value) }
  const fps = videoEditComposition(document, sequence.id).fps
  const origin = recordingRange(recording).startUs
  const trackIndices = new Map<string, number>()
  const reserved = new Set<number>()
  for (const kind of (['microphone', 'systemAudio', 'screen', 'camera'] as const).filter(kind => media.some(item => item.kind === kind))) {
    const trackKind = kind === 'screen' || kind === 'camera' ? 'video' : 'audio'
    // 只复用整条为空且未锁定的轨道；先预留，避免同次导入的不同声画共用一轨。
    let track = videoEditEmptyTrackIds(sequence, trackKind)
      .map(id => sequence.tracks.find(track => track.id === id)!)
      .find(track => !track.locked && !reserved.has(track.index))
    if (!track) {
      track = videoEditEdgeTracks(sequence, trackKind, 1)[0]
      sequence.tracks.push(track)
    }
    track.name = RECORDING_KIND_NAMES[kind]
    reserved.add(track.index)
    trackIndices.set(kind, track.index)
  }
  // 与 Premiere、DaVinci 一致：链接的是同一时间段的画面和它的声音。会话暂停把每条轨在同一时刻切开，
  // 暂停前后各是一段，各自成组，裁剪或调速一段不带动另一段；同一段里设备空档切出的几截声音仍跟着这段画面。
  // 早期会话没有 pauses，只在各轨空档里记了暂停；同一次暂停在声画两轨上前后差一点，合并成一段再计数。
  const pauses: Array<[number, number]> = []
  for (const [start, end] of [...(recording.pauses ?? []).map(pause => [pause.startUs, pause.endUs] as [number, number]), ...(recording.tracks?.tracks ?? []).flatMap(track => track.gaps.filter(gap => gap.reason === 'pause').map(gap => gap.monoSpanUs))].sort((a, b) => a[0] - b[0])) {
    const last = pauses.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end); else pauses.push([start, end])
  }
  const segmentLinks = new Map<number, VideoEditClip[]>()
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
      sequence.clips.push(clip)
      const segment = pauses.filter(([pauseStart]) => pauseStart < start).length
      segmentLinks.set(segment, [...segmentLinks.get(segment) ?? [], clip])
    }
  }
  for (const clips of segmentLinks.values()) {
    if (clips.length < 2) continue
    const linkId = crypto.randomUUID()
    for (const clip of clips) clip.linkId = linkId
  }
  return document
}
/** 应用崩溃留下的录制在导入前先补齐（与助手的恢复同一实现）；正在录的那一个由主进程拒绝。 */
async function readImportableRecording(id: string): Promise<{ recording: RecordingDocument; name: string }> {
  const read = await getPlatform().documents.readDocument({ id })
  if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
  const recording = recordingDocumentSchema.parse(read.content)
  if (!recordingNeedsRecovery(recording)) return { recording, name: read.meta.name }
  await getPlatform().screenRecording.capture({ operation: 'recover-session', sessionId: id })
  return { recording: recordingDocumentSchema.parse((await getPlatform().documents.readDocument({ id })).content), name: read.meta.name }
}
const RECORDING_KIND_NAMES = { screen: '屏幕', microphone: '麦克风', systemAudio: '系统声音', camera: '摄像头' } as const
/** 素材库里一眼认出是哪次录制的哪一段：带会话名；只有一段就不编号，暂停分成几段才写“第 N 段”，不会和显示器名“屏幕 2”混淆。 */
export function recordingItemNames(session: string, media: readonly Pick<RecordingMedia, 'kind'>[]): string[] {
  const counts = new Map<RecordingMedia['kind'], number>()
  return media.map(source => {
    const count = (counts.get(source.kind) ?? 0) + 1; counts.set(source.kind, count)
    const segmented = media.filter(item => item.kind === source.kind).length > 1
    return `${session ? `${session} · ` : ''}${RECORDING_KIND_NAMES[source.kind]}${segmented ? ` 第 ${count} 段` : ''}`
  })
}
export async function importRecordingToVideo(id: string, target: RecordingDestination, signal?: AbortSignal): Promise<string[]> {
  const { recording, name } = await readImportableRecording(id)
  if (!['stopped', 'interrupted'].includes(recording.status)) throw new Error('请先停止录制或恢复已中断会话')
  const media = recording.media.filter(media => media.durationUs > 0)
  if (!media.length) throw new Error('会话没有已保存的录制片段')
  const events: CaptureEvent[] = []
  const cursors = await recordingMovieCursorSources(recording, signal ?? new AbortController().signal, event => { if (event.kind === 'click' || event.kind === 'key') events.push(event) })
  await openVideoEditDocument({ id: target.documentId }, { focus: false })
  const items = await importVideoEditSources(target.documentId, media.map(item => ({ path: item.path })), undefined, signal,
    async (document, ids) => {
      const names = recordingItemNames(name, media)
      for (const [index, source] of media.entries()) {
        const cursor = cursors.get(source.id)
        const item = document.items.find(item => item.id === ids[index])
        const imported = document.media.find(value => value.id === item?.mediaId)
        if (cursor && imported) imported.recordingCursor = cursor
        // 录制文件在磁盘上按 id 命名，进了剪辑要读得出是什么。
        if (item) item.name = names[index]
      }
      const before = new Set(document.sequences.flatMap(sequence => sequence.clips.map(clip => clip.id)))
      document = placeRecordingMedia(document, recording, media, ids, target, events)
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
/** 返回打开的剪辑与序列；这次真的导入了素材时带 itemIds，回到上次那份剪辑（没有导入）时省略。 */
export async function openRecordingInEditor(id: string, destination: RecordingDestination | null = null, signal?: AbortSignal): Promise<RecordingDestination & { itemIds?: string[] }> {
  const read = await getPlatform().documents.readDocument({ id })
  if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
  const recording = recordingDocumentSchema.parse(read.content)
  let target: RecordingDestination | null = null
  let itemIds: string[] | undefined
  if (destination) {
    target = destination
    itemIds = await importRecordingToVideo(id, target, signal)
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
      itemIds = await importRecordingToVideo(id, target, signal)
    }
  }
  await openVideoEditDocument({ id: target.documentId })
  if (target.sequenceId) {
    try { switchVideoEditSequence(target.documentId, target.sequenceId, { fromStart: true }) } catch { /* The sequence was removed; the edit still opens. */ }
  }
  openApplicationSurface('workspace.video_edit')
  return { ...target, ...(itemIds ? { itemIds } : {}) }
}
