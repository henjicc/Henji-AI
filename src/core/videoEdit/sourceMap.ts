import { audibleVideoEditClips, videoEditClipMedia, videoEditDuration, videoEditNestedComposition, videoEditPictureFilter, type VideoEditClip, type VideoEditComposition } from './document'
import { videoEditClipFrameBoundaryAtSource, videoEditClipSourceSecondsAt, videoEditClipSourceSecondsAtTime, videoEditClipSpeedValue } from './clipSpeed'
import { videoEditNestedFrame } from './nestedSequences'
import { VIDEO_EDIT_MAX_SEQUENCE_DEPTH } from './sequenceGraph'
import { videoEditHandleFrame, videoEditTransitionMedium, videoEditTransitionWindow } from './transitions'

export type VideoEditSourceMapMedium = 'video' | 'audio'
export const VIDEO_EDIT_SOURCE_MAP_ENTRY_BUDGET = 20000
function assertEntryBudget(count: number): void {
  if (count > VIDEO_EDIT_SOURCE_MAP_ENTRY_BUDGET) throw new Error(`此区间结构来源超过 ${VIDEO_EDIT_SOURCE_MAP_ENTRY_BUDGET} 项的单次查询预算；请缩小 from/to 或按 mediums 分开查询，未截断结果。`)
}
export interface VideoEditSourceMapRange { from: number; to: number }
export interface VideoEditSourceMapStep {
  sequenceId: string; clipId: string; itemId: string; track: number; fps: number
  /** The immutable clip snapshot supplies the same clock used by preview and mixAudio. */
  clip: VideoEditClip
  childFps?: number; childDuration?: number
}
export interface VideoEditSourceMapEntry {
  id: string; medium: VideoEditSourceMapMedium; kind: VideoEditClip['kind']; path: readonly VideoEditSourceMapStep[]
  /** Root sequence frames; audio boundaries may be fractional, video boundaries are integers. */
  timeline: VideoEditSourceMapRange
  mediaId?: string; sourceKind: 'media' | 'generated' | 'static'
  source: { fromUs: number; toUs: number; direction: 'forward' | 'reverse' | 'static'; basis: 'sampled_envelope' | 'continuous_audio' | 'generated_clock' | 'asset_point' }
  firstSample?: { frame: number; sourceUs: number }
  mediaDuration?: number
}
const micros = (seconds: number): number => Math.max(0, Math.round(seconds * 1e6))

function nextFrame(step: VideoEditSourceMapStep, frame: number): number {
  const child = videoEditNestedFrame({ fps: step.fps }, step.clip, { fps: step.childFps! }, frame)
  return frame < step.clip.start || frame >= step.clip.start + step.clip.duration ? Math.min(step.childDuration! - 1, child) : child
}
function localFrame(path: readonly VideoEditSourceMapStep[], rootFrame: number): number {
  return path.slice(0, -1).reduce((frame, step) => nextFrame(step, frame), rootFrame)
}
/** Current sequence clock of the final placed clip, including nested frame quantization. */
export function videoEditSourceMapLocalFrame(entry: Pick<VideoEditSourceMapEntry, 'path'>, rootFrame: number): number {
  return localFrame(entry.path, rootFrame)
}
function localSeconds(path: readonly VideoEditSourceMapStep[], rootSeconds: number): number {
  return path.slice(0, -1).reduce((seconds, step) => videoEditClipSourceSecondsAtTime(step.clip, seconds, step.fps), rootSeconds)
}
function rootSeconds(ancestors: readonly VideoEditSourceMapStep[], seconds: number): number {
  return [...ancestors].reverse().reduce((time, step) => videoEditClipFrameBoundaryAtSource(step.clip, time, step.fps) / step.fps, seconds)
}
function sampledSource(entry: Pick<VideoEditSourceMapEntry, 'path' | 'mediaDuration'>, rootFrame: number): number {
  const leaf = entry.path.at(-1)!
  return videoEditClipSourceSecondsAt(leaf.clip, videoEditHandleFrame(leaf.clip, localFrame(entry.path, rootFrame), leaf.fps, entry.mediaDuration), leaf.fps)
}
/** Same clamped source clock as the picture renderer, including transition handles. */
export function videoEditSourceMapSampleSeconds(entry: VideoEditSourceMapEntry, rootFrame: number): number { return sampledSource(entry, rootFrame) }
/** A monotonic clock may skip or repeat child frames. Never walk every output frame. */
function firstTrue(range: VideoEditSourceMapRange, predicate: (frame: number) => boolean): number {
  let low = range.from; let high = range.to
  while (low < high) { const middle = low + Math.floor((high - low) / 2); if (predicate(middle)) high = middle; else low = middle + 1 }
  return low
}
function intersectFrames(range: VideoEditSourceMapRange, at: (frame: number) => number, low: number, high: number, descending: boolean): VideoEditSourceMapRange {
  return descending
    ? { from: firstTrue(range, frame => at(frame) < high), to: firstTrue(range, frame => at(frame) < low) }
    : { from: firstTrue(range, frame => at(frame) >= low), to: firstTrue(range, frame => at(frame) >= high) }
}
function clipWindows(composition: VideoEditComposition, medium: VideoEditSourceMapMedium): Map<string, VideoEditSourceMapRange> {
  const result = new Map(composition.clips.map(clip => [clip.id, { from: clip.start, to: clip.start + clip.duration }]))
  for (const transition of composition.transitions ?? []) {
    if (videoEditTransitionMedium(transition.kind) !== medium) continue
    const window = videoEditTransitionWindow(composition, transition)
    for (const clip of [window.left, window.right]) {
      const range = result.get(clip.id)!
      range.from = Math.min(range.from, window.start); range.to = Math.max(range.to, window.end)
    }
  }
  return result
}
function originalClipId(composition: VideoEditComposition, clip: VideoEditClip): string {
  const saved = composition.sequences?.find(sequence => sequence.id === composition.id)
  return saved?.clips.find(value => value.id === clip.id || composition.multicam && `${value.id}:master` === clip.id)?.id ?? clip.id
}
function stepFor(composition: VideoEditComposition, clip: VideoEditClip): VideoEditSourceMapStep {
  return { sequenceId: composition.id, clipId: originalClipId(composition, clip), itemId: clip.itemId, track: clip.track, fps: composition.fps, clip }
}
function candidateClips(composition: VideoEditComposition, medium: VideoEditSourceMapMedium): VideoEditClip[] {
  if (medium === 'audio') return audibleVideoEditClips(composition)
  const picture = videoEditPictureFilter(composition)
  return composition.clips.filter(clip => clip.kind !== 'audio' && picture.has(clip))
}
function leafEntry(composition: VideoEditComposition, clip: VideoEditClip, medium: VideoEditSourceMapMedium,
  path: readonly VideoEditSourceMapStep[], timeline: VideoEditSourceMapRange, rootFps: number): VideoEditSourceMapEntry | undefined {
  const media = videoEditClipMedia(composition, clip)
  if (medium === 'audio' && (!media || media.hasAudio === false || media.kind === 'image')) return undefined
  const sourceKind = media?.kind === 'image' ? 'static' : media ? 'media' : 'generated'
  const descending = path.reduce((direction, step) => step.clip.reverse ? -direction : direction, 1) < 0
  const entry: VideoEditSourceMapEntry = {
    id: `${medium}:${path.map(step => `${encodeURIComponent(step.sequenceId)}/${encodeURIComponent(step.clipId)}`).join('/')}:${timeline.from}:${timeline.to}`,
    medium, kind: clip.kind, path, timeline, sourceKind, ...(media ? { mediaId: media.id, mediaDuration: media.durationSeconds } : {}),
    source: { fromUs: 0, toUs: 0, direction: sourceKind === 'static' ? 'static' : descending ? 'reverse' : 'forward', basis: sourceKind === 'static' ? 'asset_point' : sourceKind === 'generated' ? 'generated_clock' : medium === 'audio' ? 'continuous_audio' : 'sampled_envelope' },
  }
  if (sourceKind === 'static') return entry
  let first: number; let last: number
  if (medium === 'video') {
    first = sampledSource(entry, timeline.from); last = sampledSource(entry, timeline.to - 1)
    entry.firstSample = { frame: timeline.from, sourceUs: micros(first) }
    entry.source.fromUs = micros(Math.min(first, last))
    entry.source.toUs = micros(Math.max(first, last) + videoEditClipSpeedValue(clip) / composition.fps)
  } else {
    first = videoEditClipSourceSecondsAtTime(clip, localSeconds(path, timeline.from / rootFps), composition.fps)
    last = videoEditClipSourceSecondsAtTime(clip, localSeconds(path, timeline.to / rootFps), composition.fps)
    entry.source.fromUs = micros(Math.min(first, last)); entry.source.toUs = micros(Math.max(first, last))
  }
  return entry
}

/** Structural contributions only: no alpha, mask, blend, spatial occlusion or audibility claim. */
function buildBranch(root: VideoEditComposition, rootClip: VideoEditClip, medium: VideoEditSourceMapMedium, range: VideoEditSourceMapRange, visitor?: VideoEditPictureVisitor): VideoEditSourceMapEntry[] {
  const result: VideoEditSourceMapEntry[] = []
  function visit(composition: VideoEditComposition, clips: readonly VideoEditClip[], ancestors: readonly VideoEditSourceMapStep[], window: VideoEditSourceMapRange, sequenceIds: readonly string[]): void {
    if (sequenceIds.includes(composition.id) || sequenceIds.length >= VIDEO_EDIT_MAX_SEQUENCE_DEPTH) throw new Error('来源映射遇到循环嵌套或超过八层，请检查序列引用。')
    if (ancestors.length) visitor?.sequence({ composition, path: ancestors, timeline: window })
    const windows = clipWindows(composition, medium)
    const descending = ancestors.reduce((direction, step) => step.clip.reverse ? -direction : direction, 1) < 0
    for (const clip of clips) {
      const step = stepFor(composition, clip); const path = [...ancestors, step]
      const extent = windows.get(clip.id)!
      let selected: VideoEditSourceMapRange
      if (medium === 'video') selected = intersectFrames(window, frame => localFrame(path, frame), extent.from, extent.to, descending)
      else {
        const a = rootSeconds(ancestors, extent.from / composition.fps) * root.fps
        const b = rootSeconds(ancestors, extent.to / composition.fps) * root.fps
        selected = { from: Math.max(window.from, Math.min(a, b)), to: Math.min(window.to, Math.max(a, b)) }
      }
      if (selected.to <= selected.from) continue
      const child = videoEditNestedComposition(composition, clip)
      if (visitor) {
        const entry = leafEntry(composition, clip, medium, path, selected, root.fps)
        if (entry) visitor.clip(composition, entry, window)
      }
      if (child) {
        step.childFps = child.fps; step.childDuration = videoEditDuration(child)
        // Nested picture handles hold the child's last frame outside the parent clip, while a
        // shortened child's empty nominal tail stays transparent. Split that discontinuity.
        const edges = medium === 'video' ? [selected.from, ...[clip.start, clip.start + clip.duration].map(boundary =>
          firstTrue(selected, frame => descending ? localFrame(path, frame) < boundary : localFrame(path, frame) >= boundary)), selected.to] : [selected.from, selected.to]
        const ordered = [...new Set(edges)].sort((a, b) => a - b)
        for (let index = 1; index < ordered.length; index++) if (ordered[index] > ordered[index - 1]) visit(child, candidateClips(child, medium), path, { from: ordered[index - 1], to: ordered[index] }, [...sequenceIds, composition.id])
      } else {
        if (medium === 'audio') {
          const media = videoEditClipMedia(composition, clip)
          if (!media || media.hasAudio === false) continue
          // Out-of-source transition audio is silence, unlike held picture handles.
          const a = rootSeconds(path, 0) * root.fps; const b = rootSeconds(path, media.durationSeconds) * root.fps
          selected = { from: Math.max(selected.from, Math.min(a, b)), to: Math.min(selected.to, Math.max(a, b)) }
        }
        if (selected.to > selected.from) { const entry = leafEntry(composition, clip, medium, path, selected, root.fps); if (entry) { assertEntryBudget(result.length + 1); result.push(entry) } }
      }
    }
  }
  visit(root, [rootClip], [], range, [])
  return result
}

export interface VideoEditSequenceMapInstance {
  composition: VideoEditComposition
  /** Placed wrappers from the queried sequence to this sequence, excluding its own clips. */
  path: readonly VideoEditSourceMapStep[]
  timeline: VideoEditSourceMapRange
}
interface VideoEditPictureVisitor {
  sequence(instance: VideoEditSequenceMapInstance): void
  clip(composition: VideoEditComposition, entry: VideoEditSourceMapEntry, window: VideoEditSourceMapRange): void
}

/** Uses the picture clock including transition holds; visits caption-only nested sequences too. */
export function visitVideoEditPictureInstances(root: VideoEditComposition, range: VideoEditSourceMapRange, visitor: VideoEditPictureVisitor): void {
  let count = 0
  const bounded: VideoEditPictureVisitor = {
    sequence: instance => { assertEntryBudget(++count); visitor.sequence(instance) },
    clip: (composition, entry, window) => { assertEntryBudget(++count); visitor.clip(composition, entry, window) },
  }
  bounded.sequence({ composition: root, path: [], timeline: range })
  for (const clip of candidateClips(root, 'video')) buildBranch(root, clip, 'video', range, bounded)
}

/** Project sequence events through the same quantized nested clock as rendered picture. */
export function projectVideoEditSequenceMapRange(instance: VideoEditSequenceMapInstance, local: VideoEditSourceMapRange): VideoEditSourceMapRange | undefined {
  const at = (frame: number): number => instance.path.reduce((value, step) => nextFrame(step, value), frame)
  const descending = instance.path.reduce((direction, step) => step.clip.reverse ? -direction : direction, 1) < 0
  if (local.from === local.to) {
    const first = at(instance.timeline.from); const last = at(instance.timeline.to - 1)
    if (local.from < Math.min(first, last) || local.from > Math.max(first, last) + (descending ? 0 : 1)) return undefined
    const frame = firstTrue(instance.timeline, frame => descending ? at(frame) < local.from : at(frame) >= local.from)
    return frame < instance.timeline.to ? { from: frame, to: frame } : undefined
  }
  const range = intersectFrames(instance.timeline, at, local.from, local.to, descending)
  return range.to > range.from ? range : undefined
}

function clockStamp(clip: VideoEditClip): unknown {
  return [clip.id, clip.kind, clip.itemId, clip.track, clip.start, clip.duration, clip.sourceInUs, clip.sourceRemainder, clip.speed, clip.timeRemap, clip.reverse, clip.frameHold, clip.sourceComponent,
    clip.gainDb ?? 0, clip.volume, clip.curves?.volume, clip.disabledIntrinsicSections?.includes('audio'), clip.multicamCameraId, clip.contentAnchor]
}
/** Per-root-instance cache. A changed child invalidates its parents, not unrelated root clips. */
export class VideoEditSourceMapIndex {
  private readonly branches = new Map<string, { stamp: string; windows: Map<string, VideoEditSourceMapEntry[]> }>()
  query(composition: VideoEditComposition, range: VideoEditSourceMapRange, mediums: readonly VideoEditSourceMapMedium[] = ['video', 'audio']): VideoEditSourceMapEntry[] {
    if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || range.from < 0 || range.to <= range.from) throw new Error('来源映射范围须为非负整数帧，to 必须大于 from。')
    const sequences = new Map(composition.sequences?.map(sequence => [sequence.id, sequence]))
    const items = new Map(composition.items.map(item => [item.id, item])); const media = new Map(composition.media.map(source => [source.id, source]))
    // Encode a shared sequence once and reference it by ID. Recursively embedding serialized
    // child strings expands a small shared DAG exponentially before mapping can enforce its budget.
    const childNodes = new Map<string, unknown>()
    const childLinks = new Map<string, string[]>()
    const childDepths = new Map<string, number>()
    const sourceStamp = (clip: VideoEditClip, ancestors: readonly string[]): unknown => {
      const item = items.get(clip.itemId); const source = media.get(item?.mediaId ?? '')
      return [clockStamp(clip), item?.kind, item?.mediaId, item?.sequenceId, source?.kind, source?.hasAudio, source?.durationSeconds,
        clip.kind === 'sequence' ? childStamp(item?.sequenceId ?? '', ancestors) : null]
    }
    const childStamp = (id: string, ancestors: readonly string[]): string => {
      if (ancestors.includes(id) || ancestors.length >= VIDEO_EDIT_MAX_SEQUENCE_DEPTH) throw new Error('来源映射遇到循环嵌套或超过八层。')
      if (childNodes.has(id)) {
        if (ancestors.length + childDepths.get(id)! > VIDEO_EDIT_MAX_SEQUENCE_DEPTH) throw new Error('来源映射超过八层。')
        return id
      }
      const child = sequences.get(id); if (!child) throw new Error('来源映射的嵌套序列不存在。')
      const data = [id, child.frameRate, child.tracks, child.multicam, child.transitions, videoEditDuration(child),
        child.captions?.map(caption => [caption.id, caption.start, caption.duration, caption.clipId, caption.speech]),
        child.clips.map(clip => sourceStamp(clip, [...ancestors, id]))]
      const links = [...new Set(child.clips.filter(clip => clip.kind === 'sequence').map(clip => items.get(clip.itemId)!.sequenceId!))]
      childLinks.set(id, links); childDepths.set(id, 1 + links.reduce((depth, childId) => Math.max(depth, childDepths.get(childId)!), 0))
      childNodes.set(id, data); return id
    }
    const dependencies = (clip: VideoEditClip): unknown[] => {
      if (clip.kind !== 'sequence') return []
      const ids = new Set<string>()
      const visit = (id: string): void => { if (ids.has(id)) return; ids.add(id); for (const child of childLinks.get(id) ?? []) visit(child) }
      visit(items.get(clip.itemId)!.sequenceId!)
      return [...ids].map(id => childNodes.get(id))
    }
    const result: VideoEditSourceMapEntry[] = []
    const retained = new Set<string>()
    for (const medium of [...new Set(mediums)]) {
      const windows = clipWindows(composition, medium)
      const candidates = candidateClips(composition, medium)
      for (const clip of candidates) {
        const extent = windows.get(clip.id)!
        if (extent.from >= range.to || extent.to <= range.from) continue
        const key = `${medium}:${clip.id}`; retained.add(key)
        const source = sourceStamp(clip, [composition.id])
        const stamp = JSON.stringify([composition.id, composition.fps, extent, source, dependencies(clip)])
        let branch = this.branches.get(key)
        if (branch?.stamp !== stamp) { branch = { stamp, windows: new Map() }; this.branches.set(key, branch) }
        const windowKey = `${range.from}:${range.to}`
        let mapped = branch.windows.get(windowKey)
        if (!mapped) {
          mapped = buildBranch(composition, clip, medium, range)
          if (mapped.length <= 1024) {
            while (branch.windows.size >= 4) branch.windows.delete(branch.windows.keys().next().value!)
            branch.windows.set(windowKey, mapped)
          }
        }
        assertEntryBudget(result.length + mapped.length)
        result.push(...mapped)
      }
    }
    // Keep the working set bounded independently of sequence duration and removed clips.
    for (const key of this.branches.keys()) if (!retained.has(key)) this.branches.delete(key)
    while (this.branches.size > 128 || [...this.branches.values()].reduce((count, branch) => count + [...branch.windows.values()].reduce((sum, entries) => sum + entries.length, 0), 0) > 8192) this.branches.delete(this.branches.keys().next().value!)
    return result.sort((a, b) => a.timeline.from - b.timeline.from || a.medium.localeCompare(b.medium) || a.id.localeCompare(b.id))
  }
}

/** Project a source fact through this exact placed instance; never merge repeated uses. */
export function projectVideoEditSourceMapRanges(entry: VideoEditSourceMapEntry, ranges: readonly { fromUs: number; toUs: number }[]): VideoEditSourceMapRange[] {
  if (entry.sourceKind === 'static') return ranges.some(range => range.fromUs === 0) ? [{ ...entry.timeline }] : []
  const rootFps = entry.path[0].fps
  return ranges.flatMap(range => {
    if (entry.medium === 'audio') {
      const a = rootSeconds(entry.path, range.fromUs / 1e6) * rootFps; const b = rootSeconds(entry.path, range.toUs / 1e6) * rootFps
      if (range.fromUs === range.toUs) return a >= entry.timeline.from && a < entry.timeline.to ? [{ from: a, to: a }] : []
      const from = Math.max(entry.timeline.from, Math.min(a, b)); const to = Math.min(entry.timeline.to, Math.max(a, b))
      return to > from ? [{ from, to }] : []
    }
    const low = range.fromUs / 1e6; const high = range.toUs / 1e6
    if (range.fromUs === range.toUs) {
      if (range.fromUs < entry.source.fromUs || range.fromUs >= entry.source.toUs) return []
      const frame = firstTrue(entry.timeline, frame => entry.source.direction === 'reverse' ? sampledSource(entry, frame) < low - 1e-9 : sampledSource(entry, frame) >= low - 1e-9)
      return frame < entry.timeline.to ? [{ from: frame, to: frame }] : []
    }
    const selected = intersectFrames(entry.timeline, frame => sampledSource(entry, frame), low - 1e-9, high - 1e-9, entry.source.direction === 'reverse')
    return selected.to > selected.from ? [selected] : []
  }).sort((a, b) => a.from - b.from || a.to - b.to)
}

/** Track rendering clamps to the placed clip's endpoints, independently of transition picture handles. */
function trackingTimeUs(entry: VideoEditSourceMapEntry, frame: number): number {
  if (entry.sourceKind === 'static') return 0
  const leaf = entry.path.at(-1)!
  const local = Math.max(leaf.clip.start, Math.min(leaf.clip.start + leaf.clip.duration - 1, localFrame(entry.path, frame)))
  return micros(videoEditClipSourceSecondsAt(leaf.clip, local, leaf.fps))
}
export function videoEditSourceMapTrackingRange(entry: VideoEditSourceMapEntry): { fromUs: number; toUs: number } {
  const first = trackingTimeUs(entry, entry.timeline.from); const last = trackingTimeUs(entry, entry.timeline.to - 1)
  // The header scan is half-open; include the last exact sample without claiming an extra source frame.
  return { fromUs: Math.min(first, last), toUs: Math.max(first, last) + 1 }
}
export function projectVideoEditTrackingRanges(entry: VideoEditSourceMapEntry, ranges: readonly { fromUs: number; toUs: number }[]): VideoEditSourceMapRange[] {
  const descending = entry.path.reduce((direction, step) => step.clip.reverse ? -direction : direction, 1) < 0
  return ranges.flatMap(range => {
    const selected = intersectFrames(entry.timeline, frame => trackingTimeUs(entry, frame), range.fromUs, range.toUs, descending)
    return selected.to > selected.from ? [selected] : []
  })
}

/** Image pixels are static, but a code effect on that image still runs on its author/source clock. */
export function projectVideoEditSourceMapAuthorTimes(entry: VideoEditSourceMapEntry, timesUs: readonly number[]): VideoEditSourceMapRange[] {
  if (entry.sourceKind !== 'static') return projectVideoEditSourceMapRanges(entry, timesUs.map(time => ({ fromUs: time, toUs: time })))
  const first = sampledSource(entry, entry.timeline.from); const last = sampledSource(entry, entry.timeline.to - 1)
  const leaf = entry.path.at(-1)!
  const moving: VideoEditSourceMapEntry = { ...entry, sourceKind: 'generated', source: {
    fromUs: micros(Math.min(first, last)), toUs: micros(Math.max(first, last) + videoEditClipSpeedValue(leaf.clip) / leaf.fps),
    direction: entry.path.reduce((direction, step) => step.clip.reverse ? -direction : direction, 1) < 0 ? 'reverse' : 'forward', basis: 'generated_clock',
  } }
  return projectVideoEditSourceMapRanges(moving, timesUs.map(time => ({ fromUs: time, toUs: time })))
}
