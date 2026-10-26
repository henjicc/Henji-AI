import { joinAudioEditText } from '../audioEdit/captions'
import { formatAudioEditSubtitleText, type AudioEditSubtitleCue } from '../audioEdit/subtitles'
import type { AudioEditTimelineSpan } from '../audioEdit/types'
import { videoEditClipFrameBoundaryAtSource, videoEditClipSourceRange } from './clipSpeed'
import type { VideoEditClip } from './document'
import type { VideoEditCaption } from './timedContent'
import type { VideoEditLinkedTimeline } from './linkedTimeline'
export { videoEditLinkedTimelineSchema, type VideoEditLinkedTimeline } from './linkedTimeline'

/*
 * 音频编辑与剪辑的动态链接（像 Adobe 的动态链接）：剪辑里的声音片段直接引用音频编辑文档，
 * 字幕也不复制成一份 SRT，而是按音频编辑里定稿的字幕段生成，带着逐词时间，跟着片段走。
 *
 * - 成品时间线：成品依次由音频编辑源录音的这些采样帧区间拼成。音频编辑重新剪辑后，
 *   剪辑里每一段链接声音按它原来对应的源录音位置对回新成品（删掉的内容让它变短，恢复的内容让它变长）。
 * - 链接字幕：文字、断句与时间都来自音频编辑；剪辑只保留自己的样式与译文。
 */

export function videoEditLinkedTimeline(spans: readonly AudioEditTimelineSpan[], sampleRate: number): VideoEditLinkedTimeline {
  const flat: number[] = []
  for (const span of spans) {
    if (flat.length && flat[flat.length - 1] === span.sourceStartFrame) flat[flat.length - 1] = span.sourceEndFrame
    else flat.push(span.sourceStartFrame, span.sourceEndFrame)
  }
  return { sampleRate, spans: flat }
}

/** 成品第 frame 帧对应的源录音帧（超出两端时夹住）。 */
function outputToSource(timeline: VideoEditLinkedTimeline, frame: number): number {
  let output = 0
  for (let index = 0; index < timeline.spans.length; index += 2) {
    const length = timeline.spans[index + 1] - timeline.spans[index]
    if (frame < output + length || index + 2 >= timeline.spans.length) return timeline.spans[index] + Math.max(0, Math.min(length, frame - output))
    output += length
  }
  return 0
}
/** 源录音帧在成品里的位置；落在剪掉的地方时，开头取后面第一个保留的帧，结尾取前面最后一个保留的帧。 */
function sourceToOutput(timeline: VideoEditLinkedTimeline, frame: number, edge: 'start' | 'end'): number {
  let output = 0
  for (let index = 0; index < timeline.spans.length; index += 2) {
    const start = timeline.spans[index], end = timeline.spans[index + 1]
    if (frame < start) return output
    if (frame < end || (edge === 'end' && frame === end)) return output + frame - start
    output += end - start
  }
  return output
}

/**
 * 音频编辑重新剪辑后，一段链接声音片段在新成品里的源范围：按它原来对应的源录音位置对回去。
 * 变速、倒放、速度曲线、定格的片段不处理（返回 undefined，按原来的规则只截短尾部）；整段被剪掉时返回 null。
 */
export function remapVideoEditLinkedClip(clip: VideoEditClip, fps: number, before: VideoEditLinkedTimeline, after: VideoEditLinkedTimeline): { sourceInUs: number; duration: number } | null | undefined {
  if (clip.speed || clip.reverse || clip.timeRemap || clip.frameHold || before.sampleRate !== after.sampleRate) return undefined
  const rate = before.sampleRate
  const range = videoEditClipSourceRange(clip, fps)
  const from = outputToSource(before, Math.round(range.from * rate))
  const to = outputToSource(before, Math.round(range.to * rate))
  const start = sourceToOutput(after, from, 'start'), end = sourceToOutput(after, to, 'end')
  if (end <= start) return null
  const sourceInUs = Math.round(start * 1e6 / rate)
  const duration = Math.max(1, Math.round((end - start) / rate * fps))
  return { sourceInUs, duration }
}

/**
 * 一段链接声音片段上的字幕：取落在它源范围里的字幕段，时间按片段换算，带着逐词来源（切开、移动片段时字幕按词跟着走）。
 * 片段只盖住一段字幕的一部分时只显示盖住的那几个词。kept 按 `片段|字幕段` 保留剪辑这边的字幕 ID、样式与译文（重新生成后引用不变）。
 * 新出现的字幕（音频编辑里重新分段，或片段切开后新的一侧）沿用同一字幕段原来的样式，没有就沿用前一条，整条字幕样式保持一致。
 */
export function videoEditLinkedCaptions(clip: VideoEditClip, fps: number, cues: readonly AudioEditSubtitleCue[], sampleRate: number, kept: ReadonlyMap<string, Partial<Pick<VideoEditCaption, 'id' | 'style' | 'translation'>>> = new Map(), createId: () => string = () => crypto.randomUUID()): VideoEditCaption[] {
  const range = videoEditClipSourceRange(clip, fps)
  const seconds = (frame: number): number => frame / sampleRate
  const captions: VideoEditCaption[] = []
  const cueStyle = (cueId: string): VideoEditCaption['style'] => [...kept].find(([key, value]) => key.endsWith(`|${cueId}`) && value.style)?.[1].style
  let previousStyle = [...kept.values()].find(value => value.style)?.style
  for (const cue of cues) {
    if (seconds(cue.endFrame) <= range.from || seconds(cue.startFrame) >= range.to) continue
    const words = cue.words.filter(word => seconds(word.endFrame) > range.from && seconds(word.startFrame) < range.to)
    if (!words.length) continue
    const whole = words.length === cue.words.length
    const from = Math.max(range.from, seconds(whole ? cue.startFrame : words[0].startFrame))
    const to = Math.min(range.to, seconds(whole ? cue.endFrame : words.at(-1)!.endFrame))
    const a = videoEditClipFrameBoundaryAtSource(clip, from, fps), b = videoEditClipFrameBoundaryAtSource(clip, to, fps)
    const start = Math.max(clip.start, Math.round(Math.min(a, b))), end = Math.min(clip.start + clip.duration, Math.round(Math.max(a, b)))
    if (end <= start) continue
    const text = whole ? cue.text : formatAudioEditSubtitleText(words.reduce((value, word) => joinAudioEditText(value, word.text), ''))
    if (!text) continue
    const extra = kept.get(`${clip.id}|${cue.id}`)
    const style = extra?.style || cueStyle(cue.id) || previousStyle
    if (style) previousStyle = style
    captions.push({
      id: extra?.id ?? createId(), clipId: clip.id, linkedCaptionId: cue.id, start, duration: end - start, text: text.slice(0, 2000),
      speech: { text: text.slice(0, 2000), aligned: true, words: words.map(word => ({ clipId: clip.id, text: word.text, startUs: Math.round(seconds(word.startFrame) * 1e6), endUs: Math.round(seconds(word.endFrame) * 1e6), precision: 'word' as const })) },
      ...(style ? { style } : {}), ...(extra?.translation ? { translation: extra.translation } : {}),
    })
  }
  return captions
}
