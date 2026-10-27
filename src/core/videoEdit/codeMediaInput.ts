import { isCodeImageReference, type CodeParameterValues } from './codeMaterial/contract'
import { type VideoEditComposition, type VideoEditClip } from './document'
import type { CodeImageReference } from '../imaging/parameterTypes'
import { videoEditSourceSeconds, type VideoEditRatio } from './time'
import { RECORDING_CURSOR_EFFECT } from './recordingCursor'

export function codeMediaInputKey(clipId: string, parameter: string): string { return `code-input:${JSON.stringify([clipId, parameter])}` }
export function codeMediaFrameParameters(clip: VideoEditClip, parameters: CodeParameterValues): CodeParameterValues {
  return Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, isCodeImageReference(value) && value.kind !== 'image' ? { kind: 'image', mediaId: codeMediaInputKey(clip.id, key) } : value]))
}
/** Produces a normal composition; the ordinary renderer remains the sole decoder/compositor. */
/**
 * 视频参数的取帧时间：从片段入点起随片段本地时间走（裁掉开头时视频也从相应位置开始），不经过代码片段的变速、倒放与时间重映射；
 * 给了 time 就固定在那一刻。
 */
export function codeMediaInputSeconds(clip: Pick<VideoEditClip, 'start' | 'sourceInUs' | 'sourceRemainder'>, reference: CodeImageReference, frame: number, rate: VideoEditRatio): number {
  return reference.time ?? videoEditSourceSeconds(clip) + (frame - clip.start) * rate.denominator / rate.numerator
}
/**
 * 输入会话的身份：同一会话每帧只取一个时刻，并独占自己的解码位置。
 * - 下层画面：按序列与轨道（同一帧同一份画面）。
 * - 视频：按素材身份加取帧轨迹——固定时刻按该时刻；跟随片段时按片段入点与起点（两个引用在每一帧取同一时刻才共用）。
 *   只按素材区分会让引用同一段录屏、时刻不同的两个片段（两扇录屏窗口交叉溶解）共用一个解码位置，源时间来回跳，
 *   每帧都从关键帧重解。
 * `still`：固定时刻的视频参数（定格帧），整段只显示这一幅，解出一次即可。
 */
export function codeMediaInputComposition(document: VideoEditComposition, clip: VideoEditClip, reference: CodeImageReference, frame: number): { kind: 'video' | 'sequence'; still: boolean; document: VideoEditComposition; frame: number; sessionKey: string; sampleKey: string } {
  if (reference.kind === 'sequence') {
    const clips = document.clips.filter(candidate => candidate.track < clip.track)
    const ids = new Set(clips.map(candidate => candidate.id))
    return { kind: 'sequence', still: false, document: { ...document, clips, captions: [], transitions: document.transitions?.filter(transition => (!transition.leftClipId || ids.has(transition.leftClipId)) && (!transition.rightClipId || ids.has(transition.rightClipId))) }, frame, sessionKey: JSON.stringify([document.id, 'below', clip.track]), sampleKey: String(frame) }
  }
  const media = document.media.find(media => media.id === reference.mediaId && media.kind === 'video')
  const item = document.items.find(item => item.mediaId === media?.id)
  if (!media || !item) throw new Error('视频图片参数引用的素材不存在。')
  const seconds = codeMediaInputSeconds(clip, reference, frame, document.frameRate)
  if (seconds < 0 || seconds >= media.durationSeconds) throw new Error('视频图片参数的取帧时间超出素材范围。')
  const sourceUs = seconds * 1e6
  const input: VideoEditClip = { id: `code-video:${media.id}`, itemId: item.id, name: media.name, kind: 'video', start: 0, duration: 1, track: 0, sourceInUs: Math.floor(sourceUs), sourceRemainder: { numerator: Math.floor((sourceUs % 1) * 1e6), denominator: 1e6 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '',
    // 带采集事件的干净录屏（网页重演）：按录制光标重画鼠标与点击，和普通录屏片段一致
    ...(media.recordingCursor && !media.recordingCursor.cursorBakedIn ? { effects: [{ id: `code-video-cursor:${media.id}`, name: '录制光标', enabled: true, amount: 1, builtin: { id: RECORDING_CURSOR_EFFECT, params: {} } }] } : {}) }
  const trajectory = reference.time !== undefined ? ['at', reference.time] : ['follow', clip.start, clip.sourceInUs, clip.sourceRemainder.numerator, clip.sourceRemainder.denominator]
  const sessionKey = JSON.stringify([document.id, 'video', media.id, media.path, media.sourceRevision, media.assetContent, media.width, media.height, media.durationSeconds, media.frameRate, media.frameRateMode, trajectory])
  return { kind: 'video', still: reference.time !== undefined, document: { ...document, width: media.width, height: media.height, pixelAspectRatio: { numerator: 1, denominator: 1 }, clips: [input], tracks: [{ id: 'code-input', name: '画面', kind: 'video', index: 0, locked: false, enabled: true, muted: true, solo: false }], captions: [], transitions: [] }, frame: 0, sessionKey, sampleKey: JSON.stringify([input.sourceInUs, input.sourceRemainder]) }
}
