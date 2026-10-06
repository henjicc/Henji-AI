import { z } from 'zod'
import type { VideoEditClip, VideoEditDocument, VideoEditSequence } from './document'
import type { CodeMaterialMetadataReader } from './codeMaterialDocument'
import { offsetVideoEditSource, videoEditSourceSeconds } from './time'

/**
 * 过渡预设（PR“效果”面板的视频过渡／音频过渡）：只列引擎能真实渲染的种类。
 * 视频：交叉溶解、黑场过渡、白场过渡；音频：恒定功率、恒定增益（交叉淡化）。
 */
export const VIDEO_EDIT_TRANSITION_PRESETS = [
  { kind: 'cross_dissolve', medium: 'video', name: '交叉溶解', tooltip: '前一段画面逐渐溶入后一段', description: '交叉溶解：两段画面按时长线性互溶，最常用的柔和转场。' },
  { kind: 'dip_to_black', medium: 'video', name: '黑场过渡', tooltip: '前一段淡出到黑色，再从黑色淡入后一段', description: '黑场过渡：前半段淡出到黑色、后半段从黑色淡入，表示时间流逝或段落结束。' },
  { kind: 'dip_to_white', medium: 'video', name: '白场过渡', tooltip: '前一段淡出到白色，再从白色淡入后一段', description: '白场过渡：前半段淡到白色、后半段从白色淡入，常用于回忆、闪回或明亮的段落切换。' },
  { kind: 'constant_power', medium: 'audio', name: '恒定功率', tooltip: '两段声音交叉淡化，中间音量不塌陷', description: '恒定功率交叉淡化：两段声音按正弦／余弦曲线交叉，过渡中段响度保持平稳，是默认音频过渡。' },
  { kind: 'constant_gain', medium: 'audio', name: '恒定增益', tooltip: '两段声音按直线交叉淡化', description: '恒定增益交叉淡化：两段声音按直线交叉，中段会略微变轻，适合需要明显切换感的地方。' },
] as const
export type VideoEditTransitionKind = typeof VIDEO_EDIT_TRANSITION_PRESETS[number]['kind']
export type VideoEditTransitionMedium = 'video' | 'audio'
const KINDS = VIDEO_EDIT_TRANSITION_PRESETS.map(preset => preset.kind) as [VideoEditTransitionKind, ...VideoEditTransitionKind[]]
/** PR 默认过渡：视频交叉溶解、音频恒定功率，时长 1 秒。 */
export const VIDEO_EDIT_DEFAULT_TRANSITIONS: Record<VideoEditTransitionMedium, VideoEditTransitionKind> = { video: 'cross_dissolve', audio: 'constant_power' }
/** PR 对齐：中心切点（默认，不写入）、起点切点（整段在切点之后）、终点切点（整段在切点之前）、自定义起点。 */
export const VIDEO_EDIT_TRANSITION_ALIGNMENTS = ['center', 'start', 'end', 'custom'] as const
export type VideoEditTransitionAlignment = typeof VIDEO_EDIT_TRANSITION_ALIGNMENTS[number]
/**
 * 两端都有片段时是普通过渡（盖在切点上）；只有一端时是 PR 的单侧过渡：只写 `leftClipId` 表示挂在该片段出点、
 * 后面是空白（淡出到透明或纯色），只写 `rightClipId` 表示挂在该片段入点、前面是空白（从透明或纯色淡入）。
 * 单侧过渡整段在自己的片段内，对齐字段不起作用。两个字段都缺时由 `videoEditTransitionWindow` 拒绝。
 */
export const videoEditTransitionSchema = z.object({
  id: z.string().min(1).max(100), kind: z.enum(KINDS),
  leftClipId: z.string().min(1).max(100).optional(), rightClipId: z.string().min(1).max(100).optional(),
  durationFrames: z.number().int().min(2).max(108_000),
  alignment: z.enum(VIDEO_EDIT_TRANSITION_ALIGNMENTS).optional(),
  /** 只在自定义起点时使用：过渡在切点之前的帧数。 */
  framesBeforeCut: z.number().int().min(0).max(108_000).optional(),
}).strict()
export type VideoEditTransition = z.infer<typeof videoEditTransitionSchema>
/**
 * 过渡在时间线上的窗口。单侧过渡的 `left` 与 `right` 是同一个片段，`side` 说明它在片段的哪一端：
 * `in` 在入点（从空白淡入），`out` 在出点（淡出到空白）；普通过渡没有 `side`。
 */
export interface VideoEditTransitionWindow { transition: VideoEditTransition; left: VideoEditClip; right: VideoEditClip; start: number; end: number; cut: number; side?: VideoEditTransitionSide }
export type VideoEditTransitionSide = 'in' | 'out'
/** 单侧过渡在片段的哪一端（`in` 入点、`out` 出点）；两端都有片段时为 undefined。 */
export function videoEditTransitionSide(transition: Pick<VideoEditTransition, 'leftClipId' | 'rightClipId'>): VideoEditTransitionSide | undefined {
  return transition.leftClipId && transition.rightClipId ? undefined : transition.rightClipId ? 'in' : transition.leftClipId ? 'out' : undefined
}
/** 过渡挂着的片段（普通过渡两个，单侧过渡一个）。 */
export function videoEditTransitionClipIds(transition: Pick<VideoEditTransition, 'leftClipId' | 'rightClipId'>): string[] {
  return [transition.leftClipId, transition.rightClipId].filter((id): id is string => Boolean(id))
}

export function videoEditTransitionPreset(kind: VideoEditTransitionKind): typeof VIDEO_EDIT_TRANSITION_PRESETS[number] { return VIDEO_EDIT_TRANSITION_PRESETS.find(preset => preset.kind === kind)! }
export function videoEditTransitionMedium(kind: VideoEditTransitionKind): VideoEditTransitionMedium { return videoEditTransitionPreset(kind).medium }
/** 片段能不能挂这种媒介的过渡：画面过渡挂画面片段（调整图层除外），音频过渡挂声音片段。 */
export function videoEditTransitionAccepts(medium: VideoEditTransitionMedium, clip: Pick<VideoEditClip, 'kind'>): boolean {
  return medium === 'audio' ? clip.kind === 'audio' : clip.kind !== 'audio' && clip.kind !== 'adjustment'
}
/** 过渡在切点之前的帧数（由对齐方式决定）。 */
export function videoEditTransitionFramesBeforeCut(transition: Pick<VideoEditTransition, 'durationFrames' | 'alignment' | 'framesBeforeCut'>): number {
  const duration = transition.durationFrames
  if (transition.alignment === 'start') return 0
  if (transition.alignment === 'end') return duration
  if (transition.alignment === 'custom') return Math.max(0, Math.min(duration, transition.framesBeforeCut ?? Math.floor(duration / 2)))
  return Math.floor(duration / 2)
}
/** 由时长与切点前帧数得出对齐字段：正好居中、贴切点起或止时用对应的命名对齐，其余为自定义起点。 */
export function videoEditTransitionAlignmentFields(durationFrames: number, framesBeforeCut: number): Pick<VideoEditTransition, 'alignment' | 'framesBeforeCut'> {
  if (framesBeforeCut === Math.floor(durationFrames / 2)) return {}
  if (framesBeforeCut <= 0) return { alignment: 'start' }
  if (framesBeforeCut >= durationFrames) return { alignment: 'end' }
  return { alignment: 'custom', framesBeforeCut }
}
export function videoEditTransitionAlignmentOf(transition: Pick<VideoEditTransition, 'alignment'>): VideoEditTransitionAlignment { return transition.alignment ?? 'center' }

/** Derive every temporal field from the original clips; never rewrite their clocks. */
export function videoEditTransitionWindow(sequence: Pick<VideoEditSequence, 'clips'>, transition: VideoEditTransition): VideoEditTransitionWindow {
  if (!Number.isInteger(transition.durationFrames) || transition.durationFrames < 2 || transition.durationFrames > 108_000) throw new Error('转场时长必须为2到108000的整数帧。')
  const medium = videoEditTransitionMedium(transition.kind)
  const side = videoEditTransitionSide(transition)
  if (side) {
    // 单侧过渡（PR）：整段在自己的片段内，从入点起或到出点止。
    const clip = sequence.clips.find(value => value.id === (side === 'in' ? transition.rightClipId : transition.leftClipId))
    if (!clip || !videoEditTransitionAccepts(medium, clip)) throw new Error(medium === 'audio' ? '音频过渡需要挂在声音片段上。' : '视频过渡需要挂在画面片段上。')
    const cut = side === 'in' ? clip.start : clip.start + clip.duration
    const start = side === 'in' ? cut : cut - transition.durationFrames; const end = start + transition.durationFrames
    if (start < clip.start || end > clip.start + clip.duration) throw new Error('转场窗口超出片段，请减小转场时长。')
    return { transition, left: clip, right: clip, start, end, cut, side }
  }
  if (!transition.leftClipId && !transition.rightClipId) throw new Error('过渡至少要挂在一个片段上。')
  const left = sequence.clips.find(clip => clip.id === transition.leftClipId)
  const right = sequence.clips.find(clip => clip.id === transition.rightClipId)
  if (!left || !right || left === right || !videoEditTransitionAccepts(medium, left) || !videoEditTransitionAccepts(medium, right) || left.track !== right.track || left.start + left.duration !== right.start) throw new Error(medium === 'audio' ? '音频过渡需要同一声音轨道上紧邻的两个片段。' : '交叉溶解需要同一画面轨道上紧邻的两个片段。')
  const cut = right.start; const start = cut - videoEditTransitionFramesBeforeCut(transition); const end = start + transition.durationFrames
  if (start < left.start || end > right.start + right.duration) throw new Error('转场窗口超出两侧片段，请减小转场时长。')
  if (sequence.clips.some(clip => clip.track === left.track && clip.id !== left.id && clip.id !== right.id && clip.start < end && clip.start + clip.duration > start)) throw new Error('转场窗口内还有其他片段，请先调整剪辑位置。')
  return { transition, left, right, start, end, cut }
}
/** 指定帧上生效的过渡窗口；`medium` 区分画面过渡（渲染）与音频过渡（混音）。 */
export function videoEditTransitionsAt(sequence: Pick<VideoEditSequence, 'clips' | 'transitions'>, frame: number, medium: VideoEditTransitionMedium = 'video'): VideoEditTransitionWindow[] {
  return (sequence.transitions ?? []).filter(transition => videoEditTransitionMedium(transition.kind) === medium).map(transition => videoEditTransitionWindow(sequence, transition)).filter(window => frame >= window.start && frame < window.end)
}
export function videoEditTransitionAmount(window: Pick<VideoEditTransitionWindow, 'start' | 'end'>, frame: number): number {
  if (!Number.isInteger(window.start) || !Number.isInteger(window.end) || window.end - window.start < 2 || !Number.isInteger(frame) || frame < window.start || frame >= window.end) throw new Error('请求帧不在转场半开窗口内。')
  return (frame - window.start) / (window.end - window.start - 1)
}
/**
 * 画面过渡交给混合着色器的参数（`mix(left, right, amount, through)`，through 为经过的预乘纯色）。
 * 普通过渡：进度即混合量，黑场／白场经过纯色。单侧过渡（PR）两边都是自己的画面，借“经过纯色”的后半段或前半段：
 * 入点从透明（交叉溶解）或黑／白淡入，出点淡出到透明或黑／白；透明用预乘的全零色。
 */
export function videoEditTransitionMix(window: Pick<VideoEditTransitionWindow, 'start' | 'end' | 'side' | 'transition'>, frame: number): { amount: number; through?: [number, number, number, number] } {
  const progress = videoEditTransitionAmount(window, frame)
  if (!window.side) return { amount: progress, through: videoEditTransitionDipColor(window.transition.kind) }
  const through = videoEditTransitionDipColor(window.transition.kind) ?? [0, 0, 0, 0]
  return { amount: window.side === 'in' ? .5 + progress / 2 : progress / 2, through }
}
/** 黑场／白场过渡经过的纯色（预乘 RGBA）；交叉溶解没有。 */
export function videoEditTransitionDipColor(kind: VideoEditTransitionKind): [number, number, number, number] | undefined {
  return kind === 'dip_to_black' ? [0, 0, 0, 1] : kind === 'dip_to_white' ? [1, 1, 1, 1] : undefined
}
/** 音频过渡两侧的增益（`progress` 为 0 到 1 的连续进度）：恒定功率走余弦／正弦，恒定增益走直线。 */
export function videoEditAudioTransitionGains(kind: VideoEditTransitionKind, progress: number): [number, number] {
  const x = Math.max(0, Math.min(1, progress))
  return kind === 'constant_gain' ? [1 - x, x] : [Math.cos(x * Math.PI / 2), Math.sin(x * Math.PI / 2)]
}
/** 音频过渡里某个片段的增益：普通过渡左片段走淡出、右片段走淡入；单侧过渡入点淡入、出点淡出（同一条曲线）。 */
export function videoEditAudioTransitionClipGain(window: Pick<VideoEditTransitionWindow, 'left' | 'side' | 'transition'>, clipId: string, progress: number): number {
  const outgoing = window.side ? window.side === 'out' : window.left.id === clipId
  return videoEditAudioTransitionGains(window.transition.kind, progress)[outgoing ? 0 : 1]
}
/**
 * PR“媒体不足时重复帧”：转场让片段画面越过自己的入点或出点时，越过源素材开头或结尾的部分停在最早／最后一帧。
 * 返回实际取画面的时间线帧；片段范围内、或没有源时长（图片、文字）时原样返回。
 */
export function videoEditHandleFrame(clip: VideoEditClip, frame: number, fps: number, mediaDurationSeconds?: number): number {
  if (frame >= clip.start && frame < clip.start + clip.duration) return frame
  const source = videoEditSourceSeconds(clip)
  if (frame < clip.start) return Math.max(frame, clip.start - Math.floor(source * fps + 1e-6))
  if (mediaDurationSeconds === undefined) return frame
  return Math.min(frame, Math.max(clip.start + clip.duration - 1, clip.start + Math.floor((mediaDurationSeconds - source) * fps + 1e-6) - 1))
}
function assertSourceHandles(document: VideoEditDocument, sequence: VideoEditSequence, window: VideoEditTransitionWindow, read?: CodeMaterialMetadataReader): void {
  for (const [clip, first, exclusiveEnd] of [[window.left, window.start, window.end], [window.right, window.start, window.end]] as const) {
    const durations: number[] = []
    // 视频与声音素材余量不足时按 PR 重复首尾帧（`videoEditHandleFrame`）或静音，不再拒绝；代码素材仍需真实余量。
    if (clip.kind === 'code') {
      if (!clip.code) throw new Error('转场代码片段缺少固定源码。')
      const program = read?.(clip.code)
      if (program?.mode === 'dynamic') durations.push(program.durationSeconds)
    }
    for (const effect of clip.effects ?? []) {
      const program = effect.code && read?.(effect.code)
      if (program?.mode === 'dynamic') durations.push(program.durationSeconds)
    }
    if (!durations.length) continue // The source-authorized metadata stage checks deferred code handles.
    // This exact rational operation rejects a negative first sample. No frame allowance.
    offsetVideoEditSource(clip, first - clip.start, sequence.frameRate)
    const end = videoEditSourceSeconds(offsetVideoEditSource(clip, exclusiveEnd - clip.start, sequence.frameRate))
    for (const duration of durations) {
      const tolerance = 4 * Number.EPSILON * Math.max(1, Math.abs(end), duration)
      if (end > duration && end - duration > tolerance) throw new Error('转场需要的真实源余量不足，请裁出更多前后素材或减小时长。')
    }
  }
}
export function validateVideoEditTransitions(document: VideoEditDocument, read?: CodeMaterialMetadataReader): void {
  for (const sequence of document.sequences) {
    const windows = (sequence.transitions ?? []).map(transition => videoEditTransitionWindow(sequence, transition))
    for (let index = 0; index < windows.length; index++) {
      const window = windows[index]
      if (windows.slice(0, index).some(previous => previous.left.track === window.left.track && previous.start < window.end && previous.end > window.start)) throw new Error('同轨转场窗口不能重叠。')
      assertSourceHandles(document, sequence, window, read)
    }
  }
}

/** 只带存在的片段字段（单侧过渡不写另一侧，旧文件不受影响）。 */
function withClips(transition: VideoEditTransition, leftClipId: string | undefined, rightClipId: string | undefined): VideoEditTransition {
  // 字段顺序固定（与持久化一致），未改动的拖动不会因键序不同被当成一次编辑。
  const { id, kind, durationFrames, alignment, framesBeforeCut } = transition
  return { id, kind, ...(leftClipId ? { leftClipId } : {}), ...(rightClipId ? { rightClipId } : {}), durationFrames, ...(alignment ? { alignment } : {}), ...(framesBeforeCut !== undefined ? { framesBeforeCut } : {}) }
}
/** 单侧过渡：去掉对齐字段（整段在片段内，对齐不起作用）。 */
function singleSided(transition: VideoEditTransition, clipId: string, side: VideoEditTransitionSide): VideoEditTransition {
  const next = withClips(transition, side === 'out' ? clipId : undefined, side === 'in' ? clipId : undefined)
  delete next.alignment; delete next.framesBeforeCut
  return next
}
/**
 * Deletion cascades; boundary-preserving split/overwrite explicitly supply their origin map.
 * 移动或裁剪让普通过渡的两个片段不再相接时（PR）：过渡留在边界变了（被移动）的那个片段一端，成为单侧过渡。
 * 单侧过渡放不下时缩短，不足两帧时删除。这些都属于引起它的同一次编辑（一步撤销）。
 */
export function retimeVideoEditTransitions(before: Pick<VideoEditSequence, 'clips' | 'transitions' | 'frameRate'>, next: VideoEditSequence, origins: ReadonlyMap<string, { originalId: string; shift: number }> = new Map(), dropLostBoundary = false): VideoEditSequence {
  if (!before.transitions?.length || !next.transitions?.length) return next
  const resolve = (id: string, edge: 'in' | 'out'): string | undefined => {
    const original = before.clips.find(clip => clip.id === id)
    if (!original) return undefined
    const boundary = edge === 'in' ? original.start : original.start + original.duration
    const descendants = next.clips.filter(clip => clip.id === id || origins.get(clip.id)?.originalId === id)
    if (!descendants.length) return undefined
    const exact = descendants.find(clip => (edge === 'in' ? clip.start : clip.start + clip.duration) - (origins.get(clip.id)?.shift ?? 0) === boundary)
    // A normal trim keeps its ID and is subsequently validated, rather than silently losing the transition.
    return exact?.id ?? (dropLostBoundary ? undefined : descendants.find(clip => clip.id === id)?.id)
  }
  const previous = new Map(before.transitions.map(transition => [transition.id, transition]))
  const touched = new Set<string>()
  let transitions = next.transitions.flatMap((transition): VideoEditTransition[] => {
    const old = previous.get(transition.id)
    if (!old || old.leftClipId !== transition.leftClipId || old.rightClipId !== transition.rightClipId) return [transition]
    const leftClipId = transition.leftClipId === undefined ? undefined : resolve(transition.leftClipId, 'out')
    const rightClipId = transition.rightClipId === undefined ? undefined : resolve(transition.rightClipId, 'in')
    if (transition.leftClipId && !leftClipId || transition.rightClipId && !rightClipId) return []
    const resolved = withClips(transition, leftClipId, rightClipId)
    const left = next.clips.find(clip => clip.id === leftClipId); const right = next.clips.find(clip => clip.id === rightClipId)
    const priorLeft = before.clips.find(clip => clip.id === old.leftClipId); const priorRight = before.clips.find(clip => clip.id === old.rightClipId)
    // 单侧过渡的片段变了：之后按新长度缩短。
    if (!left || !right) {
      const clip = left ?? right; const prior = priorLeft ?? priorRight
      if (!clip || !prior || clip.start !== prior.start || clip.duration !== prior.duration) touched.add(transition.id)
      return [resolved]
    }
    if (left.track === right.track && left.start + left.duration === right.start) return [resolved]
    // 两端不再相接：留在被移动的片段一端（PR）。两端都变了时跟着右片段。
    touched.add(transition.id)
    const rightMoved = !priorRight || right.start !== priorRight.start || right.track !== priorRight.track
    const leftMoved = !priorLeft || left.start + left.duration !== priorLeft.start + priorLeft.duration || left.track !== priorLeft.track
    return [rightMoved || !leftMoved ? singleSided(resolved, right.id, 'in') : singleSided(resolved, left.id, 'out')]
  })
  // 单侧过渡按片段现在的长度与相邻过渡缩短；放不下两帧时删除。
  for (const transition of [...transitions]) {
    if (!touched.has(transition.id) || !videoEditTransitionSide(transition)) continue
    const fit = videoEditTransitionFit({ clips: next.clips, transitions }, transition, transition.durationFrames)
    transitions = fit ? transitions.map(value => value === transition ? { ...transition, durationFrames: fit.durationFrames } : value) : transitions.filter(value => value !== transition)
  }
  return { ...next, transitions }
}

/** 编辑点：两个相接片段之间（两端都写），或片段一端旁边是空白（只写一端，放单侧过渡）。 */
export interface VideoEditTransitionPair { leftClipId?: string; rightClipId?: string; medium: VideoEditTransitionMedium }
/** 编辑点所在的切点帧（单侧：入点或出点）。 */
export function videoEditTransitionPairCut(sequence: Pick<VideoEditSequence, 'clips'>, pair: Pick<VideoEditTransitionPair, 'leftClipId' | 'rightClipId'>): number | undefined {
  const right = pair.rightClipId ? sequence.clips.find(clip => clip.id === pair.rightClipId) : undefined
  if (right) return right.start
  const left = pair.leftClipId ? sequence.clips.find(clip => clip.id === pair.leftClipId) : undefined
  return left && left.start + left.duration
}
/**
 * 这种媒介的编辑点（PR）：同一轨道上首尾相接、都能挂这种过渡的片段对；片段一端没有可挂过渡的相邻片段时，
 * 那一端也是编辑点（单侧过渡）。按片段顺序，每个片段先入点后出点。
 */
export function videoEditTransitionEditPoints(sequence: Pick<VideoEditSequence, 'clips'>, medium: VideoEditTransitionMedium, tracks?: ReadonlySet<number>): VideoEditTransitionPair[] {
  const pairs: VideoEditTransitionPair[] = []
  const neighbor = (clip: VideoEditClip, after: boolean): VideoEditClip | undefined => sequence.clips.find(other => other.track === clip.track && other.id !== clip.id && (after ? other.start === clip.start + clip.duration : other.start + other.duration === clip.start) && videoEditTransitionAccepts(medium, other))
  for (const clip of sequence.clips) {
    if (!videoEditTransitionAccepts(medium, clip) || tracks && !tracks.has(clip.track)) continue
    if (!neighbor(clip, false)) pairs.push({ rightClipId: clip.id, medium })
    const right = neighbor(clip, true)
    pairs.push(right ? { leftClipId: clip.id, rightClipId: right.id, medium } : { leftClipId: clip.id, medium })
  }
  return pairs
}
/**
 * PR 应用默认过渡的目标编辑点：
 * - `playhead`（Ctrl+D／Ctrl+Shift+D）：目标轨道（没有目标轨道时用这种媒介的全部轨道）上离播放头最近的那个编辑点；
 * - `selection`（Shift+D）：所选片段两端的编辑点（旁边是空白时为单侧过渡），画面片段用视频过渡，声音片段用音频过渡。
 */
export function videoEditDefaultTransitionPairs(sequence: Pick<VideoEditSequence, 'clips'>, request: { mode: 'playhead'; medium: VideoEditTransitionMedium; frame: number; tracks: readonly number[] } | { mode: 'selection'; clipIds: readonly string[] }): VideoEditTransitionPair[] {
  if (request.mode === 'selection') {
    const selected = new Set(request.clipIds)
    return (['video', 'audio'] as const).flatMap(medium => videoEditTransitionEditPoints(sequence, medium).filter(pair => videoEditTransitionClipIds(pair).some(id => selected.has(id))))
  }
  const targeted = videoEditTransitionEditPoints(sequence, request.medium, request.tracks.length ? new Set(request.tracks) : undefined)
  const pairs = targeted.length || !request.tracks.length ? targeted : videoEditTransitionEditPoints(sequence, request.medium)
  const cutOf = (pair: VideoEditTransitionPair): number => videoEditTransitionPairCut(sequence, pair)!
  const nearest = pairs.reduce<number | undefined>((best, pair) => best === undefined || Math.abs(cutOf(pair) - request.frame) < Math.abs(best - request.frame) ? cutOf(pair) : best, undefined)
  return nearest === undefined ? [] : pairs.filter(pair => cutOf(pair) === nearest)
}
/** 已有过渡是否就在这个编辑点上（同一对片段，或同一切点一侧的单侧过渡）：再次应用时替换它。 */
function atEditPoint(transition: Pick<VideoEditTransition, 'leftClipId' | 'rightClipId'>, pair: Pick<VideoEditTransitionPair, 'leftClipId' | 'rightClipId'>): boolean {
  if (transition.leftClipId === pair.leftClipId && transition.rightClipId === pair.rightClipId) return true
  return pair.leftClipId !== undefined && transition.leftClipId === pair.leftClipId && (transition.rightClipId === undefined || pair.rightClipId === undefined)
    || pair.rightClipId !== undefined && transition.rightClipId === pair.rightClipId && (transition.leftClipId === undefined || pair.leftClipId === undefined)
}
/**
 * 在编辑点上能放下的过渡：给同轨其他过渡让位，返回不超过 `desired` 的最长时长与切点前帧数（普通过渡按请求的对齐，默认居中；
 * 单侧过渡整段在片段内）。放不下两帧时返回 undefined。
 */
export function videoEditTransitionFit(sequence: Pick<VideoEditSequence, 'clips' | 'transitions'>, pair: Pick<VideoEditTransitionPair, 'leftClipId' | 'rightClipId'>, desired: number, alignment: VideoEditTransitionAlignment = 'center'): { durationFrames: number; framesBeforeCut: number } | undefined {
  const left = pair.leftClipId ? sequence.clips.find(clip => clip.id === pair.leftClipId) : undefined
  const right = pair.rightClipId ? sequence.clips.find(clip => clip.id === pair.rightClipId) : undefined
  if (pair.leftClipId && !left || pair.rightClipId && !right) return undefined
  const anchor = right ?? left
  if (!anchor) return undefined
  const cut = right ? right.start : anchor.start + anchor.duration
  let lower = left ? left.start : cut; let upper = right ? right.start + right.duration : cut
  for (const transition of sequence.transitions ?? []) {
    if (atEditPoint(transition, pair)) continue
    let window: VideoEditTransitionWindow
    try { window = videoEditTransitionWindow(sequence, transition) } catch { continue }
    if (window.left.track !== anchor.track) continue
    if (window.end <= cut) lower = Math.max(lower, window.end)
    else if (window.start >= cut) upper = Math.min(upper, window.start)
    else return undefined
  }
  const leftRoom = cut - lower; const rightRoom = upper - cut
  const side = !left ? 'in' : !right ? 'out' : undefined
  const limit = side === 'in' || !side && alignment === 'start' ? rightRoom : side === 'out' || alignment === 'end' ? leftRoom : Math.min(2 * leftRoom + 1, 2 * rightRoom)
  const durationFrames = Math.min(108_000, desired, limit)
  if (durationFrames < 2) return undefined
  const framesBeforeCut = side === 'in' || !side && alignment === 'start' ? 0 : side === 'out' || alignment === 'end' ? durationFrames : Math.floor(durationFrames / 2)
  return { durationFrames, framesBeforeCut }
}
/**
 * 把过渡放到这些编辑点上（一次编辑）：已有过渡的编辑点换成新的种类与时长（PR 再次应用默认过渡即替换）。
 * 每处按 `videoEditTransitionFit` 缩短以放进片段；一处都放不下时抛出原因。返回新序列与各编辑点的过渡 ID。
 */
export function applyVideoEditTransitionPairs(sequence: VideoEditSequence, pairs: readonly VideoEditTransitionPair[], options: { kind?: (medium: VideoEditTransitionMedium) => VideoEditTransitionKind; durationFrames: number; alignment?: VideoEditTransitionAlignment }): { sequence: VideoEditSequence; transitionIds: string[] } {
  if (!pairs.length) throw new Error('这里没有可以放过渡的编辑点：过渡要放在片段的一端，或同一轨道上首尾相接的两个片段之间。')
  let transitions = [...(sequence.transitions ?? [])]; const ids: string[] = []
  for (const pair of pairs) {
    const fit = videoEditTransitionFit({ clips: sequence.clips, transitions }, pair, options.durationFrames, options.alignment)
    if (!fit) continue
    const replaced = transitions.filter(value => atEditPoint(value, pair)); const previous = replaced[0]
    const base: VideoEditTransition = { id: previous?.id ?? crypto.randomUUID(), kind: options.kind?.(pair.medium) ?? VIDEO_EDIT_DEFAULT_TRANSITIONS[pair.medium], durationFrames: fit.durationFrames, ...(pair.leftClipId && pair.rightClipId ? videoEditTransitionAlignmentFields(fit.durationFrames, fit.framesBeforeCut) : {}) }
    const transition = withClips(base, pair.leftClipId, pair.rightClipId)
    transitions = previous ? transitions.flatMap(value => value === previous ? [transition] : replaced.includes(value) ? [] : [value]) : [...transitions, transition]
    ids.push(transition.id)
  }
  if (!ids.length) throw new Error('片段太短，放不下过渡：至少需要两帧。')
  return { sequence: { ...sequence, transitions }, transitionIds: ids }
}
/**
 * 拖动时间线上的过渡块（PR）：拖左缘或右缘改时长（另一缘不动），拖中间沿切点平移（时长不变）。
 * `delta` 为整数帧；结果夹在两侧片段与相邻过渡之内，至少两帧。单侧过渡贴着片段一端，只能拖离开那一端的边缘改时长。
 */
export function dragVideoEditTransition(sequence: Pick<VideoEditSequence, 'clips' | 'transitions'>, transitionId: string, mode: 'in' | 'out' | 'move', delta: number): VideoEditTransition {
  const transition = sequence.transitions?.find(value => value.id === transitionId)
  if (!transition) throw new Error('原过渡已移除。')
  const window = videoEditTransitionWindow(sequence, transition)
  const others = (sequence.transitions ?? []).filter(value => value.id !== transitionId).flatMap(value => { try { return [videoEditTransitionWindow(sequence, value)] } catch { return [] } }).filter(value => value.left.track === window.left.track)
  const lower = Math.max(window.left.start, ...others.filter(value => value.end <= window.cut).map(value => value.end))
  const upper = Math.min(window.right.start + window.right.duration, ...others.filter(value => value.start >= window.cut).map(value => value.start))
  if (window.side) {
    let durationFrames = transition.durationFrames
    if (window.side === 'in' && mode === 'out') durationFrames = Math.min(upper, Math.max(window.start + 2, window.end + delta)) - window.start
    if (window.side === 'out' && mode === 'in') durationFrames = window.end - Math.max(lower, Math.min(window.end - 2, window.start + delta))
    return { ...transition, durationFrames }
  }
  let start = window.start; let end = window.end
  if (mode === 'in') start = Math.max(lower, Math.min(end - 2, window.cut, window.start + delta))
  else if (mode === 'out') end = Math.min(upper, Math.max(start + 2, window.cut, window.end + delta))
  else {
    const shift = Math.max(lower - window.start, Math.min(upper - window.end, delta))
    // 平移不能让过渡整段离开切点（PR 的过渡总是跨在或贴着切点上）。
    const bounded = Math.max(window.cut - window.end, Math.min(window.cut - window.start, shift))
    start += bounded; end += bounded
  }
  const durationFrames = end - start
  return withClips({ id: transition.id, kind: transition.kind, durationFrames, ...videoEditTransitionAlignmentFields(durationFrames, window.cut - start) }, transition.leftClipId, transition.rightClipId)
}

const videoKinds = VIDEO_EDIT_TRANSITION_PRESETS.filter(preset => preset.medium === 'video').map(preset => preset.kind) as [VideoEditTransitionKind, ...VideoEditTransitionKind[]]
const audioKinds = VIDEO_EDIT_TRANSITION_PRESETS.filter(preset => preset.medium === 'audio').map(preset => preset.kind) as [VideoEditTransitionKind, ...VideoEditTransitionKind[]]
/** 用户在效果面板“设为默认过渡”选的视频／音频默认过渡；省略即 PR 默认（交叉溶解、恒定功率）。 */
export const videoEditDefaultTransitionPreferencesSchema = z.object({ video: z.enum(videoKinds).optional(), audio: z.enum(audioKinds).optional() }).strict()
export type VideoEditDefaultTransitionPreferences = z.infer<typeof videoEditDefaultTransitionPreferencesSchema>
export function sanitizeVideoEditDefaultTransitions(value: unknown): VideoEditDefaultTransitionPreferences {
  const parsed = videoEditDefaultTransitionPreferencesSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}
export function videoEditDefaultTransitionKind(preferences: VideoEditDefaultTransitionPreferences, medium: VideoEditTransitionMedium): VideoEditTransitionKind {
  return preferences[medium] ?? VIDEO_EDIT_DEFAULT_TRANSITIONS[medium]
}
