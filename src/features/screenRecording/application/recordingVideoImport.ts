import { recordingDocumentSchema, recordingNeedsRecovery } from '@/core/screenRecording/document'
import type { RecordingDocument, RecordingMedia } from '@/core/screenRecording/document'
import { videoEditComposition, type VideoEditClip, type VideoEditDocument, type VideoEditSequence } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditEmptyTrackIds, videoEditEdgeTracks } from '@/core/videoEdit/tracks'
import { getPlatform } from '@/platform'
import { createLogger } from '@/core/logging'
import { importVideoEditSources, placeVideoEditRecordingTake, prepareVideoEditRecordingGain } from '@/features/videoEdit'
import { VIDEO_EDIT_RECORDING_TRACK_NAMES, isVideoEditRecordingPicture, packVideoEditRecordingTake, videoEditRecordingTarget, type VideoEditRecordingTarget } from '@/core/videoEdit/recordingLane'
import { appendVideoEditSequence, createVideoEditProject, makeRecordingClipEffect, openVideoEditDocument, saveVideoEdit, suggestRecordingClipZoom, switchVideoEditSequence } from '@/features/videoEdit'
import type { CaptureEvent } from '@/core/captureLog/events'
import { RECORDING_CURSOR_EFFECT } from '@/core/videoEdit/recordingCursor'
import { RECORDING_ZOOM_EFFECT } from '@/core/videoEdit/recordingZoom'
import { openApplicationSurface } from '@/features/navigation'
import type { RecordingDestination } from './recordingService'
import { recordingDurationUs, recordingMediaSpans, recordingRange } from '@/core/screenRecording/range'
import { recordingCombinePlan, recordingCombinedIntervals, recordingCombinedPartEndUs, type RecordingCombinedFiles } from '@/core/screenRecording/combine'
import { recordingMovieCursorSources } from './recordingMovieSources'

const logger = createLogger('features.screenRecording.import')
type RecordingKind = RecordingMedia['kind']

/**
 * 每类素材一条轨：只复用整条为空且未锁定的轨道；先预留，避免同次导入的不同声画共用一轨。
 * 放在录屏轨上时 `preferred` 给出录屏轨已有的那几条（新的一段与旧的落在同一组轨道上，覆盖才盖得住）。
 */
function recordingTrackIndices(sequence: VideoEditSequence, kinds: readonly RecordingKind[], preferred: Partial<Record<RecordingKind, number>> = {}): Map<RecordingKind, number> {
  const trackIndices = new Map<RecordingKind, number>()
  const reserved = new Set<number>()
  for (const kind of (['microphone', 'systemAudio', 'screen', 'camera'] as const).filter(kind => kinds.includes(kind))) {
    const trackKind = kind === 'screen' || kind === 'camera' ? 'video' : 'audio'
    let track = sequence.tracks.find(track => track.index === preferred[kind] && track.kind === trackKind && !track.locked && !reserved.has(track.index))
      ?? videoEditEmptyTrackIds(sequence, trackKind)
        .map(id => sequence.tracks.find(track => track.id === id)!)
        .find(track => !track.locked && !reserved.has(track.index))
    if (!track) {
      track = videoEditEdgeTracks(sequence, trackKind, 1)[0]
      sequence.tracks.push(track)
    }
    track.name = VIDEO_EDIT_RECORDING_TRACK_NAMES[kind]
    reserved.add(track.index)
    trackIndices.set(kind, track.index)
  }
  return trackIndices
}
function editableSequence(document: VideoEditDocument, sequenceId: string): { document: VideoEditDocument; sequence: VideoEditSequence } {
  const previous = document.sequences.find(sequence => sequence.id === sequenceId)
  if (!previous) throw new Error('录制期间目标序列已移除，素材尚未导入；请选择其他序列重试')
  const sequence = { ...previous, tracks: previous.tracks.map(track => ({ ...track })), clips: [...previous.clips] }
  return { document: { ...document, sequences: document.sequences.map(value => value === previous ? sequence : value) }, sequence }
}
function linkClips(groups: Iterable<VideoEditClip[]>): void {
  for (const clips of groups) {
    if (clips.length < 2) continue
    const linkId = crypto.randomUUID()
    for (const clip of clips) clip.linkId = linkId
  }
}
/**
 * A screen clip with its pointer log is a recording clip: the pointer is redrawn exactly where and how it was
 * (the person's own size and colour, no smoothing that would lag behind fast moves) and zooms in on the clicks.
 * The frame stays off until asked for: the picture keeps its full size.
 */
function addRecordingClipEffects(clip: VideoEditClip, recording: RecordingDocument, imported: VideoEditDocument['media'][number], events: readonly CaptureEvent[]): void {
  if (imported.recordingCursor) clip.effects = [makeRecordingClipEffect(RECORDING_CURSOR_EFFECT, undefined, { smoothing: 0, ...recording.source?.cursor }), makeRecordingClipEffect(RECORDING_ZOOM_EFFECT, suggestRecordingClipZoom(imported, imported.recordingCursor, events))]
}

/**
 * 逐片导入：拼不成一个文件的会话（较早版本录的、合并失败的）每个文件各导一项。
 * Every track is cut to the shared recorded range and placed from its start. Pause/device gaps remain empty; audio latency is already compensated.
 */
export function placeRecordingMedia(document: VideoEditDocument, recording: RecordingDocument, media: RecordingMedia[], itemIds: string[], target: RecordingDestination, events: readonly CaptureEvent[] = [], tracks?: Partial<Record<RecordingKind, number>>): VideoEditDocument {
  if (!target.sequenceId) return document
  const editable = editableSequence(document, target.sequenceId), sequence = editable.sequence
  document = editable.document
  const fps = videoEditComposition(document, sequence.id).fps
  const origin = recordingRange(recording).startUs
  const trackIndices = recordingTrackIndices(sequence, media.map(item => item.kind), tracks)
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
      if (source.kind === 'screen') addRecordingClipEffects(clip, recording, imported, events)
      sequence.clips.push(clip)
      const segment = pauses.filter(([pauseStart]) => pauseStart < start).length
      segmentLinks.set(segment, [...segmentLinks.get(segment) ?? [], clip])
    }
  }
  linkClips(segmentLinks.values())
  return document
}

/** 合并导入的一项：第 group 组合并后的画面或某一路声音，或者照原样导入的分段（media：摄像头，以及中途换了采样格式、拼不成一条的那路声音）。 */
export interface RecordingImportSource { kind: RecordingKind; path: string; id: string; monoUs: number; group?: number; media?: RecordingMedia }

/** 每组一个画面、每路声音一条；摄像头与拼不成一条的那路声音保持分段。 */
export function combinedImportSources(recording: RecordingDocument, groups: readonly RecordingCombinedFiles[]): RecordingImportSource[] {
  return [
    ...groups.flatMap((group, index) => [
      { kind: 'screen' as const, path: group.screen, id: `screen-combined-${index}`, monoUs: group.parts[0].monoUs, group: index },
      ...(['microphone', 'systemAudio'] as const).flatMap(kind => group.audio[kind] ? [{ kind, path: group.audio[kind]!, id: `${kind}-combined-${index}`, monoUs: group.parts[0].monoUs, group: index }] : []),
    ]),
    ...recording.media.filter(item => item.durationUs > 0 && (item.kind === 'camera' || item.kind !== 'screen' && !groups[0]?.audio[item.kind])).map(item => ({ kind: item.kind, path: item.path, id: item.id, monoUs: item.monoUs, media: item })),
  ]
}

/**
 * 合并导入：暂停不占时间线，一次录制一个画面片段，麦克风与系统声各一个与它对齐的片段，同组链接。
 * 声音只在真录到的地方放片段：设备断开的空档照样留空（合并文件里那段是静音占位）。
 */
export function placeCombinedRecording(document: VideoEditDocument, recording: RecordingDocument, groups: readonly RecordingCombinedFiles[], sources: readonly RecordingImportSource[], itemIds: string[], target: RecordingDestination, events: readonly CaptureEvent[] = [], tracks?: Partial<Record<RecordingKind, number>>): VideoEditDocument {
  if (!target.sequenceId) return document
  const editable = editableSequence(document, target.sequenceId), sequence = editable.sequence
  document = editable.document
  const fps = videoEditComposition(document, sequence.id).fps
  const range = recordingRange(recording)
  const paused = (to: number): number => (recording.pauses ?? []).reduce((sum, pause) => sum + Math.max(0, Math.min(to, pause.endUs) - Math.max(range.startUs, pause.startUs)), 0)
  // 时间线位置 = 离开始的会话时间减去其间的暂停；一组里文件时间与它同步前进。
  const groupOffsetUs = groups.map(group => group.parts[0].monoUs - range.startUs - paused(group.parts[0].monoUs))
  const trackIndices = recordingTrackIndices(sequence, sources.map(source => source.kind), tracks)
  const links = new Map<number, VideoEditClip[]>()
  const place = (index: number, group: number, intervals: ReadonlyArray<[number, number]>, sourceOriginUs = 0): void => {
    const source = sources[index]
    const item = document.items.find(item => item.id === itemIds[index])
    const imported = document.media.find(value => value.id === item?.mediaId)
    if (!item || !imported) throw new Error('录制素材导入结果不完整')
    const limit = Math.round(imported.durationSeconds * 1e6)
    for (const [fileStart, fileEnd] of intervals) {
      const sourceInUs = Math.round(fileStart - sourceOriginUs), sourceOutUs = Math.min(limit, Math.round(fileEnd - sourceOriginUs))
      const duration = Math.floor((sourceOutUs - sourceInUs) * fps / 1e6 + 1e-6)
      if (duration < 1) continue
      const clip = makeVideoEditItemClip(document, item.id, sequence.id, { frame: (target.frame ?? 0) + Math.round((groupOffsetUs[group] + fileStart) * fps / 1e6), track: trackIndices.get(source.kind), duration, sourceInUs, sourceOutUs, ...(source.kind === 'screen' || source.kind === 'camera' ? { sourceComponent: 'video' as const } : {}) })
      if (source.kind === 'screen') addRecordingClipEffects(clip, recording, imported, events)
      sequence.clips.push(clip)
      links.set(group, [...links.get(group) ?? [], clip])
    }
  }
  // 暂停两侧的声音在文件里首尾相接（按帧取整差不到一帧），合成一个片段。
  const joined = (intervals: Array<[number, number]>): Array<[number, number]> => intervals.sort((a, b) => a[0] - b[0]).reduce<Array<[number, number]>>((result, interval) => {
    const last = result.at(-1)
    if (last && interval[0] - last[1] <= 1e6 / fps + 1) last[1] = Math.max(last[1], interval[1]); else result.push([interval[0], interval[1]])
    return result
  }, [])
  for (const [index, source] of sources.entries()) {
    if (source.group !== undefined) {
      const group = groups[source.group]
      const spans: Array<[number, number]> = source.kind === 'screen' ? [[range.startUs, range.endUs]]
        : recording.media.filter(item => item.kind === source.kind && item.durationUs > 0).flatMap(item => recordingMediaSpans(recording, item).map(span => [span.startUs, span.endUs] as [number, number]))
      place(index, source.group, joined(spans.flatMap(([start, end]) => recordingCombinedIntervals(group, start, end))))
    } else if (source.media) {
      // 照原样导入的分段用自己的文件，按会话时钟落在所在那组的时间上。
      for (const span of recordingMediaSpans(recording, source.media)) {
        for (const [group, value] of groups.entries()) {
          for (const part of value.parts) {
            const start = Math.max(span.startUs, part.monoUs), end = Math.min(span.endUs, recordingCombinedPartEndUs(part, value.fps))
            if (end > start) place(index, group, [[part.fileUs + start - part.monoUs, part.fileUs + end - part.monoUs]], part.fileUs - part.monoUs + source.media.monoUs)
          }
        }
      }
    }
  }
  linkClips(links.values())
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
const RECORDING_KIND_NAMES = VIDEO_EDIT_RECORDING_TRACK_NAMES
/** 素材库里一眼认出是哪次录制的哪一段：带会话名；只有一段就不编号，拼不成一个文件时才写“第 N 段”，不会和显示器名“屏幕 2”混淆。 */
export function recordingItemNames(session: string, media: readonly Pick<RecordingMedia, 'kind'>[]): string[] {
  const counts = new Map<RecordingMedia['kind'], number>()
  return media.map(source => {
    const count = (counts.get(source.kind) ?? 0) + 1; counts.set(source.kind, count)
    const segmented = media.filter(item => item.kind === source.kind).length > 1
    return `${session ? `${session} · ` : ''}${RECORDING_KIND_NAMES[source.kind]}${segmented ? ` 第 ${count} 段` : ''}`
  })
}

/**
 * 这次导入放进了哪些素材项；`screens` 是画面素材个数（合并后通常是 1，编码器中途重启留下真实空档时按实际分几组）。
 * 拼不成时 `separate` 写明原因（各段照原样导入，原文件都在）。
 */
export interface RecordingImportResult { itemIds: string[]; combined: boolean; screens: number; separate?: string; placement?: RecordingPlacementResult }
/**
 * 放在录屏轨上的实际结果：新一段的范围（序列帧，半开）、接在末尾还是覆盖、盖住了哪些块的哪部分；`note` 说明落点为什么和开始时不同。
 * 认不出录屏轨时没有放进序列（`refused` 是原因），素材只进了素材库。
 */
export type RecordingPlacementResult = { mode: 'append' | 'overwrite'; from: number; to: number; covered: Array<{ name: string; from: number; to: number }>; note?: string } | { refused: string }
/** 回执里的一句话：放在了哪、盖住了什么。 */
export function recordingPlacementText(placement: RecordingPlacementResult, sequenceName: string): string {
  if ('refused' in placement) return `没有放进序列「${sequenceName}」：${placement.refused}素材已进素材库。`
  const where = placement.mode === 'append' ? `接在序列「${sequenceName}」录屏轨末尾（第 ${placement.from}–${placement.to} 帧）` : `从序列「${sequenceName}」第 ${placement.from} 帧起覆盖到第 ${placement.to} 帧`
  const covered = placement.covered.length ? `，盖住了${placement.covered.map(block => `「${block.name}」第 ${block.from}–${block.to} 帧`).join('、')}（撤销或在剪辑里拖回边缘可找回）` : ''
  return `${where}${covered}，画面与声音链接成一组。${placement.note ? `${placement.note}。` : ''}`
}

/** 主进程把暂停分出的画面与声音各拼成一个；只有一个画面文件、或较早版本录的会话对不齐暂停时不需要。 */
async function combinedFiles(id: string, recording: RecordingDocument): Promise<{ groups: RecordingCombinedFiles[] | null; failure?: string }> {
  if (!recordingCombinePlan(recording)) return { groups: null }
  try { return { groups: await getPlatform().screenRecording.capture({ operation: 'combine', sessionId: id }) as RecordingCombinedFiles[] | null } }
  catch (error) {
    const failure = error instanceof Error ? error.message : String(error)
    logger.warn('录制没能拼成一个画面素材，按分段导入', { event: 'recording.import.combine_failed', error, context: { sessionId: id } })
    return { groups: null, failure }
  }
}

export async function importRecordingToVideo(id: string, target: RecordingDestination, signal?: AbortSignal): Promise<RecordingImportResult> {
  const { recording, name } = await readImportableRecording(id)
  if (!['stopped', 'interrupted'].includes(recording.status)) throw new Error('请先停止录制或恢复已中断会话')
  const media = recording.media.filter(media => media.durationUs > 0)
  if (!media.length) throw new Error('会话没有已保存的录制片段')
  const { groups, failure } = await combinedFiles(id, recording)
  signal?.throwIfAborted()
  const sources: RecordingImportSource[] = groups ? combinedImportSources(recording, groups) : media.map(item => ({ kind: item.kind, path: item.path, id: item.id, monoUs: item.monoUs }))
  const events: CaptureEvent[] = []
  const cursors = await recordingMovieCursorSources(recording, signal ?? new AbortController().signal, event => { if (event.kind === 'click' || event.kind === 'key') events.push(event) }, sources.filter(source => source.kind === 'screen'))
  await openVideoEditDocument({ id: target.documentId }, { focus: false })
  let placement: RecordingPlacementResult | undefined
  const items = await importVideoEditSources(target.documentId, sources.map(item => ({ path: item.path })), undefined, signal,
    async (document, ids) => {
      const names = recordingItemNames(name, sources)
      for (const [index, source] of sources.entries()) {
        const cursor = cursors.get(source.id)
        const item = document.items.find(item => item.id === ids[index])
        const imported = document.media.find(value => value.id === item?.mediaId)
        if (cursor && imported) imported.recordingCursor = cursor
        // 录制文件在磁盘上按 id 命名，进了剪辑要读得出是什么。
        if (item) item.name = names[index]
      }
      const before = new Set(document.sequences.flatMap(sequence => sequence.clips.map(clip => clip.id)))
      // 放在录屏轨上：按导入这一刻的录屏轨定落点与轨道（接在末尾，或从 frame 起覆盖），放好后在同一次编辑里切掉被盖住的部分。
      // 录制期间录屏轨被改过（开始时记下的指纹对不上）就不按旧的绝对帧硬盖，改为接在末尾；认不出录屏轨时不放进序列。
      let sequenceId = target.sequenceId
      let lane: VideoEditRecordingTarget | undefined
      let note: string | undefined
      const laneSequence = target.placement && sequenceId ? document.sequences.find(sequence => sequence.id === sequenceId) : undefined
      if (laneSequence) {
        const source = { ...laneSequence, items: document.items, media: document.media }
        const frames = Math.round(recordingDurationUs(recording) * videoEditComposition(document, laneSequence.id).fps / 1e6)
        try {
          lane = videoEditRecordingTarget(source, target.placement === 'end' ? { at: 'end' } : { at: 'frame', frame: target.frame ?? 0 }, frames)
          if (target.placement === 'overwrite' && target.basis && lane.basis !== target.basis) {
            lane = videoEditRecordingTarget(source, { at: 'end' }, frames)
            note = '录制期间录屏轨被改动过，原先的覆盖位置不再可信，没有覆盖，接在了末尾'
          }
        } catch (error) {
          placement = { refused: error instanceof Error ? error.message : String(error) }
          sequenceId = undefined
        }
      }
      const placed: RecordingDestination = { ...target, ...(lane ? { frame: lane.frame } : {}), ...(sequenceId ? {} : { sequenceId: undefined }) }
      document = groups ? placeCombinedRecording(document, recording, groups, sources, ids, placed, events, lane?.tracks) : placeRecordingMedia(document, recording, media, ids, placed, events, lane?.tracks)
      if (lane && sequenceId) {
        const takeIds = document.sequences.find(sequence => sequence.id === sequenceId)!.clips.filter(clip => !before.has(clip.id)).map(clip => clip.id)
        // 拼不成一个画面时各段首尾相连；录屏轨上的块就叫这次录制的名字，分成几段时各带序号（素材项仍带“· 屏幕”后缀，素材库里分得清）。
        document = packVideoEditRecordingTake(document, sequenceId, takeIds)
        const pictures = document.sequences.find(sequence => sequence.id === sequenceId)!.clips.filter(clip => takeIds.includes(clip.id) && isVideoEditRecordingPicture(document, clip)).sort((a, b) => a.start - b.start).map(clip => clip.id)
        if (name) document = { ...document, sequences: document.sequences.map(sequence => sequence.id === sequenceId ? { ...sequence, clips: sequence.clips.map(clip => pictures.includes(clip.id) ? { ...clip, name: pictures.length > 1 ? `${name}（${pictures.indexOf(clip.id) + 1}）` : name } : clip) } : sequence) }
        const settled = placeVideoEditRecordingTake(document, sequenceId, takeIds, lane.mode)
        document = settled.document
        placement = { mode: lane.mode, from: settled.from, to: settled.to, covered: settled.covered, ...(note ? { note } : {}) }
      }
      if (sequenceId) {
        const microphoneItems = new Set(ids.filter((_, index) => sources[index].kind === 'microphone'))
        const composition = videoEditComposition(document, sequenceId)
        const clips = composition.clips.filter(clip => !before.has(clip.id) && microphoneItems.has(clip.itemId))
        if (clips.length) {
          const gains = await prepareVideoEditRecordingGain(composition, clips.map(clip => clip.id), signal)
          for (const clip of document.sequences.find(sequence => sequence.id === sequenceId)!.clips) {
            const gainDb = gains.get(clip.id)
            if (gainDb !== undefined) clip.gainDb = gainDb
          }
        }
      }
      return document
    })
  await saveVideoEdit(target.documentId)
  if (target.sequenceId) await rememberEditTarget(id, target.documentId, target.sequenceId)
  const separateAudio = groups ? (['microphone', 'systemAudio'] as const).filter(kind => media.some(item => item.kind === kind) && !groups[0].audio[kind]).map(kind => RECORDING_KIND_NAMES[kind]) : []
  const separate = failure ? `没能拼成一个画面素材（${failure}），各段照原样导入，原文件都在` : separateAudio.length ? `${separateAudio.join('、')}中途换了采样格式，拼不成一条，照原样分段导入` : undefined
  return { itemIds: items, combined: Boolean(groups), screens: sources.filter(source => source.kind === 'screen').length, ...(separate ? { separate } : {}), ...(placement ? { placement } : {}) }
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
/** 返回打开的剪辑与序列；这次真的导入了素材时带导入结果，回到上次那份剪辑（没有导入）时省略。 */
export async function openRecordingInEditor(id: string, destination: RecordingDestination | null = null, signal?: AbortSignal): Promise<RecordingDestination & { imported?: RecordingImportResult }> {
  const read = await getPlatform().documents.readDocument({ id })
  if (read.meta.kind !== 'screen_recording') throw new Error('请选择录制会话')
  const recording = recordingDocumentSchema.parse(read.content)
  let target: RecordingDestination | null = null
  let imported: RecordingImportResult | undefined
  if (destination) {
    target = destination
    imported = await importRecordingToVideo(id, target, signal)
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
      imported = await importRecordingToVideo(id, target, signal)
    }
  }
  await openVideoEditDocument({ id: target.documentId })
  if (target.sequenceId) {
    try { switchVideoEditSequence(target.documentId, target.sequenceId, { fromStart: true }) } catch { /* The sequence was removed; the edit still opens. */ }
  }
  openApplicationSurface('workspace.video_edit')
  return { ...target, ...(imported ? { imported } : {}) }
}
