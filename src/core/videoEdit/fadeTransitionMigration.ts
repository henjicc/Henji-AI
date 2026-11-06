/*
 * 剪辑内容 73 → 74：片段的淡入淡出（fadeInFrames / fadeOutFrames）并进过渡，成为挂在片段一端的单侧过渡（PR 淡化手柄）：
 * 画面片段交叉溶解（从透明淡入、淡出到透明），声音片段恒定功率；自带声音的画面片段声音随画面一起淡，画面与声音不变。
 * 过渡最短 2 帧：1 帧的淡化放长到 2 帧，片段不足 2 帧时去掉；这一端已经挂着过渡时保留原过渡、去掉淡化；
 * 同一片段两端合计不超过片段长度，也不压到另一端已有的过渡。调整图层与灯光不能挂过渡，它们的淡化写成不透明度关键帧（已有不透明度动画时保留动画）。
 * 片段版本（takes）里存的片段快照只去掉淡化字段：切回版本时淡化不跟着回来。
 * 纯函数，不改输入；主进程也会引用，只用相对路径导入。
 */
type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
/** 没有画面也不是声音的片段不能挂过渡，淡化改成不透明度关键帧。 */
const NO_TRANSITION = new Set(['adjustment', 'light'])
const MIN_FRAMES = 2

/** 过渡在切点之前的帧数（与 transitions.ts 的对齐规则一致）。 */
function framesBeforeCut(transition: Json): number {
  const duration = Number(transition.durationFrames) || 0
  if (transition.alignment === 'start') return 0
  if (transition.alignment === 'end') return duration
  if (transition.alignment === 'custom') return Math.max(0, Math.min(duration, Number(transition.framesBeforeCut ?? Math.floor(duration / 2))))
  return Math.floor(duration / 2)
}
/** 已有过渡占进片段入点（`edge` in）或出点（out）的帧数。 */
function occupied(transitions: readonly Json[], clipId: string, edge: 'in' | 'out'): number {
  let used = 0
  for (const transition of transitions) {
    const duration = Number(transition.durationFrames) || 0
    const single = !transition.leftClipId || !transition.rightClipId
    if (edge === 'in' && transition.rightClipId === clipId) used = Math.max(used, single ? duration : duration - framesBeforeCut(transition))
    if (edge === 'out' && transition.leftClipId === clipId) used = Math.max(used, single ? duration : framesBeforeCut(transition))
  }
  return used
}
/** 过渡标识最长 100：片段标识太长时截短后再接端点后缀。 */
const fadeId = (clipId: string, edge: 'in' | 'out'): string => `${clipId.length > 90 ? clipId.slice(0, 90) : clipId}~fade-${edge}`
/** 去掉任意深度里的淡化字段（片段版本快照）。 */
function stripFades(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripFades)
  if (!isObject(value)) return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'fadeInFrames' && key !== 'fadeOutFrames').map(([key, item]) => [key, stripFades(item)]))
}
/** 调整图层与灯光的淡化：旧版按帧乘不透明度（入点第一帧为 0、出点最后一帧为 0），写成同样走向的不透明度关键帧。 */
function opacityFades(clip: Json, fadeIn: number, fadeOut: number): Json {
  const curves = isObject(clip.curves) ? clip.curves : {}
  if (Array.isArray(curves.opacity) && curves.opacity.length || !(fadeIn > 0 || fadeOut > 0)) return {}
  const duration = Number(clip.duration) || 0, opacity = typeof clip.opacity === 'number' ? clip.opacity : 1, last = duration - 1
  const points = new Map<number, number>()
  if (fadeIn > 0) { points.set(0, 0); points.set(Math.min(last, fadeIn), opacity) }
  if (fadeOut > 0) { points.set(Math.max(0, last - fadeOut), Math.min(points.get(Math.max(0, last - fadeOut)) ?? opacity, opacity)); points.set(last, 0) }
  return { curves: { ...curves, opacity: [...points].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time, value, interpolation: 'linear' })) } }
}

function migrateSequence(sequence: unknown): unknown {
  if (!isObject(sequence) || !Array.isArray(sequence.clips)) return sequence
  if (!JSON.stringify(sequence.clips).includes('"fade')) return sequence
  const transitions: Json[] = Array.isArray(sequence.transitions) ? sequence.transitions.filter(isObject) : []
  const added: Json[] = []
  const clips = sequence.clips.map(clip => {
    if (!isObject(clip)) return clip
    if (!('fadeInFrames' in clip || 'fadeOutFrames' in clip)) return 'takes' in clip ? { ...clip, takes: stripFades(clip.takes) } : clip
    const { fadeInFrames, fadeOutFrames, ...own } = clip
    const rest = 'takes' in own ? { ...own, takes: stripFades(own.takes) } : own
    const id = String(clip.id), duration = Number(clip.duration) || 0
    if (NO_TRANSITION.has(String(clip.kind))) return { ...rest, ...opacityFades(clip, Number(fadeInFrames) || 0, Number(fadeOutFrames) || 0) }
    if (duration < MIN_FRAMES) return rest
    const usedIn = occupied(transitions, id, 'in'), usedOut = occupied(transitions, id, 'out')
    const wanted = (frames: unknown, used: number): number => !used && Number(frames) > 0 ? Math.max(MIN_FRAMES, Number(frames)) : 0
    const inFrames = Math.min(wanted(fadeInFrames, usedIn), duration - usedOut)
    const outFrames = Math.min(wanted(fadeOutFrames, usedOut), duration - Math.max(usedIn, inFrames >= MIN_FRAMES ? inFrames : 0))
    const kind = clip.kind === 'audio' ? 'constant_power' : 'cross_dissolve'
    if (inFrames >= MIN_FRAMES) added.push({ id: fadeId(id, 'in'), kind, rightClipId: id, durationFrames: inFrames })
    if (outFrames >= MIN_FRAMES) added.push({ id: fadeId(id, 'out'), kind, leftClipId: id, durationFrames: outFrames })
    return rest
  })
  return { ...sequence, clips, ...(added.length ? { transitions: [...(Array.isArray(sequence.transitions) ? sequence.transitions : []), ...added] } : {}) }
}

export function migrateVideoEditClipFades(content: unknown): unknown {
  if (!isObject(content) || !Array.isArray(content.sequences)) return content
  return { ...content, sequences: content.sequences.map(migrateSequence) }
}

/** 录屏等文档里嵌着的剪辑快照（format 为 henji-video-project 的对象，任意深度）同样迁移。 */
export function migrateEmbeddedVideoEditClipFades(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(migrateEmbeddedVideoEditClipFades)
  if (!isObject(value)) return value
  if (value.format === 'henji-video-project') return migrateVideoEditClipFades(value)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, migrateEmbeddedVideoEditClipFades(item)]))
}

/** 字幕回填记录里的声音片段快照只用来比对，淡化字段直接去掉（淡化不参与字幕识别）。 */
export function stripVideoEditClipFades(value: unknown): unknown {
  if (!isObject(value) || !Array.isArray(value.soundClips)) return value
  return { ...value, soundClips: value.soundClips.map(clip => { if (!isObject(clip)) return clip; const { fadeInFrames: _in, fadeOutFrames: _out, ...rest } = clip; return rest }) }
}
