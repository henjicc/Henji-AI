import { videoEditClipPictureSize, videoEditClipToFrame } from './clipGeometry'
import type { VideoEditComposition } from './document'
import { evaluateVideoEditClip } from './keyframes'
import type { VideoEditMotionStructureFact, VideoEditSafeAreaEdge } from './motionStructure'
import { VIDEO_EDIT_SAFE_MARGINS } from './safeMargins'
import { videoEditSourceMapLocalFrame, type VideoEditSourceMapStep } from './sourceMap'

/*
 * 自动画面检查（剪辑复核 motion 的一部分）：停稳抖动、安全框、运动速度。
 * 只给复核依据和改法，风格与创作意图优先；不改作品。
 *
 * - 抖动：确定性渲染下几何不变则像素不变。位移小于 1/256 像素时 8 位抗锯齿覆盖度变化不足一级，
 *   视为像素不变；看起来已停（每帧位移不足 0.5 像素）却还在变，或在 2 像素内来回跳，就是“停稳后抖”。
 * - 安全框：与监视器安全框同一规则（SMPTE ST 2046-1 / EBU R 95）：文字守标题安全区 90%，
 *   关键元素守动作安全区 93%。只在停稳时（速度低于运动判定的 2.5% 画面宽/秒）判断，入场飞入不算。
 * - 速度：以画面宽度百分比/秒表示，三档上限见 VIDEO_EDIT_MOTION_PACE_LIMITS。
 */
export type VideoEditMotionPace = 'gentle' | 'standard' | 'brisk'
/**
 * 动作峰值速度上限（画面宽度 %/秒）。30fps 时 100%/秒约等于每帧 3.3% 画面宽（1080p 约 64 像素），
 * 超过这个量级的位移开始出现跳帧感；舒缓档要求横穿整幅画面至少约 1.7 秒，偏快档约 0.7 秒。
 */
export const VIDEO_EDIT_MOTION_PACE_LIMITS: Readonly<Record<VideoEditMotionPace, number>> = { gentle: 60, standard: 100, brisk: 150 }
const PACE_NAMES: Readonly<Record<VideoEditMotionPace, string>> = { gentle: '舒缓（不过快）', standard: '常规', brisk: '偏快' }
export const VIDEO_EDIT_PICTURE_CHECK = {
  /** 位移低于此值（输出像素）时 8 位抗锯齿覆盖度变化不足一级，像素视为不变。 */
  stillPixels: 1 / 256,
  /** 每帧位移低于此值时人眼视为已停，只剩边缘闪烁。 */
  settledPixels: .5,
  /** 来回跳动的单帧幅度上限；更大的往复属于可见动作。 */
  wobblePixels: 2,
  /** 抖动或爬动至少持续这么久才报告，避免把正常缓动的最后两三帧当问题。 */
  minimumSeconds: .3,
  /** 安全框只看停稳时刻，与运动判定阈值一致（画面宽 %/秒）。 */
  restSpeed: 2.5,
  minimumSafeSeconds: .25,
  /** 安全线上的数值误差容差（画面边长比例）。 */
  safeTolerance: .001,
  /** 关键元素：完整位于画面内、不贴边且面积不超过画面四分之一，排除背景和有意出血的装饰。 */
  keyElementArea: .25,
  thinLinePixels: 3,
} as const

export interface VideoEditPicturePoint { x: number; y: number }
/** One observed frame of a subject: quad corners in output pixels of the queried (root) sequence. */
export interface VideoEditPictureSample { frame: number; quad: readonly VideoEditPicturePoint[]; opacity: number }
export type VideoEditPictureRole = 'text' | 'line' | 'element'
type Base = Pick<VideoEditMotionStructureFact, 'sequenceId' | 'path' | 'subjectId' | 'subjectType' | 'basis' | 'elementPath' | 'label'>

const seconds = (frame: number, fps: number): string => (frame / fps).toFixed(2)
const span = (from: number, to: number, fps: number): string => `${seconds(from, fps)}–${seconds(to, fps)} 秒`
const named = (label: string | undefined, fallback: string): string => label?.trim() ? `“${label.trim().slice(0, 40)}”` : fallback

function sequenceSize(root: VideoEditComposition, id: string): { width: number; height: number } {
  if (id === root.id) return root
  const sequence = root.sequences?.find(value => value.id === id)
  return sequence ? { width: Math.round(sequence.width * sequence.pixelAspectRatio.numerator / sequence.pixelAspectRatio.denominator), height: sequence.height } : root
}
/** Maps normalized coordinates of a nested picture through every placed wrapper into the queried sequence. */
export function videoEditRootMapper(root: VideoEditComposition, wrappers: readonly VideoEditSourceMapStep[], rootFrame: number): (point: VideoEditPicturePoint) => VideoEditPicturePoint {
  const levels = wrappers.map((step, index) => ({
    placement: evaluateVideoEditClip(step.clip, videoEditSourceMapLocalFrame({ path: wrappers.slice(0, index + 1) }, rootFrame)),
    picture: videoEditClipPictureSize(root, step.clip), parent: sequenceSize(root, step.sequenceId),
  }))
  return point => levels.reduceRight((value, level) => videoEditClipToFrame(level.placement, level.picture, level.parent, value.x, value.y), point)
}

const TEXT_NAME = /text|title|label|caption|subtitle|headline|number|digit|字|标题|文案|标签|数字|名称/i
/** Text by declared text parameters or an explicit name; thin lines by their rendered short side. */
export function videoEditPictureRole(element: { name: string; id: string; textParameterKeys: readonly string[] }, quad: readonly VideoEditPicturePoint[]): VideoEditPictureRole {
  if (element.textParameterKeys.length || TEXT_NAME.test(element.name) || TEXT_NAME.test(element.id)) return 'text'
  const side = Math.min(Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y), Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y))
  return side <= VIDEO_EDIT_PICTURE_CHECK.thinLinePixels ? 'line' : 'element'
}

interface Step { frame: number; magnitude: number; vector: number[] }
interface Episode { from: number; to: number; peak: number; kind: 'creep' | 'wobble' }
const visible = (sample: VideoEditPictureSample): boolean => sample.opacity >= .01
function stepChains(samples: readonly VideoEditPictureSample[]): Step[][] {
  const chains: Step[][] = []; let chain: Step[] = []
  for (let i = 1; i < samples.length; i++) {
    const before = samples[i - 1], after = samples[i]
    if (after.frame !== before.frame + 1 || !visible(before) || !visible(after) || before.quad.length !== after.quad.length) { if (chain.length) chains.push(chain); chain = []; continue }
    const vector = after.quad.flatMap((point, corner) => [point.x - before.quad[corner].x, point.y - before.quad[corner].y])
    let magnitude = 0
    for (let k = 0; k < vector.length; k += 2) magnitude = Math.max(magnitude, Math.hypot(vector[k], vector[k + 1]))
    chain.push({ frame: after.frame, magnitude, vector })
  }
  if (chain.length) chains.push(chain)
  return chains
}
const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((sum, value, index) => sum + value * b[index], 0)
const meanMagnitude = (values: readonly Step[]): number => values.reduce((sum, value) => sum + value.magnitude, 0) / values.length

/** Settled text/line jitter: a decaying sub-pixel creep that never lands, or bounded back-and-forth jumps. */
export function videoEditJitterFacts(samples: readonly VideoEditPictureSample[], fps: number, base: Base, role: VideoEditPictureRole): VideoEditMotionStructureFact[] {
  if (role === 'element') return []
  const { stillPixels, settledPixels, wobblePixels, minimumSeconds } = VIDEO_EDIT_PICTURE_CHECK
  const minimumFrames = Math.max(3, Math.ceil(minimumSeconds * fps)), gapFrames = Math.max(1, Math.round(.5 * fps))
  const episodes: Episode[] = []
  for (const chain of stepChains(samples)) {
    // Creep: visually stopped, still changing, decaying toward a target it does not reach in time.
    for (let i = 0; i < chain.length;) {
      if (chain[i].magnitude < stillPixels || chain[i].magnitude >= settledPixels) { i++; continue }
      let end = i
      while (end + 1 < chain.length && chain[end + 1].magnitude >= stillPixels && chain[end + 1].magnitude < settledPixels) end++
      const run = chain.slice(i, end + 1)
      // A decaying tail shrinks almost every frame; slow drifts stay level and floats rise and fall.
      const decaying = run.slice(1).filter((step, index) => step.magnitude <= run[index].magnitude * 1.05 + 1e-9).length >= (run.length - 1) * .9
      if (run.length >= minimumFrames && decaying && meanMagnitude(run.slice(-3)) <= meanMagnitude(run.slice(0, 3)) * .6) episodes.push({ kind: 'creep', from: run[0].frame - 1, to: run.at(-1)!.frame + 1, peak: Math.max(...run.map(value => value.magnitude)) })
      i = end + 1
    }
    // Wobble: changing steps alternate direction while each stays within a couple of pixels.
    let current: Step[] = []
    const close = (): void => { if (current.length >= 3) episodes.push({ kind: 'wobble', from: current[0].frame - 1, to: current.at(-1)!.frame + 1, peak: Math.max(...current.map(value => value.magnitude)) }); current = [] }
    for (const step of chain) {
      if (step.magnitude >= wobblePixels) { close(); continue }
      if (step.magnitude < stillPixels) { if (current.length && step.frame - current.at(-1)!.frame > gapFrames) close(); continue }
      const last = current.at(-1)
      if (last && dot(last.vector, step.vector) >= 0) { close(); current = [step]; continue }
      current.push(step)
    }
    close()
  }
  episodes.sort((a, b) => a.from - b.from)
  const merged: Episode[] = []
  for (const episode of episodes) {
    const last = merged.at(-1)
    if (last && episode.from - last.to <= gapFrames) { last.to = Math.max(last.to, episode.to); last.peak = Math.max(last.peak, episode.peak); if (episode.kind === 'wobble') last.kind = 'wobble' }
    else merged.push({ ...episode })
  }
  const what = role === 'text' ? '文字' : '细线'
  return merged.filter(episode => episode.to - episode.from >= minimumFrames).map(episode => {
    const pixels = Math.round(episode.peak * 1000) / 1000
    const detail = episode.kind === 'creep'
      ? `${named(base.label, `这段${what}`)}在 ${span(episode.from, episode.to, fps)}看起来已停稳，但仍以每帧不足 ${pixels} 像素的幅度继续爬动，连续帧像素不一致，${what}边缘会闪。让动画在终点精确结束（用有限时长的缓动，不用无限逼近的指数或弹簧尾巴），或停稳后把位置吸附到整像素。`
      : `${named(base.label, `这段${what}`)}在 ${span(episode.from, episode.to, fps)}停稳期间来回跳动（每帧最多 ${pixels} 像素），连续帧像素不一致，看起来在抖。检查是否在小数像素上反复取整、跟随或噪声没停；停稳时把位置固定为同一个整像素值。若是有意的抖动效果可保留。`
    return { ...base, kind: 'settled_jitter' as const, timeline: { from: episode.from, to: episode.to }, jitterPixels: pixels, detail }
  })
}

/** Frame-side overflow beyond a safe line as fractions; undefined when this quad is not checked. */
export function videoEditSafeAreaOverflow(quad: readonly VideoEditPicturePoint[], frame: { width: number; height: number }, role: VideoEditPictureRole): { zone: 'title' | 'action'; overflow: Partial<Record<VideoEditSafeAreaEdge, number>> } | undefined {
  const xs = quad.map(point => point.x / frame.width), ys = quad.map(point => point.y / frame.height)
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys)
  if (right <= 0 || left >= 1 || bottom <= 0 || top >= 1) return undefined
  const zone = role === 'text' ? 'title' : 'action'
  if (zone === 'action') {
    // Backgrounds, full-bleed decoration and edge-touching dividers are intentional, not key content.
    const edge = .5 / Math.max(frame.width, frame.height)
    if (left <= edge || top <= edge || right >= 1 - edge || bottom >= 1 - edge || (right - left) * (bottom - top) > VIDEO_EDIT_PICTURE_CHECK.keyElementArea) return undefined
  }
  const margin = VIDEO_EDIT_SAFE_MARGINS[zone], tolerance = VIDEO_EDIT_PICTURE_CHECK.safeTolerance
  const overflow: Partial<Record<VideoEditSafeAreaEdge, number>> = {}
  for (const [edge, value] of [['left', margin - left], ['right', right - (1 - margin)], ['top', margin - top], ['bottom', bottom - (1 - margin)]] as const) if (value > tolerance) overflow[edge] = value
  return { zone, overflow }
}

const EDGE_NAMES: Readonly<Record<VideoEditSafeAreaEdge, string>> = { left: '左', right: '右', top: '上', bottom: '下' }
export interface VideoEditSafeSegment { from: number; to: number; quad: readonly VideoEditPicturePoint[]; opacity: number; atRest: boolean }
/** Rest test shared by every source: per-frame displacement converted to frame widths per second. */
export function videoEditAtRest(magnitudePixels: number, frameWidth: number, fps: number): boolean {
  return magnitudePixels / frameWidth * fps * 100 < VIDEO_EDIT_PICTURE_CHECK.restSpeed
}
export function videoEditSampleSegments(samples: readonly VideoEditPictureSample[], frameWidth: number, fps: number): VideoEditSafeSegment[] {
  const motion = (a?: VideoEditPictureSample, b?: VideoEditPictureSample): number => a && b && b.frame === a.frame + 1 ? Math.max(...b.quad.map((point, i) => Math.hypot(point.x - a.quad[i].x, point.y - a.quad[i].y))) : 0
  return samples.map((sample, i) => ({ from: sample.frame, to: sample.frame + 1, quad: sample.quad, opacity: sample.opacity,
    atRest: videoEditAtRest(Math.max(motion(samples[i - 1], sample), motion(sample, samples[i + 1])), frameWidth, fps) }))
}
/** Merge settled, visible out-of-zone time into ranges worth looking at. */
export function videoEditSafeAreaFacts(segments: readonly VideoEditSafeSegment[], frame: { width: number; height: number }, fps: number, base: Base, role: VideoEditPictureRole, what = role === 'text' ? '文字' : '元素'): VideoEditMotionStructureFact[] {
  const ranges: Array<{ from: number; to: number; zone: 'title' | 'action'; edges: Set<VideoEditSafeAreaEdge>; overflow: number }> = []
  for (const segment of segments) {
    const result = segment.atRest && segment.opacity >= .01 ? videoEditSafeAreaOverflow(segment.quad, frame, role) : undefined
    const edges = result ? Object.keys(result.overflow) as VideoEditSafeAreaEdge[] : []
    if (!result || !edges.length) continue
    const amount = Math.max(...Object.values(result.overflow))
    const last = ranges.at(-1)
    if (last && last.to === segment.from && last.zone === result.zone) { last.to = segment.to; edges.forEach(edge => last.edges.add(edge)); last.overflow = Math.max(last.overflow, amount) }
    else ranges.push({ from: segment.from, to: segment.to, zone: result.zone, edges: new Set(edges), overflow: amount })
  }
  const minimum = Math.max(1, Math.round(VIDEO_EDIT_PICTURE_CHECK.minimumSafeSeconds * fps))
  return ranges.filter(range => range.to - range.from >= minimum).map(range => {
    const edges = (['left', 'right', 'top', 'bottom'] as const).filter(edge => range.edges.has(edge))
    const overflowPercent = Math.round(range.overflow * 1000) / 10
    const sides = edges.map(edge => EDGE_NAMES[edge]).join('、')
    const subject = named(base.label, `这段${what}`)
    const detail = range.zone === 'title'
      ? `${subject}在 ${span(range.from, range.to, fps)}停稳时超出标题安全框（${sides}侧超出约 ${overflowPercent}% 画面），播放器控件或裁边可能挡住。向画面内移，或缩小字号、换行，让${what}留在四边各 5% 的边距以内。`
      : `${subject}在 ${span(range.from, range.to, fps)}停稳时贴近画面边缘，超出动作安全框（${sides}侧约 ${overflowPercent}% 画面）。若不是有意贴边的装饰，向内移到四边各 3.5% 的边距以内。`
    return { ...base, kind: 'safe_area' as const, timeline: { from: range.from, to: range.to }, safeArea: { zone: range.zone, edges, overflowPercent }, detail }
  })
}

/**
 * Speed against the creative pace. Only placed transforms and code elements are the edit's own motion;
 * source footage is excluded. Single-frame jumps are layout changes, not sustained motion.
 * Elements of one clip moving together over the same span are reported once by their fastest member.
 */
export function videoEditMotionSpeedFacts(records: readonly VideoEditMotionStructureFact[], pace: VideoEditMotionPace, fps: number): VideoEditMotionStructureFact[] {
  const limit = VIDEO_EDIT_MOTION_PACE_LIMITS[pace]
  const fastest = new Map<string, VideoEditMotionStructureFact>()
  for (const record of records) {
    if (record.kind !== 'motion' || record.peakSpeed === undefined || record.peakSpeed <= limit || record.timeline.to - record.timeline.from <= 2) continue
    if (record.basis !== undefined && record.basis !== 'clip_transform' && record.basis !== 'code_structure') continue
    const key = JSON.stringify([record.sequenceId, record.path.map(step => step.clipId), record.timeline.from, record.timeline.to])
    const previous = fastest.get(key)
    if (!previous || record.peakSpeed > previous.peakSpeed!) fastest.set(key, record)
  }
  return [...fastest.values()].map(record => {
    const duration = (record.timeline.to - record.timeline.from) / fps, peak = Math.round(record.peakSpeed! * 10) / 10
    const target = Math.ceil(duration * record.peakSpeed! / limit * 10) / 10
    const label = record.label ?? record.path.at(-1)?.clip.name
    const subject = record.elementPath?.length ? `${named(label, '这段画面')}中的图层“${record.elementPath.join('/')}”` : named(label, '这段画面')
    return { sequenceId: record.sequenceId, path: record.path, subjectId: record.subjectId, ...(record.elementPath ? { elementPath: [...record.elementPath] } : {}), basis: record.basis ?? 'clip_transform', ...(label ? { label } : {}),
      kind: 'motion_too_fast' as const, timeline: { ...record.timeline }, peakSpeed: record.peakSpeed!, speedLimit: limit,
      detail: `${subject}在 ${span(record.timeline.from, record.timeline.to, fps)}的动作峰值约 ${peak}% 画面宽/秒，超过${PACE_NAMES[pace]}节奏上限 ${limit}%/秒。把这段动作从约 ${duration.toFixed(1)} 秒拉长到约 ${target} 秒，或缩短位移、换更平缓的缓入；若是有意的快速转场可保留。` }
  })
}
