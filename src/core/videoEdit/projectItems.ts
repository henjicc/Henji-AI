import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS } from './time'
import { createVideoEditSequence, videoEditComposition, videoEditDuration, type VideoEditClip, type VideoEditDocument, type VideoEditSequence } from './document'
import { videoEditIsDefaultAudioMapping, videoEditItemAudioLayout, type VideoEditAudioMapping } from './audioChannels'
import { VIDEO_EDIT_FRAME_RATES, videoEditFps } from './time'
import { clampVideoEditSequenceSize } from './sequenceSize'
import { codeMaterialVersion, type CodeMaterialMetadataReader } from './codeMaterialDocument'
import { validateCodeElementOverridesWithoutObservation } from './authorEffects'
import { codeMaterialMediaIds } from './codeMaterialResources'
import { codeMaterialSize } from './codeMaterialTiming'
import { removeVideoEditSequenceClips } from './clipRemoval'

export type VideoEditSequenceSettings = Partial<Pick<VideoEditSequence, 'name' | 'width' | 'height' | 'frameRate' | 'pixelAspectRatio' | 'sampleRate' | 'channels' | 'motionBlur' | 'spaceRender'>> & { binId?: string | null }
export class VideoEditSequenceFrameRateRequired extends Error {
  constructor(readonly settings: VideoEditSequenceSettings) { super('此素材的帧率不固定或未能可靠检测，请在序列设置中选择剪辑帧率。'); this.name = 'VideoEditSequenceFrameRateRequired' }
}
export function videoEditItemUsage(document: VideoEditDocument, itemId: string): Array<{ sequenceId: string; sequenceName: string; clipId: string }> {
  return document.sequences.flatMap(sequence => sequence.clips.filter(clip => clip.itemId === itemId).map(clip => ({ sequenceId: sequence.id, sequenceName: sequence.name, clipId: clip.id })))
}
/** 跨序列删除片段；选了被去掉机位的多机位片段由 reconcileVideoEditTimedContent 统一回到第一个机位。 */
export function removeVideoEditClips(document: VideoEditDocument, ids: readonly string[]): VideoEditDocument {
  const removed = new Set(ids)
  return { ...document, sequences: document.sequences.map(sequence => removeVideoEditSequenceClips(sequence, sequence.clips.filter(clip => removed.has(clip.id)).map(clip => clip.id))) }
}
/** 与 Premiere“清除”素材一致：引用这些素材项的片段（及其标注）一并删除。 */
export function removeVideoEditItems(document: VideoEditDocument, ids: string[]): VideoEditDocument {
  for (const id of ids) if (!document.items.some(item => item.id === id)) throw new Error('素材项不存在。')
  const removedItems = new Set(ids)
  const { sequences } = removeVideoEditClips(document, document.sequences.flatMap(sequence => sequence.clips.filter(clip => removedItems.has(clip.itemId)).map(clip => clip.id)))
  const items = document.items.filter(item => !removedItems.has(item.id))
  const removedMedia = new Set(document.items.filter(item => removedItems.has(item.id)).flatMap(item => [item.mediaId, ...codeMaterialMediaIds(item.code)]))
  const codeImages = new Set([...items.flatMap(item => [...codeMaterialMediaIds(item.code)]), ...sequences.flatMap(sequence => sequence.clips.flatMap(clip => [...codeMaterialMediaIds(clip.code), ...(clip.effects ?? []).flatMap(effect => [...codeMaterialMediaIds(effect.code)])]))])
  return { ...document, sequences, items, media: document.media.filter(media => !removedMedia.has(media.id) || items.some(item => item.mediaId === media.id) || codeImages.has(media.id)) }
}
/** 序列连同其中的片段、标注、标记、字幕与转场一并删除；仍有嵌套序列素材项引用它时拒绝，避免留下悬空引用。 */
export function removeVideoEditSequences(document: VideoEditDocument, ids: readonly string[]): VideoEditDocument {
  const removed = new Set(ids)
  for (const id of removed) if (!document.sequences.some(sequence => sequence.id === id)) throw new Error('目标序列不存在。')
  const nested = document.items.filter(item => item.kind === 'sequence' && item.sequenceId && removed.has(item.sequenceId))
  if (nested.length) {
    const users = [...new Set(nested.flatMap(item => videoEditItemUsage(document, item.id)).filter(use => !removed.has(use.sequenceId)).map(use => `“${use.sequenceName}”`))]
    throw new Error(`序列仍被嵌套序列素材项${nested.map(item => `“${item.name}”`).join('、')}引用${users.length ? `（用在序列${users.join('、')}中）` : ''}。请先删除这些素材项（会连同引用它们的片段一起删除），再删除序列。`)
  }
  const { posterFrame, ...rest } = document
  return { ...rest, ...(posterFrame && !removed.has(posterFrame.sequenceId) ? { posterFrame } : {}), sequences: document.sequences.filter(sequence => !removed.has(sequence.id)) }
}
/** 代码素材定义被引用时不级联：素材项会级联删除片段，先删素材项即可。 */
export function removeVideoEditCodeMaterials(document: VideoEditDocument, ids: readonly string[]): VideoEditDocument {
  const removed = new Set(ids)
  const uses = (code?: { definitionId: string }): boolean => Boolean(code && removed.has(code.definitionId))
  const items = document.items.filter(item => uses(item.code)).map(item => `素材项“${item.name}”`)
  const clips = document.sequences.flatMap(sequence => sequence.clips.filter(clip => uses(clip.code) || clip.effects?.some(effect => uses(effect.code))).map(clip => `序列“${sequence.name}”的片段“${clip.name}”`))
  const templates = (document.templates ?? []).filter(template => template.body.kind === 'code' && removed.has(template.body.definitionId)).map(template => `模板“${template.name}”`)
  const users = [...templates, ...items, ...clips]
  if (users.length) throw new Error(`代码素材仍被${users.slice(0, 10).join('、')}${users.length > 10 ? ` 等 ${users.length} 处` : ''}引用。请先删除这些模板、素材项或片段（删除素材项会连同引用它的片段一起删除），再删除代码素材。`)
  return { ...document, codeMaterials: document.codeMaterials?.filter(definition => !removed.has(definition.id)) }
}
export function removeVideoEditBins(document: VideoEditDocument, ids: string[]): VideoEditDocument {
  for (const id of ids) {
    if (!document.bins.some(bin => bin.id === id)) throw new Error('素材箱不存在。')
    if (document.items.some(item => item.binId === id) || document.sequences.some(sequence => sequence.binId === id) || document.bins.some(bin => bin.parentId === id && !ids.includes(bin.id))) throw new Error('素材箱仍有内容，请先移动或移除其中的素材项和子素材箱。')
  }
  return { ...document, bins: document.bins.filter(bin => !ids.includes(bin.id)) }
}
export function makeVideoEditItemClip(document: VideoEditDocument, itemId: string, sequenceId: string, placement: { frame: number; track?: number; duration?: number; sourceComponent?: 'video' | 'audio'; sourceInUs?: number; sourceOutUs?: number; audioMapping?: VideoEditAudioMapping }, codeMetadata?: CodeMaterialMetadataReader): VideoEditClip {
  const item = document.items.find(item => item.id === itemId)
  if (!item) throw new Error('素材项不存在。')
  const sequence = videoEditComposition(document, sequenceId)
  const media = document.media.find(media => media.id === item.mediaId)
  if (placement.sourceComponent && (item.kind !== 'video' || placement.sourceComponent === 'audio' && media?.hasAudio !== true)) throw new Error('此素材没有已确认可引用的音画分量。')
  const kind = placement.sourceComponent === 'audio' ? 'audio' : item.kind
  const nested = item.kind === 'sequence' ? document.sequences.find(sequence => sequence.id === item.sequenceId) : undefined
  if (item.kind === 'sequence' && !nested) throw new Error('嵌套序列不存在。')
  if (nested?.id === sequenceId) throw new Error('序列不能放进自身。')
  const sourceDuration = nested ? videoEditDuration(nested) / videoEditFps(nested.frameRate) : media && media.kind !== 'image' ? media.durationSeconds : undefined
  const trackKind = kind === 'audio' ? 'audio' : 'video'
  const lowerVisualTracks = (index: number) => sequence.tracks.filter(track => track.kind === 'video' && track.index < index)
  const track = placement.track ?? sequence.tracks.find(track => track.kind === trackKind && !track.locked && track.enabled && (kind !== 'adjustment' || lowerVisualTracks(track.index).length > 0))?.index ?? -1
  if (kind === 'adjustment' && !lowerVisualTracks(track).length) throw new Error('调整图层需要位于画面上方的视频轨道，请先添加上方轨道。')
  const target = sequence.tracks.find(value => value.index === track)
  if (!target || target.kind !== trackKind) {
    // 只说“放进对应轨道”时，调用方只能逐个编号去猜；直接给出可用的轨道编号
    const usable = sequence.tracks.filter(value => value.kind === trackKind && !value.locked).map(value => value.index)
    const label = trackKind === 'audio' ? '音频' : '视频'
    throw new Error(`「${item.name}」需要放在${label}轨道上，${target ? `轨道 ${track} 是${target.kind === 'audio' ? '音频' : '视频'}轨道` : `序列里没有轨道 ${track}`}。`
      + (usable.length ? `可用的${label}轨道编号：${usable.join('、')}；省略 track 会自动选第一条可用轨道。` : `序列里没有未锁定的${label}轨道，请先添加${label}轨道。`))
  }
  if (target.locked) throw new Error('目标轨道已锁定。')
  const program = item.code ? codeMetadata?.(item.code) : undefined
  if (item.kind === 'code' && (!program || !item.code)) throw new Error('代码素材尚未完成源码检查，不能添加占位片段。')
  // 素材项的初始元素覆盖进入新片段，与素材项写入、代码资产导入同一套校验。
  if (item.code && item.elementOverrides) {
    try { validateCodeElementOverridesWithoutObservation(item.elementOverrides, undefined, { luts: document.colorLuts }, codeMaterialVersion(document, item.code).apiVersion, false) }
    catch (cause) { throw new Error(`素材项「${item.name}」的初始元素覆盖无效，请先修改 video_edit.item.element_overrides：${cause instanceof Error ? cause.message : String(cause)}`, { cause }) }
  }
  const sourceInUs = placement.sourceInUs ?? item.sourceRange?.inUs ?? 0
  const sourceOutUs = placement.sourceOutUs ?? item.sourceRange?.outUs ?? (sourceDuration !== undefined ? Math.round(sourceDuration * 1e6) : undefined)
  const ranged = placement.sourceInUs !== undefined || placement.sourceOutUs !== undefined || item.sourceRange !== undefined
  if (ranged && (sourceDuration === undefined || !Number.isSafeInteger(sourceInUs) || sourceInUs < 0 || !Number.isSafeInteger(sourceOutUs) || sourceOutUs! <= sourceInUs || sourceOutUs! > Math.round(sourceDuration * 1e6))) throw new Error('源范围须为音视频素材或序列内的正向整数微秒区间。')
  const codeDuration = program?.mode === 'dynamic' ? program.durationSeconds : undefined
  const availableDuration = ranged ? Math.floor((sourceOutUs! - sourceInUs) / 1e6 * sequence.fps + 1e-6) : codeDuration !== undefined ? Math.max(1, Math.floor(codeDuration * sequence.fps + 1e-6)) : sourceDuration !== undefined ? Math.max(1, Math.floor(sourceDuration * sequence.fps + 1e-6)) : Math.round(sequence.fps * 3)
  const duration = placement.duration ?? availableDuration
  if (availableDuration < 1) throw new Error('源选区短于一个序列帧。')
  if (!Number.isSafeInteger(duration) || duration < 1 || (sourceDuration !== undefined || codeDuration !== undefined) && duration > availableDuration) throw new Error('片段时长必须为源范围内的正整数帧。')
  if (duration < 1) throw new Error('源选区短于一个序列帧。')
  if (!Number.isSafeInteger(placement.frame) || placement.frame < 0 || placement.frame + duration > Math.floor(sequence.fps * VIDEO_EDIT_MAX_SEQUENCE_SECONDS)) throw new Error('素材落点或长度超出序列的 24 小时范围，请先裁剪素材。')
  return { id: crypto.randomUUID(), itemId, name: item.name, kind, ...(placement.sourceComponent ? { sourceComponent: placement.sourceComponent } : {}), ...(placement.audioMapping ? { audioMapping: structuredClone(placement.audioMapping) } : {}), ...(item.code ? { code: structuredClone(item.code) } : {}), ...(item.elementOverrides ? { elementOverrides: structuredClone(item.elementOverrides) } : {}), ...(item.graphic ? { graphic: structuredClone(item.graphic) } : {}), ...(kind === 'adjustment' ? { adjustment: { fromTrack: Math.min(...lowerVisualTracks(track).map(track => track.index)) } } : {}), ...(kind === 'light' ? { spatial: { enabled: true }, lightKind: 'spot', lightIntensity: 1, depth: 1.2, rotationX: -35, rotationY: -20 } : {}), track, start: placement.frame, duration, sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 }, x: kind === 'light' ? -.35 : 0, y: kind === 'light' ? -.45 : 0, scale: 1, rotation: 0, opacity: 1, volume: kind === 'adjustment' || kind === 'light' ? 0 : 1, text: item.kind === 'text' ? '输入文字' : '' }
}
type VideoEditTrack = VideoEditSequence['tracks'][number]
export type VideoEditItemComponents = 'auto' | 'linked' | 'video' | 'audio'
/**
 * `track` is where the item was dropped (its picture, or its first audio clip for sound-only items); without it the
 * targeted `videoTrack` / `audioTrack` apply. Further audio clips go on the following audio tracks.
 */
export interface VideoEditItemPlacement { frame: number; track?: number; videoTrack?: number; audioTrack?: number; duration?: number; sourceInUs?: number; sourceOutUs?: number; components?: VideoEditItemComponents }
/**
 * Audio tracks for `count` clips, Premiere-style: the first is `start` (or the first unlocked, enabled audio track),
 * the rest the following unlocked audio tracks; missing ones are appended below the last audio track.
 */
function audioTracksFor(sequence: VideoEditSequence, count: number, start: number | undefined): { indexes: number[]; added: VideoEditTrack[] } {
  const audio = sequence.tracks.filter(track => track.kind === 'audio').sort((a, b) => a.index - b.index)
  const first = start ?? audio.find(track => !track.locked && track.enabled)?.index
  const from = first === undefined ? audio.length : audio.findIndex(track => track.index === first)
  if (from < 0) throw new Error('请将声音放入音频轨道。')
  const indexes = audio.slice(from).filter((track, offset) => offset === 0 && start !== undefined || !track.locked).map(track => track.index).slice(0, count)
  const added: VideoEditTrack[] = []
  for (let next = Math.max(-1, ...sequence.tracks.filter(track => track.kind === 'audio').map(track => track.index)) + 1; indexes.length < count; next++) {
    while (sequence.tracks.some(track => track.index === next)) next++
    if (!Number.isSafeInteger(next)) throw new Error('轨道编号超出整数范围。')
    added.push({ id: crypto.randomUUID(), name: `音频 ${audio.length + added.length + 1}`, index: next, kind: 'audio', locked: false, enabled: true, muted: false, solo: false })
    indexes.push(next)
  }
  return { indexes, added }
}
/**
 * The clips one project item places, as Premiere does: a video with sound becomes its picture plus one linked audio
 * clip per entry of the item's audio layout, on consecutive audio tracks (`auto` and `linked` alike); `video`/`audio`
 * place one part only. Picture-and-sound clips of older projects stay valid but are no longer created here.
 * Tracks the sound needs are returned in `addedTracks`; the clips already reference them.
 */
export function placeVideoEditItem(document: VideoEditDocument, itemId: string, sequenceId: string, placement: VideoEditItemPlacement, codeMetadata?: CodeMaterialMetadataReader): { clips: VideoEditClip[]; addedTracks: VideoEditTrack[] } {
  const item = document.items.find(item => item.id === itemId)
  if (!item) throw new Error('素材项不存在。')
  const sequence = document.sequences.find(sequence => sequence.id === sequenceId)
  if (!sequence) throw new Error('目标序列不存在。')
  const media = document.media.find(media => media.id === item.mediaId)
  const components = placement.components ?? 'auto'
  const range = { frame: placement.frame, ...(placement.duration !== undefined ? { duration: placement.duration } : {}), ...(placement.sourceInUs !== undefined ? { sourceInUs: placement.sourceInUs } : {}), ...(placement.sourceOutUs !== undefined ? { sourceOutUs: placement.sourceOutUs } : {}) }
  const explicit = placement.track ?? (item.kind === 'audio' || item.kind === 'video' && components === 'audio' ? placement.audioTrack : placement.videoTrack)
  const primaryTrack = explicit !== undefined ? { track: explicit } : {}
  const sounding = media && (item.kind === 'audio' || item.kind === 'video' && media.hasAudio === true)
  if (!sounding || components === 'video') {
    return { clips: [makeVideoEditItemClip(document, itemId, sequenceId, { ...range, ...primaryTrack, ...(item.kind === 'video' && components !== 'auto' ? { sourceComponent: components === 'audio' ? 'audio' as const : 'video' as const } : {}) }, codeMetadata)], addedTracks: [] }
  }
  const layout: Array<VideoEditAudioMapping | undefined> = videoEditItemAudioLayout(item, media) ?? [undefined]
  const mappingOf = (mapping: VideoEditAudioMapping | undefined): { audioMapping?: VideoEditAudioMapping } => mapping && !videoEditIsDefaultAudioMapping(mapping, media.audioStreams) ? { audioMapping: mapping } : {}
  const picture = item.kind === 'video' && components !== 'audio'
  const tracks = audioTracksFor(sequence, layout.length, picture ? placement.audioTrack : explicit)
  const candidate = tracks.added.length ? { ...document, sequences: document.sequences.map(value => value.id === sequenceId ? { ...value, tracks: [...value.tracks, ...tracks.added] } : value) } : document
  const linkId = picture || layout.length > 1 ? crypto.randomUUID() : undefined
  const clips = [
    ...(picture ? [makeVideoEditItemClip(candidate, itemId, sequenceId, { ...range, ...primaryTrack, sourceComponent: 'video' }, codeMetadata)] : []),
    ...layout.map((mapping, index) => makeVideoEditItemClip(candidate, itemId, sequenceId, { ...range, track: tracks.indexes[index], ...(item.kind === 'video' ? { sourceComponent: 'audio' as const } : {}), ...mappingOf(mapping) }, codeMetadata)),
  ]
  return { clips: linkId ? clips.map(clip => ({ ...clip, linkId })) : clips, addedTracks: tracks.added }
}
/** Places items one after another from `placement.frame`; later items reuse the audio tracks earlier ones added. */
export function placeVideoEditItems(document: VideoEditDocument, itemIds: readonly string[], sequenceId: string, placement: VideoEditItemPlacement, codeMetadata?: CodeMaterialMetadataReader): { clips: VideoEditClip[]; addedTracks: VideoEditTrack[]; primaryIds: string[] } {
  let candidate = document; let frame = placement.frame
  const clips: VideoEditClip[] = []; const addedTracks: VideoEditTrack[] = []; const primaryIds: string[] = []
  for (const itemId of itemIds) {
    const placed = placeVideoEditItem(candidate, itemId, sequenceId, { ...placement, frame }, codeMetadata)
    if (placed.addedTracks.length) candidate = { ...candidate, sequences: candidate.sequences.map(value => value.id === sequenceId ? { ...value, tracks: [...value.tracks, ...placed.addedTracks] } : value) }
    clips.push(...placed.clips); addedTracks.push(...placed.addedTracks); primaryIds.push(placed.clips[0].id)
    frame += placed.clips[0].duration
  }
  return { clips, addedTracks, primaryIds }
}
export function videoEditSequenceFromItem(document: VideoEditDocument, itemId: string, settings: VideoEditSequenceSettings = {}, codeMetadata?: CodeMaterialMetadataReader): VideoEditSequence {
  const { binId, ...sequenceSettings } = settings
  const item = document.items.find(item => item.id === itemId)
  if (!item) throw new Error('素材项不存在。')
  const media = document.media.find(media => media.id === item.mediaId)
  const program = item.code ? codeMetadata?.(item.code) : undefined
  if (item.kind === 'code' && !program) throw new Error('代码素材尚未完成源码检查。')
  const sourceRate = media?.frameRate
  const nested = item.kind === 'sequence' ? document.sequences.find(sequence => sequence.id === item.sequenceId) : undefined
  const supportedRate = nested?.frameRate ?? (sourceRate && VIDEO_EDIT_FRAME_RATES.find(rate => Math.abs(videoEditFps(rate) - videoEditFps(sourceRate)) < 0.01))
  if (media?.kind === 'video' && (!supportedRate || media.frameRateMode !== 'sampled-constant') && !settings.frameRate) throw new VideoEditSequenceFrameRateRequired({ name: item.name, ...clampVideoEditSequenceSize(media), ...(item.binId ? { binId: item.binId } : {}) })
  return { ...createVideoEditSequence(item.name), ...(nested ? { width: nested.width, height: nested.height, pixelAspectRatio: nested.pixelAspectRatio, sampleRate: nested.sampleRate, channels: nested.channels } : program ? clampVideoEditSequenceSize(codeMaterialSize(program, createVideoEditSequence(item.name))) : item.graphic ? clampVideoEditSequenceSize(item.graphic) : media && media.width >= 16 && media.height >= 16 ? clampVideoEditSequenceSize(media) : {}), ...(supportedRate ? { frameRate: supportedRate } : media?.kind === 'image' ? { frameRate: { numerator: 60, denominator: 1 } } : {}), ...(item.binId ? { binId: item.binId } : {}), ...sequenceSettings, ...(binId !== undefined ? { binId: binId || undefined } : {}) }
}
export function makeVideoEditItemSequence(document: VideoEditDocument, itemIds: string[], settings: VideoEditSequenceSettings = {}, codeMetadata?: CodeMaterialMetadataReader): VideoEditSequence {
  if (!itemIds.length) throw new Error('请选择至少一个素材项。')
  const sequence = videoEditSequenceFromItem(document, itemIds[0], settings, codeMetadata)
  const placed = placeVideoEditItems({ ...document, sequences: [...document.sequences, sequence] }, itemIds, sequence.id, { frame: 0 }, codeMetadata)
  return { ...sequence, tracks: [...sequence.tracks, ...placed.addedTracks], clips: placed.clips }
}
