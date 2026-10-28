import { CodeMaterialError, codeImageReference, type CodeParameterValues } from './codeMaterial/contract'
import { codeVideoSpanAt, codeVideoSpanIndex } from './codeMaterial/videoSpans'
import { type VideoEditComposition, type VideoEditClip } from './document'
import type { CodeImageReference, CodeVideoSpan } from '../imaging/parameterTypes'
import { videoEditSourceSeconds, type VideoEditRatio } from './time'
import { RECORDING_CURSOR_EFFECT } from './recordingCursor'

type CodeMediaInputClip = Pick<VideoEditClip, 'start' | 'sourceInUs' | 'sourceRemainder'>

export function codeMediaInputKey(clipId: string, parameter: string): string { return `code-input:${JSON.stringify([clipId, parameter])}` }
export class CodeMediaInputReferenceError extends CodeMaterialError {
  constructor(readonly parameter: string, readonly reason: string) { super('PARAMETERS', '代码画面参数的素材引用无效，请检查图片、视频或下方画面绑定。') }
}
/** 仅用于声明为画面的参数；未绑定时不参与，损坏引用不能当作普通参数跳过。 */
export function codeMediaInputReference(value: unknown, parameter: string): CodeImageReference | undefined {
  if (value === null || value === undefined) return undefined
  try { return codeImageReference(value, '画面参数') }
  catch (error) { throw new CodeMediaInputReferenceError(parameter, (error as CodeMaterialError).message) }
}
/** 只在帧期使用：输入键是合成器的资源别名，不能作为持久媒体 ID 重新校验或保存。 */
export interface CodeMediaFrameParameters { parameters: CodeParameterValues; images: ReadonlyMap<string, string> }
/**
 * 这一帧交给作者代码的参数：视频与下方画面换成这一帧的输入画面；带时间表的视频参数在不落在任何一段的帧里为 null
 * （和未绑定一样，`assets`/`inputs.images` 里没有这个键）。
 */
export function codeMediaFrameParameters(clip: VideoEditClip, parameters: CodeParameterValues, frame: number, rate: VideoEditRatio, imageParameters: ReadonlySet<string>): CodeMediaFrameParameters {
  const images = new Map<string, string>()
  const values = Object.fromEntries(Object.entries(parameters).map(([key, value]) => {
    if (!imageParameters.has(key)) return [key, value]
    const reference = codeMediaInputReference(value, key)
    if (!reference) return [key, value]
    if (reference.kind !== 'image' && !codeMediaInputActive(clip, reference, frame, rate)) return [key, null]
    const input = reference.kind === 'image' ? reference.mediaId : codeMediaInputKey(clip.id, key)
    images.set(key, input)
    return [key, reference.kind === 'image' ? value : { kind: 'image', mediaId: input }]
  }))
  return { parameters: values, images }
}
/**
 * 视频参数的时间轴（秒）：片段入点加片段内时间，不经过代码片段的变速、倒放与时间重映射。等于作者代码的
 * `info.clip.time` 加片段入点：片段没裁过开头、没被切开时（入点为 0）两者相同。
 */
export function codeMediaInputClipSeconds(clip: CodeMediaInputClip, frame: number, rate: VideoEditRatio): number {
  return videoEditSourceSeconds(clip) + (frame - clip.start) * rate.denominator / rate.numerator
}
/**
 * 这一帧的取帧时刻与所在段：给了 time 就固定在那一刻；带 spans 时按时间表换算，不落在任何一段里为 undefined
 * （这一帧这个参数不参与）；都没有时从片段入点起随片段本地时间走（裁掉开头时视频也从相应位置开始）。
 */
export function codeMediaInputSample(clip: CodeMediaInputClip, reference: CodeImageReference, frame: number, rate: VideoEditRatio): { seconds: number; span?: CodeVideoSpan } | undefined {
  if (reference.time !== undefined) return { seconds: reference.time }
  const t = codeMediaInputClipSeconds(clip, frame, rate)
  if (!reference.spans) return { seconds: t }
  const span = codeVideoSpanAt(reference.spans, t)
  return span && { seconds: span.src + (t - span.from) * (span.rate ?? 1), span }
}
export function codeMediaInputSeconds(clip: CodeMediaInputClip, reference: CodeImageReference, frame: number, rate: VideoEditRatio): number | undefined {
  return codeMediaInputSample(clip, reference, frame, rate)?.seconds
}
/** 这一帧这个参数是否参与（只有带时间表的视频参数会不参与）。 */
export function codeMediaInputActive(clip: CodeMediaInputClip, reference: CodeImageReference, frame: number, rate: VideoEditRatio): boolean {
  return !reference.spans || codeMediaInputSample(clip, reference, frame, rate) !== undefined
}
/**
 * `[from, until)` 里这个参数第一次参与的帧（前瞻与预热按它算即将进入有效段的取帧时刻）；不带时间表的引用就是 from。
 * 段比一帧还短、没有帧落进去时跳到下一段。
 */
export function codeMediaInputNextFrame(clip: CodeMediaInputClip, reference: CodeImageReference, from: number, until: number, rate: VideoEditRatio): number | undefined {
  const spans = reference.spans
  if (!spans) return from < until ? from : undefined
  const base = videoEditSourceSeconds(clip)
  for (let at = Math.ceil(from); at < until;) {
    const t = codeMediaInputClipSeconds(clip, at, rate)
    const span = spans[codeVideoSpanIndex(spans, t)]
    if (!span) return undefined
    if (span.from <= t) return at
    // 第一帧 t ≥ span.from；浮点误差由下一轮按同一换算复核，至少前进一帧。
    at = Math.max(at + 1, clip.start + Math.ceil((span.from - base) * rate.numerator / rate.denominator - 1e-9))
  }
  return undefined
}

/** 时间表的短指纹（按数组身份缓存：文档值整体替换、不原地修改）；会话身份用它，不把整张表拼进每帧的键。 */
const spanDigests = new WeakMap<object, string>()
function spansDigest(spans: readonly CodeVideoSpan[]): string {
  let digest = spanDigests.get(spans)
  if (digest) return digest
  const text = JSON.stringify(spans)
  const one = (seed: number): string => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
    for (let index = 0; index < text.length; index++) { const code = text.charCodeAt(index); h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677) }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
  }
  digest = `${spans.length}:${text.length}:${one(1)}${one(7)}`
  spanDigests.set(spans, digest)
  return digest
}

/** 一个代码输入在这一帧的取样：`document` 是只含这一幅画面的普通合成，由正常渲染器解码与合成。 */
export interface CodeMediaInput { kind: 'video' | 'sequence'; still: boolean; timetabled: boolean; document: VideoEditComposition; frame: number; sessionKey: string; sampleKey: string }
/**
 * Produces a normal composition; the ordinary renderer remains the sole decoder/compositor. Undefined: a timetabled
 * video parameter this frame does not take part in (no decode, no session, no budget).
 *
 * 输入会话的身份：同一会话每帧只取一个时刻，并独占自己的解码位置。
 * - 下层画面：按序列与轨道（同一帧同一份画面）。
 * - 视频：按素材身份加取帧轨迹——固定时刻按该时刻；跟随片段时按片段入点与起点；按时间表时再加时间表（两个引用在每一帧取同一时刻
 *   才共用）。只按素材区分会让引用同一段录屏、时刻不同的两个片段（两扇录屏窗口交叉溶解）共用一个解码位置，源时间来回跳，
 *   每帧都从关键帧重解。
 * `sampleKey`：这一帧取的画面（取帧时刻，及时间表关掉的录制鼠标）；相同就复用上一帧的画面，停住的一段不再解码。
 * `still`：固定时刻的视频参数（定格帧），整段只显示这一幅，解出一次即可。`timetabled`：按时间表取帧（段间不参与）。
 */
export function codeMediaInputComposition(document: VideoEditComposition, clip: VideoEditClip, reference: CodeImageReference, frame: number): CodeMediaInput | undefined {
  if (reference.kind === 'sequence') {
    const clips = document.clips.filter(candidate => candidate.track < clip.track)
    const ids = new Set(clips.map(candidate => candidate.id))
    return { kind: 'sequence', still: false, timetabled: false, document: { ...document, clips, captions: [], transitions: document.transitions?.filter(transition => (!transition.leftClipId || ids.has(transition.leftClipId)) && (!transition.rightClipId || ids.has(transition.rightClipId))) }, frame, sessionKey: JSON.stringify([document.id, 'below', clip.track]), sampleKey: String(frame) }
  }
  const media = document.media.find(media => media.id === reference.mediaId && media.kind === 'video')
  const item = document.items.find(item => item.mediaId === media?.id)
  if (!media || !item) throw new Error('视频图片参数引用的素材不存在。')
  const sample = codeMediaInputSample(clip, reference, frame, document.frameRate)
  if (!sample) return undefined
  const { seconds } = sample
  if (seconds < 0 || seconds >= media.durationSeconds) throw new Error('视频图片参数的取帧时间超出素材范围。')
  const sourceUs = seconds * 1e6
  // 带采集事件的干净录屏（网页重演）：按录制光标重画鼠标与点击，和普通录屏片段一致；时间表的一段可以关掉（cursor:false）。
  const cursorEffect = !!media.recordingCursor && !media.recordingCursor.cursorBakedIn
  const cursor = cursorEffect && sample.span?.cursor !== false
  const input: VideoEditClip = { id: `code-video:${media.id}`, itemId: item.id, name: media.name, kind: 'video', start: 0, duration: 1, track: 0, sourceInUs: Math.floor(sourceUs), sourceRemainder: { numerator: Math.floor((sourceUs % 1) * 1e6), denominator: 1e6 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '',
    ...(cursor ? { effects: [{ id: `code-video-cursor:${media.id}`, name: '录制光标', enabled: true, amount: 1, builtin: { id: RECORDING_CURSOR_EFFECT, params: {} } }] } : {}) }
  const trajectory = reference.time !== undefined ? ['at', reference.time] : [reference.spans ? 'spans' : 'follow', clip.start, clip.sourceInUs, clip.sourceRemainder.numerator, clip.sourceRemainder.denominator, ...(reference.spans ? [spansDigest(reference.spans)] : [])]
  const sessionKey = JSON.stringify([document.id, 'video', media.id, media.path, media.sourceRevision, media.assetContent, media.width, media.height, media.durationSeconds, media.frameRate, media.frameRateMode, trajectory])
  return { kind: 'video', still: reference.time !== undefined, timetabled: !!reference.spans, document: { ...document, width: media.width, height: media.height, pixelAspectRatio: { numerator: 1, denominator: 1 }, clips: [input], tracks: [{ id: 'code-input', name: '画面', kind: 'video', index: 0, locked: false, enabled: true, muted: true, solo: false }], captions: [], transitions: [] }, frame: 0, sessionKey, sampleKey: JSON.stringify([input.sourceInUs, input.sourceRemainder, ...(cursorEffect && !cursor ? ['no-cursor'] : [])]) }
}
