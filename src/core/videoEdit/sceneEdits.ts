import { videoEditClipMedia, type VideoEditDocument, type VideoEditClip, type VideoEditSequence } from './document'
import { videoEditClipSourceRange, videoEditClipSpeedValue } from './clipSpeed'
import { videoEditFps, videoEditSourceSeconds } from './time'
import { applyVideoEditTimelineEdit } from './timelineEdits'
import { sceneApplyOptionsSchema, sceneCutsSchema, type SceneApplyOptions } from './sceneDetection'

/** Source clock to the first timeline sample on the other side of a cut. Reverse samples the earlier edge. */
export function videoEditSceneCutFrames(clip: VideoEditClip, sequence: VideoEditSequence, cuts: number[]): number[] {
  sceneCutsSchema.parse(cuts)
  const fps = videoEditFps(sequence.frameRate); const step = videoEditClipSpeedValue(clip) / fps; const head = videoEditSourceSeconds(clip)
  return [...new Set(cuts.map(time => clip.start + (clip.reverse ? Math.floor((head - time) / step + 1e-6) : Math.ceil((time - head) / step - 1e-6))))].filter(frame => frame > clip.start && frame < clip.start + clip.duration).sort((a, b) => a - b)
}
export interface SceneEditResult { document: VideoEditDocument; cutFrames: number[]; clipIds: string[]; markerIds: string[]; itemIds: string[] }
export function applyVideoEditSceneCuts(document: VideoEditDocument, sequenceId: string, clipId: string, cuts: number[], options: SceneApplyOptions): SceneEditResult {
  options = sceneApplyOptionsSchema.parse(options)
  const initial = document.sequences.find(sequence => sequence.id === sequenceId)
  const clip = initial?.clips.find(clip => clip.id === clipId)
  if (!initial || !clip || clip.kind !== 'video' || clip.sourceComponent === 'audio') throw new Error('场景检测只适用于原视频片段。')
  if (initial.tracks.find(track => track.index === clip.track)?.locked) throw new Error('目标片段轨道已锁定，请先解锁。')
  const media = videoEditClipMedia(document, clip)!
  const range = videoEditClipSourceRange(clip, videoEditFps(initial.frameRate))
  const sourceCuts = sceneCutsSchema.parse(cuts).filter(time => time > range.from + 1e-7 && time < range.to - 1e-7).sort((a, b) => a - b)
  const cutFrames = videoEditSceneCutFrames(clip, initial, sourceCuts)
  let sequence = initial
  // Descending cuts keep the original left-side ID; the razor owns linked sound, curves and anchored content.
  if (options.split) for (const frame of [...cutFrames].reverse()) {
    sequence = applyVideoEditTimelineEdit({ ...document, sequences: document.sequences.map(value => value.id === sequenceId ? sequence : value) }, sequenceId, { kind: 'split', clipIds: [clipId], linked: { links: true, groups: false }, frame })
  }
  const originalIds = new Set(initial.clips.map(clip => clip.id))
  const descendants = sequence.clips.filter(value => value.id === clip.id || !originalIds.has(value.id) && value.kind === 'video' && value.itemId === clip.itemId && value.track === clip.track)
  const markers = options.markers ? cutFrames.filter(frame => !(sequence.markers ?? []).some(marker => marker.frame === frame && descendants.some(clip => marker.clipId === clip.id))).map((frame, index) => ({ id: crypto.randomUUID(), clipId: descendants.find(clip => clip.start <= frame && clip.start + clip.duration > frame)!.id, frame, name: `镜头切换 ${index + 1}` })) : []
  if (markers.length) sequence = { ...sequence, markers: [...(sequence.markers ?? []), ...markers] }
  const sourceItem = document.items.find(item => item.id === clip.itemId)!
  const bounds = [...new Set([range.from, ...sourceCuts, range.to])]
  const items = options.subclips ? bounds.slice(0, -1).map((start, index) => ({ ...sourceItem, id: crypto.randomUUID(), name: `${sourceItem.name.slice(0, 180)} · 镜头 ${index + 1}`, mediaId: media.id, sourceRange: { inUs: Math.round(start * 1e6), outUs: Math.round(bounds[index + 1] * 1e6) } })) : []
  return { document: { ...document, items: [...document.items, ...items], sequences: document.sequences.map(value => value.id === sequenceId ? sequence : value) }, cutFrames,
    clipIds: sequence.clips.filter(clip => JSON.stringify(initial.clips.find(before => before.id === clip.id)) !== JSON.stringify(clip)).map(clip => clip.id),
    markerIds: (sequence.markers ?? []).filter(marker => JSON.stringify(initial.markers?.find(before => before.id === marker.id)) !== JSON.stringify(marker)).map(marker => marker.id), itemIds: items.map(item => item.id) }
}
