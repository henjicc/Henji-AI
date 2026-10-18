import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS } from './time'
import { createVideoEditSequence, videoEditDocumentSchema, videoEditVisibleTracks, type VideoEditClip, type VideoEditDocument, type VideoEditSequence, type VideoEditComposition } from './document'
import { assertVideoEditClipsEditable } from './lockedTracks'
import { clipSourceSeconds } from './document'
import { videoEditTransitionClipIds } from './transitions'
import { mapVideoEditAnnotationTime } from './annotations'
import { createVideoEditSpeechCaptionRetimer } from './captionSpeech'
import { expandVideoEditContentSelection } from './contentAnchors'
import type { VideoEditCaption } from './timedContent'

/** Shared by matching frames, preview and export (floor selects the child's half-open frame). */
export function videoEditSequenceFrameAtSeconds(seconds: number, fps: number): number {
  return Math.max(0, Math.min(Math.floor(fps * VIDEO_EDIT_MAX_SEQUENCE_SECONDS) - 1, Math.floor(seconds * fps + 1e-7)))
}
export function videoEditNestedFrame(parent: Pick<VideoEditComposition, 'fps'>, clip: VideoEditClip, child: Pick<VideoEditComposition, 'fps'>, frame: number): number {
  // A child may be shortened after nesting. Keep the parent's edit and source clock; its now-empty tail is transparent.
  return videoEditSequenceFrameAtSeconds(clipSourceSeconds(clip, frame, parent.fps), child.fps)
}
/** Existing sequence rows are a projection; create a persisted item only when it is actually placed. */
export function ensureVideoEditSequenceItem(document: VideoEditDocument, sequenceId: string): { document: VideoEditDocument; itemId: string } {
  const sequence = document.sequences.find(sequence => sequence.id === sequenceId)
  if (!sequence) throw new Error('目标序列不存在。')
  const existing = document.items.find(item => item.kind === 'sequence' && item.sequenceId === sequenceId)
  if (existing) return { document, itemId: existing.id }
  const item = { id: crypto.randomUUID(), name: sequence.name, kind: 'sequence' as const, sequenceId, ...(sequence.binId ? { binId: sequence.binId } : {}) }
  return { document: { ...document, items: [...document.items, item] }, itemId: item.id }
}
export function nestVideoEditClips(document: VideoEditDocument, sequenceId: string, clipIds: readonly string[], name: string): { document: VideoEditDocument; sequence: VideoEditSequence; clip: VideoEditClip; movedClipIds: string[] } {
  const parent = document.sequences.find(sequence => sequence.id === sequenceId)
  if (!parent) throw new Error('目标序列不存在。')
  const ids = new Set(expandVideoEditContentSelection(parent, clipIds, true))
  const selected = parent.clips.filter(clip => ids.has(clip.id))
  if (!selected.length || selected.length !== ids.size) throw new Error('请选择同一序列中的现有片段。')
  if (selected.some(clip => clip.contentAnchor?.ranges.some(range => !ids.has(range.clipId)))) throw new Error('关联画面与其来源片段须一起嵌套，请一并选择来源或先解除关联。')
  assertVideoEditClipsEditable(parent, [...ids])
  const start = Math.min(...selected.map(clip => clip.start)); const end = Math.max(...selected.map(clip => clip.start + clip.duration))
  const visuals = selected.filter(clip => clip.kind !== 'audio')
  const track = visuals.length ? Math.max(...visuals.map(clip => clip.track)) : parent.tracks.find(track => track.kind === 'video' && !track.locked && track.enabled)?.index
  if (track === undefined) throw new Error('请先添加一条未锁定的视频轨道放置嵌套序列。')
  const host = parent.tracks.find(value => value.index === track)!
  const visible = videoEditVisibleTracks(parent)
  if (!visible.has(track) && visuals.some(clip => visible.has(clip.track))) throw new Error('替换轨道当前隐藏或未独奏，请先让所选画面使用一致的轨道显示状态。')
  const sounds = selected.filter(clip => ['video', 'audio', 'sequence'].includes(clip.kind) && clip.sourceComponent !== 'video' && (clip.volume > 0 || clip.curves?.volume?.some(point => typeof point.value === 'number' && point.value > 0)))
  if (sounds.some(clip => { const source = parent.tracks.find(value => value.index === clip.track)!; return source.enabled && (source.solo && !host.solo || !source.muted && (!host.enabled || host.muted)) })) throw new Error('所选声音与替换轨道的静音或独奏状态不同，请先统一轨道状态，避免嵌套改变混音。')
  const minimum = visuals.length ? Math.min(...visuals.map(clip => clip.kind === 'adjustment' ? clip.adjustment!.fromTrack : clip.track)) : track
  if (parent.clips.some(clip => !ids.has(clip.id) && clip.kind !== 'audio' && clip.track >= minimum && clip.track <= track && clip.start < end && clip.start + clip.duration > start)) throw new Error('所选画面之间还有未选片段，请一并选中，避免嵌套后改变画面叠放顺序。')
  if (parent.clips.some(clip => clip.follow && ids.has(clip.id) !== ids.has(clip.follow.clipId))) throw new Error('跟随片段与被跟踪片段必须一起嵌套。')
  const movedTransitions = (parent.transitions ?? []).filter(transition => videoEditTransitionClipIds(transition).every(id => ids.has(id)))
  if ((parent.transitions ?? []).some(transition => videoEditTransitionClipIds(transition).some(id => ids.has(id)) && !videoEditTransitionClipIds(transition).every(id => ids.has(id)))) throw new Error('过渡两侧片段必须一起嵌套，请扩大选区或先移除边界过渡。')
  const anchored = (value: { clipId?: string }): boolean => Boolean(value.clipId && ids.has(value.clipId))
  const captionAnchored = (value: VideoEditCaption): boolean => value.speech ? value.speech.words.every(word => ids.has(word.clipId)) : anchored(value)
  const selectedSpeech = createVideoEditSpeechCaptionRetimer(parent, { ...parent, clips: selected }, new Map())
  const otherSpeech = createVideoEditSpeechCaptionRetimer(parent, { ...parent, clips: parent.clips.filter(clip => !ids.has(clip.id)) }, new Map())
  const captions = (parent.captions ?? []).flatMap(caption => {
    if (!caption.speech || caption.speech.words.every(word => ids.has(word.clipId)) || caption.speech.words.every(word => !ids.has(word.clipId))) return [caption]
    return [...selectedSpeech(caption), ...otherSpeech(caption).map(cue => ({ ...cue, id: crypto.randomUUID() }))]
  })
  const trackIds = new Map(parent.tracks.map(track => [track.id, crypto.randomUUID()]))
  const child: VideoEditSequence = { ...createVideoEditSequence(name), ...(parent.styleKitId ? { styleKitId: parent.styleKitId } : {}), width: parent.width, height: parent.height, frameRate: parent.frameRate, pixelAspectRatio: parent.pixelAspectRatio, sampleRate: parent.sampleRate, channels: parent.channels,
    ...(parent.captionTrackEnabled !== undefined ? { captionTrackEnabled: parent.captionTrackEnabled } : {}),
    // Recognition is in source microseconds, so moving clips changes neither its identity nor timestamps.
    ...(parent.textTranscription ? { textTranscription: { ...parent.textTranscription, sources: parent.textTranscription.sources.filter(source => selected.some(clip => clip.itemId === source.itemId)) } } : {}),
    tracks: parent.tracks.map(track => ({ ...track, id: trackIds.get(track.id)!, locked: false })),
    clips: selected.map(clip => {
      const moved = { ...clip, start: clip.start - start }
      // Relations crossing the boundary cannot silently select unrelated parent clips.
      if (clip.linkId && parent.clips.some(other => other.linkId === clip.linkId && !ids.has(other.id))) delete moved.linkId
      if (clip.groupId && parent.clips.some(other => other.groupId === clip.groupId && !ids.has(other.id))) delete moved.groupId
      return moved
    }),
    annotations: parent.annotations.filter(anchored).map(value => {
      const mapped = mapVideoEditAnnotationTime(value, frame => frame - start)
      if (mapped.target.kind === 'range' && mapped.target.clipIds) mapped.target.clipIds = mapped.target.clipIds.filter(id => ids.has(id))
      if (mapped.target.kind === 'range' && mapped.target.trackIds) mapped.target.trackIds = mapped.target.trackIds.map(id => trackIds.get(id)!)
      return mapped
    }),
    markers: (parent.markers ?? []).filter(anchored).map(value => ({ ...value, frame: value.frame - start })),
    captions: captions.filter(captionAnchored).map(value => ({ ...value, start: value.start - start })), transitions: movedTransitions,
  }
  const item = { id: crypto.randomUUID(), kind: 'sequence' as const, name, sequenceId: child.id }
  const clip: VideoEditClip = { id: crypto.randomUUID(), itemId: item.id, kind: 'sequence', name, track, start, duration: end - start, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
  const next = { ...parent, clips: [...parent.clips.filter(clip => !ids.has(clip.id)), clip], annotations: parent.annotations.filter(value => !anchored(value)),
    ...(parent.markers ? { markers: parent.markers.filter(value => !anchored(value)) } : {}), ...(parent.captions ? { captions: captions.filter(value => !captionAnchored(value)) } : {}), ...(parent.transitions ? { transitions: parent.transitions.filter(value => !movedTransitions.includes(value)) } : {}),
  }
  const result = videoEditDocumentSchema.parse({ ...document, items: [...document.items, item], sequences: [...document.sequences.map(sequence => sequence.id === sequenceId ? next : sequence), child] })
  return { document: result, sequence: child, clip, movedClipIds: selected.map(clip => clip.id) }
}
