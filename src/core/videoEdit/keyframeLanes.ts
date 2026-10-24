import type { VideoEditClip } from './document'
import type { VideoEditAnimatableKey, VideoEditKeyframe, VideoEditKeyframes } from './keyframes'
import type { VideoEditInterpolation } from './keyframeInterpolation'

/** 固有属性的动画行（重要记录 019）：多维属性合成一行，一个秒表管整行；效果控件与时间线展开的关键帧行共用这份分组。 */
export const VIDEO_EDIT_INTRINSIC_ANIMATION_ROWS = [
  { id: 'position', label: '位置', keys: ['x', 'y'] },
  { id: 'scale', label: '缩放', keys: ['scale'] },
  { id: 'rotation', label: '旋转', keys: ['rotation'] },
  { id: 'anchor', label: '锚点', keys: ['anchorX', 'anchorY'] },
  { id: 'opacity', label: '不透明度', keys: ['opacity'] },
  { id: 'volume', label: '音量', keys: ['volume'] },
] as const satisfies readonly { id: string; label: string; keys: readonly VideoEditAnimatableKey[] }[]

/** 内置效果参数在界面上的一行（点位的水平、垂直合成一行）；由宿主按参数字段分组后传入。 */
export interface VideoEditBuiltinAnimationField { key: string; title: string; keys: readonly string[]; discrete: boolean }

export type VideoEditKeyframeLaneSource = { kind: 'intrinsic' } | { kind: 'builtin'; effectId: string }
/** 一行里的一个分量（位置的 X 或 Y）；没开动画的分量是空数组，打关键帧时整行一起打。 */
export interface VideoEditKeyframeLaneChannel { key: string; points: VideoEditKeyframes }
export interface VideoEditKeyframeLaneEntry { clip: VideoEditClip; source: VideoEditKeyframeLaneSource; channels: VideoEditKeyframeLaneChannel[] }
export interface VideoEditKeyframeLane { id: string; label: string; discrete: boolean; entries: VideoEditKeyframeLaneEntry[] }
export type VideoEditKeyframeChanges = Record<string, VideoEditKeyframes>

/**
 * 一条轨道展开后的关键帧行（重要记录 019）：每个有动画的属性一行，同一属性在这条轨道各片段上的关键帧并在一行里，
 * 各按片段位置摆放。固有属性按固定顺序在前；内置效果按“效果种类 + 在片段效果链里的第几个 + 参数行”归并，
 * 按首次出现的顺序排在后面。代码滤镜的关键帧按源时间记录，在它自己的参数面板里编辑，不进这里。
 */
export function videoEditTrackKeyframeLanes(clips: readonly VideoEditClip[], fields: (builtinId: string) => readonly VideoEditBuiltinAnimationField[]): VideoEditKeyframeLane[] {
  const ordered = [...clips].sort((a, b) => a.start - b.start)
  const lanes: VideoEditKeyframeLane[] = []
  for (const row of VIDEO_EDIT_INTRINSIC_ANIMATION_ROWS) {
    const entries = ordered.flatMap((clip): VideoEditKeyframeLaneEntry[] => row.keys.some(key => clip.curves?.[key]?.length)
      ? [{ clip, source: { kind: 'intrinsic' }, channels: row.keys.map(key => ({ key, points: clip.curves?.[key] ?? [] })) }] : [])
    if (entries.length) lanes.push({ id: `intrinsic:${row.id}`, label: row.label, discrete: false, entries })
  }
  const effects = new Map<string, VideoEditKeyframeLane>()
  for (const clip of ordered) {
    const seen = new Map<string, number>()
    for (const effect of clip.effects ?? []) {
      const builtin = effect.builtin; if (!builtin) continue
      const occurrence = seen.get(builtin.id) ?? 0; seen.set(builtin.id, occurrence + 1)
      const curves = builtin.curves; if (!curves) continue
      for (const field of fields(builtin.id)) {
        if (!field.keys.some(key => curves[key]?.length)) continue
        const id = `builtin:${builtin.id}:${occurrence}:${field.key}`
        const lane = effects.get(id) ?? { id, label: `${effect.name} · ${field.title}`, discrete: field.discrete, entries: [] }
        lane.entries.push({ clip, source: { kind: 'builtin', effectId: effect.id }, channels: field.keys.map(key => ({ key, points: curves[key] ?? [] })) })
        effects.set(id, lane)
      }
    }
  }
  return [...lanes, ...effects.values()]
}

/** 一个片段在这一行的关键帧时间（片段内帧，升序去重）。 */
export function videoEditLaneEntryTimes(entry: VideoEditKeyframeLaneEntry): number[] {
  return [...new Set(entry.channels.flatMap(channel => channel.points.map(point => point.time)))].sort((a, b) => a - b)
}
/** 整行关键帧在序列上的位置（序列帧，升序去重）：上一个 / 下一个按它跳。 */
export function videoEditLaneTimes(lane: VideoEditKeyframeLane): number[] {
  return [...new Set(lane.entries.flatMap(entry => videoEditLaneEntryTimes(entry).map(time => entry.clip.start + time)))].sort((a, b) => a - b)
}
/** 片段内帧 `time` 上这一行各分量的关键帧。 */
export function videoEditLaneKeyframesAt(entry: VideoEditKeyframeLaneEntry, time: number): { key: string; point: VideoEditKeyframe }[] {
  return entry.channels.flatMap(channel => { const point = channel.points.find(value => value.time === time); return point ? [{ key: channel.key, point }] : [] })
}

/** 关键帧在时间线上的形状：直线（匀速）、曲线（缓入缓出，含自定义贝塞尔）、定格。 */
export type VideoEditKeyframeShape = 'linear' | 'curve' | 'hold'
export function videoEditKeyframeShape(interpolation: VideoEditInterpolation): VideoEditKeyframeShape {
  return interpolation === 'hold' ? 'hold' : interpolation === 'linear' ? 'linear' : 'curve'
}

/** 修剪残留的缓动区间只属于原来那段曲线；关键帧被改过就去掉。 */
function edited(point: VideoEditKeyframe, changes: Partial<VideoEditKeyframe>): VideoEditKeyframe {
  const { easeRange: _range, easeValues: _values, ...rest } = point
  return { ...rest, ...changes }
}

/**
 * 把一行在片段内帧 `from` 的关键帧（各分量一起）挪到 `to`。越出片段或落到已有关键帧上时返回 null（不合并、不覆盖）。
 */
export function moveVideoEditLaneKeyframe(entry: VideoEditKeyframeLaneEntry, from: number, to: number): VideoEditKeyframeChanges | null {
  if (to === from || to < 0 || to >= entry.clip.duration) return null
  if (entry.channels.some(channel => channel.points.some(point => point.time === to))) return null
  const changes: VideoEditKeyframeChanges = {}
  for (const channel of entry.channels) {
    const point = channel.points.find(value => value.time === from); if (!point) continue
    changes[channel.key] = [...channel.points.filter(value => value !== point), edited(point, { time: to })].sort((a, b) => a.time - b.time)
  }
  return Object.keys(changes).length ? changes : null
}

/** 改一行在片段内帧 `time` 的关键帧形状；已经是曲线的保留它的贝塞尔手柄。离散参数只能定格。 */
export function shapeVideoEditLaneKeyframe(entry: VideoEditKeyframeLaneEntry, time: number, shape: VideoEditKeyframeShape): VideoEditKeyframeChanges {
  const changes: VideoEditKeyframeChanges = {}
  for (const channel of entry.channels) {
    const point = channel.points.find(value => value.time === time); if (!point || videoEditKeyframeShape(point.interpolation) === shape) continue
    const interpolation: VideoEditInterpolation = shape === 'curve' ? 'ease' : shape
    const { bezier: _bezier, ...rest } = point
    changes[channel.key] = channel.points.map(value => value === point ? edited(rest, { interpolation }) : value)
  }
  return changes
}

/** 只改一个分量在片段内帧 `time` 的那个关键帧（速度曲线里拖数值或贝塞尔手柄）。 */
export function editVideoEditLaneChannel(entry: VideoEditKeyframeLaneEntry, key: string, time: number, changes: Partial<Pick<VideoEditKeyframe, 'value' | 'interpolation' | 'bezier'>>): VideoEditKeyframeChanges {
  const channel = entry.channels.find(value => value.key === key); const point = channel?.points.find(value => value.time === time)
  if (!channel || !point) return {}
  return { [key]: channel.points.map(value => value === point ? edited(point, changes) : value) }
}

/**
 * 删一行在片段内帧 `time` 的关键帧。某分量删光时，被删那一帧的数值留作静态值（PR）：`statics` 里给出。
 */
export function deleteVideoEditLaneKeyframe(entry: VideoEditKeyframeLaneEntry, time: number): { changes: VideoEditKeyframeChanges; statics: Record<string, VideoEditKeyframe['value']> } {
  const changes: VideoEditKeyframeChanges = {}; const statics: Record<string, VideoEditKeyframe['value']> = {}
  for (const channel of entry.channels) {
    const point = channel.points.find(value => value.time === time); if (!point) continue
    const rest = channel.points.filter(value => value !== point)
    changes[channel.key] = rest
    if (!rest.length) statics[channel.key] = point.value
  }
  return { changes, statics }
}
