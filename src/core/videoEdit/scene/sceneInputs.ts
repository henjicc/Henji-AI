import type { CodeImageReference, CodeVideoSpan } from '../../imaging/parameterTypes'
import { CODE_VIDEO_SPAN_LIMIT } from '../codeMaterial/videoSpans'
import { CODE_SCENE_LIMITS } from './sceneDeclaration'
import type { ResolvedVideoEditScene, ResolvedVideoEditSceneShot } from './sceneResolve'

/**
 * 由窗口内容时间表派生代码片段要的取帧参数：每张时间表每条取帧车道一个视频引用（带取帧时间表 spans），
 * 每张截图一个图片引用。键就是窗口内容项的 input，宿主把它们和代码参数里的图片一样交给作者代码的 inputs.images。
 * 这些参数只由片子数据决定，不存在片段上。规则同代码片子的 winInputs：
 * - 每项从 at 放到下一项开始；下一项在别的车道上叠化进来时，多放一个叠化的时长（两层同时在画面上）。
 * - 最后一项放到时间表结束；时间表不封口时放到时刻上限。时刻与源时间保留四位小数，倍速 1 与画鼠标不写。
 * - 一条车道最多 CODE_VIDEO_SPAN_LIMIT 段，超出的截掉（之后的内容不再取帧），键记进 overflow，由解析结果的 issues 报出。
 */
type InputShot = Pick<ResolvedVideoEditSceneShot, 'image' | 'media' | 'input' | 'at' | 'src' | 'rate' | 'cursor' | 'xf'>
export interface VideoEditSceneTimetableInputs { readonly inputs: Readonly<Record<string, CodeImageReference>>; readonly overflow: readonly string[] }
const round = (value: number): number => Math.round(value * 1e4) / 1e4

export function videoEditSceneTimetableInputs(shots: readonly InputShot[], end: number): VideoEditSceneTimetableInputs {
  const videos = new Map<string, { mediaId: string; spans: CodeVideoSpan[] }>(), images = new Map<string, string>()
  shots.forEach((shot, index) => {
    if (shot.image) { images.set(shot.input, shot.media); return }
    const next = shots[index + 1]
    const to = next ? next.at + (next.input !== shot.input ? next.xf : 0) : Number.isFinite(end) ? end : CODE_SCENE_LIMITS.seconds
    const span: CodeVideoSpan = { from: round(shot.at), to: round(to), src: round(Math.max(0, shot.src)), ...(shot.rate !== 1 ? { rate: shot.rate } : {}), ...(shot.cursor ? {} : { cursor: false }) }
    if (span.to <= span.from) return
    const lane = videos.get(shot.input) ?? { mediaId: shot.media, spans: [] }
    // 同一车道上的两段必须首尾不重叠（取帧时间表的硬约束）；只有一项短于自己的叠化时才会碰上，按后一项开始截断前一项。
    for (let last = lane.spans[lane.spans.length - 1]; last && span.from < last.to; last = lane.spans[lane.spans.length - 1]) {
      last.to = span.from
      if (last.to > last.from) break
      lane.spans.pop()
    }
    lane.spans.push(span)
    videos.set(shot.input, lane)
  })
  const inputs: Record<string, CodeImageReference> = {}, overflow: string[] = []
  for (const [key, lane] of videos) {
    if (lane.spans.length > CODE_VIDEO_SPAN_LIMIT) { overflow.push(key); lane.spans.length = CODE_VIDEO_SPAN_LIMIT }
    inputs[key] = { kind: 'video', mediaId: lane.mediaId, spans: lane.spans }
  }
  for (const [key, mediaId] of images) inputs[key] = { kind: 'image', mediaId }
  return { inputs, overflow }
}

const merged = new WeakMap<ResolvedVideoEditScene, Readonly<Record<string, CodeImageReference>>>()
/** 整份片子数据的取帧参数（各时间表的合在一起，同一张截图只出现一次）。按解析结果对象身份缓存。 */
export function videoEditSceneInputs(resolved: ResolvedVideoEditScene): Readonly<Record<string, CodeImageReference>> {
  let inputs = merged.get(resolved)
  if (!inputs) { inputs = Object.assign({}, ...resolved.timetables.map(table => table.inputs)) as Record<string, CodeImageReference>; merged.set(resolved, inputs) }
  return inputs
}
