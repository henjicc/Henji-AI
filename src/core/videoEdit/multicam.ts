import { createVideoEditSequence, splitVideoEditClip, videoEditComposition, videoEditDocumentSchema, videoEditNestedComposition, type VideoEditClip, type VideoEditDocument, type VideoEditSequence } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { assertVideoEditClipsEditable } from './lockedTracks'
import { videoEditFps } from './time'
import type { VideoEditAudioActivity } from './audioDucking'

export interface VideoEditMulticamCameraInput { itemId: string; name?: string; speaker?: string; inPointSeconds?: number; timecodeSeconds?: number }
export interface VideoEditMulticamCreate { name: string; cameras: VideoEditMulticamCameraInput[]; sync: 'audio' | 'in_points' | 'timecode'; audioCameraIndex?: number }
/** Offset is the start of each selected source range on a common clock (seconds). */
export function createVideoEditMulticam(document: VideoEditDocument, templateId: string, options: VideoEditMulticamCreate, audioOffsets?: number[]): { document: VideoEditDocument; sequence: VideoEditSequence; itemId: string } {
  if (options.cameras.length < 2 || options.cameras.length > 9 || new Set(options.cameras.map(camera => camera.itemId)).size !== options.cameras.length) throw new Error('请选择2–9个不同的视频素材。')
  const template = document.sequences.find(sequence => sequence.id === templateId)
  if (!template) throw new Error('目标序列不存在。')
  const source = options.cameras.map(camera => {
    const item = document.items.find(item => item.id === camera.itemId); const media = document.media.find(media => media.id === item?.mediaId)
    if (item?.kind !== 'video' || !media || media.durationSeconds <= 0) throw new Error('多机位只接受具有时长的视频素材。')
    return { item, media, inSeconds: (item.sourceRange?.inUs ?? 0) / 1e6 }
  })
  const offsets = options.sync === 'audio' ? audioOffsets : options.cameras.map((camera, index) => {
    const point = options.sync === 'timecode' ? camera.timecodeSeconds : camera.inPointSeconds ?? source[index].inSeconds
    if (point === undefined || !Number.isFinite(point) || point < 0) throw new Error('每个机位都需要有效的同步时间。')
    if (options.sync === 'in_points' && (point < source[index].inSeconds || point >= (source[index].item.sourceRange?.outUs ?? source[index].media.durationSeconds * 1e6) / 1e6)) throw new Error('同步入点须在所选素材范围内。')
    return options.sync === 'timecode' ? point + source[index].inSeconds : source[index].inSeconds - point
  })
  if (!offsets || offsets.length !== source.length || offsets.some(value => !Number.isFinite(value))) throw new Error('声音同步结果无效。')
  const audio = options.audioCameraIndex ?? 0
  if (!Number.isInteger(audio) || audio < 0 || audio >= source.length) throw new Error('主音频机位超出范围。')
  const fps = videoEditFps(template.frameRate); const origin = Math.min(...offsets)
  const sequence: VideoEditSequence = { ...createVideoEditSequence(options.name), width: template.width, height: template.height, frameRate: template.frameRate, pixelAspectRatio: template.pixelAspectRatio, sampleRate: template.sampleRate, channels: template.channels,
    tracks: source.map((_, index) => ({ id: crypto.randomUUID(), name: `机位 ${index + 1}`, index, kind: 'video', enabled: true, muted: false, solo: false, locked: false })),
  }
  const extended = { ...document, sequences: [...document.sequences, sequence] }
  sequence.clips = source.map((entry, index) => ({ ...makeVideoEditItemClip(extended, entry.item.id, sequence.id, { frame: Math.round((offsets[index] - origin) * fps), track: index }), sourceInUs: Math.round(entry.inSeconds * 1e6) }))
  sequence.multicam = { cameras: options.cameras.map((camera, index) => ({ id: crypto.randomUUID(), name: camera.name ?? `机位 ${index + 1}`, clipId: sequence.clips[index].id, ...(camera.speaker ? { speaker: camera.speaker } : {}) })), audioCameraId: undefined }
  sequence.multicam.audioCameraId = sequence.multicam.cameras[audio].id
  const item = { id: crypto.randomUUID(), name: sequence.name, kind: 'sequence' as const, sequenceId: sequence.id }
  const result = videoEditDocumentSchema.parse({ ...extended, items: [...document.items, item] })
  return { document: result, sequence: result.sequences.at(-1)!, itemId: item.id }
}

export function videoEditMulticamSource(document: VideoEditDocument, clip: VideoEditClip): VideoEditSequence | undefined {
  const item = document.items.find(item => item.id === clip.itemId)
  return clip.kind === 'sequence' ? document.sequences.find(sequence => sequence.id === item?.sequenceId && sequence.multicam) : undefined
}
export function changeVideoEditMulticamCamera(document: VideoEditDocument, sequenceId: string, clipId: string, cameraId: string, cutFrame?: number): VideoEditSequence {
  const sequence = document.sequences.find(sequence => sequence.id === sequenceId); const clip = sequence?.clips.find(clip => clip.id === clipId)
  if (!sequence || !clip) throw new Error('多机位片段已移除。')
  const source = videoEditMulticamSource(document, clip)
  if (!source?.multicam?.cameras.some(camera => camera.id === cameraId)) throw new Error('请选择此多机位源序列中的机位。')
  assertVideoEditClipsEditable(sequence, [clipId])
  if (cutFrame !== undefined && (!Number.isInteger(cutFrame) || cutFrame < clip.start || cutFrame >= clip.start + clip.duration)) throw new Error('切换位置须在多机位片段内。')
  if ((clip.multicamCameraId ?? source.multicam.cameras[0].id) === cameraId) return sequence
  const next = cutFrame !== undefined && cutFrame > clip.start ? splitVideoEditClip(sequence, clipId, cutFrame) : sequence
  const id = cutFrame !== undefined && cutFrame > clip.start ? next.clips.find(value => value.itemId === clip.itemId && value.track === clip.track && value.start === cutFrame)!.id : clipId
  return { ...next, clips: next.clips.map(value => value.id === id ? { ...value, multicamCameraId: cameraId } : value) }
}

export interface VideoEditMulticamActivity { cameraId: string; activity: VideoEditAudioActivity[]; levels: { startSeconds: number; endSeconds: number; rms: number }[]; speaker?: string }
export interface VideoEditMulticamCut { frame: number; cameraId: string }
/** Silence keeps the last angle; active ties keep it too. Hysteresis + minimum shot length avoid chatter. */
export function suggestVideoEditMulticamCuts(duration: number, fps: number, initial: string, cameras: VideoEditMulticamActivity[], minimumSeconds = 2, speech?: { startSeconds: number; endSeconds: number; speaker: string }[]): VideoEditMulticamCut[] {
  if (!Number.isInteger(duration) || duration < 1 || !Number.isFinite(fps) || fps <= 0 || !Number.isFinite(minimumSeconds) || minimumSeconds < .2 || minimumSeconds > 30 || !cameras.some(camera => camera.cameraId === initial)) throw new Error('自动切换范围或最短镜头时长无效。')
  if (speech?.some(turn => !cameras.some(camera => camera.speaker === turn.speaker))) throw new Error('说话人没有对应机位，请先标注或改按音量切换。')
  const cuts: VideoEditMulticamCut[] = [{ frame: 0, cameraId: initial }]; const hold = Math.max(1, Math.round(minimumSeconds * fps))
  for (let frame = hold; frame < duration; frame += Math.max(1, Math.round(fps / 5))) {
    const seconds = frame / fps; const last = cuts.at(-1)!
    if (frame - last.frame < hold) continue
    const turn = speech?.find(turn => turn.startSeconds <= seconds && seconds < turn.endSeconds)
    let next = turn ? cameras.find(camera => camera.speaker === turn.speaker)?.cameraId : undefined
    if (!speech) {
      const active = cameras.filter(camera => camera.activity.some(range => range.startSeconds <= seconds && seconds < range.endSeconds))
      const level = (camera: VideoEditMulticamActivity): number => camera.levels.find(range => range.startSeconds <= seconds && seconds < range.endSeconds)?.rms ?? 0
      active.sort((a, b) => level(b) - level(a))
      const current = active.find(camera => camera.cameraId === last.cameraId)
      if (active[0] && (!current || level(active[0]) > level(current) * 1.4)) next = active[0].cameraId
    }
    if (next && next !== last.cameraId) cuts.push({ frame, cameraId: next })
  }
  return cuts
}
export function applyVideoEditMulticamCuts(document: VideoEditDocument, sequenceId: string, clipId: string, cuts: VideoEditMulticamCut[]): VideoEditSequence {
  const parent = document.sequences.find(sequence => sequence.id === sequenceId); const clip = parent?.clips.find(clip => clip.id === clipId)
  if (!parent || !clip || !cuts.length || cuts[0].frame !== 0 || cuts.some((cut, index) => !Number.isInteger(cut.frame) || cut.frame < 0 || cut.frame >= clip.duration || index > 0 && cut.frame <= cuts[index - 1].frame)) throw new Error('自动机位段必须按时间排列并完整覆盖片段。')
  assertVideoEditClipsEditable(parent, [clipId])
  if (parent.clips.length - 1 + cuts.length > 500) throw new Error('切换后超过500个片段，请增加最短镜头时长或缩短分析范围。')
  const source = videoEditMulticamSource(document, clip)
  if (!source?.multicam || cuts.some(cut => !source.multicam!.cameras.some(camera => camera.id === cut.cameraId))) throw new Error('自动切换引用了不存在的机位。')
  let next = parent
  for (const cut of cuts.slice(1).reverse()) next = splitVideoEditClip(next, clipId, clip.start + cut.frame)
  return { ...next, clips: next.clips.map(value => value.itemId === clip.itemId && value.track === clip.track && value.start >= clip.start && value.start < clip.start + clip.duration ? { ...value, multicamCameraId: [...cuts].reverse().find(cut => cut.frame <= value.start - clip.start)!.cameraId } : value) }
}
/** Shared export/preview assertion helper: the child uses the selected picture and the fixed main audio. */
export function videoEditMulticamComposition(document: VideoEditDocument, sequenceId: string, clip: VideoEditClip): ReturnType<typeof videoEditNestedComposition> {
  return videoEditNestedComposition(videoEditComposition(document, sequenceId), clip)
}
