import { joinAudioEditText } from '../audioEdit/captions'
import { formatAudioEditSubtitleText, type AudioEditSubtitleCue } from '../audioEdit/subtitles'
import type { AudioEditTimelineSpan } from '../audioEdit/types'
import { videoEditClipFrameBoundaryAtSource, videoEditClipSourceRange } from './clipSpeed'
import type { VideoEditClip } from './document'
import type { VideoEditCaption } from './timedContent'
import type { VideoEditCaptionSpeechWord } from './captionSpeech'
import type { VideoEditLinkedTimeline } from './linkedTimeline'
export { videoEditLinkedTimelineSchema, type VideoEditLinkedTimeline } from './linkedTimeline'

export function videoEditLinkedTimeline(spans: readonly AudioEditTimelineSpan[], sampleRate: number): VideoEditLinkedTimeline {
  const flat: number[] = []
  for (const span of spans) {
    if (flat.length && flat[flat.length - 1] === span.sourceStartFrame) flat[flat.length - 1] = span.sourceEndFrame
    else flat.push(span.sourceStartFrame, span.sourceEndFrame)
  }
  return { sampleRate, spans: flat }
}

/** 成品第 frame 帧对应的源录音帧（超出两端时夹住）。 */
function outputToSource(timeline: VideoEditLinkedTimeline, frame: number, edge: 'start' | 'end' = 'start'): number {
  let output = 0
  for (let index = 0; index < timeline.spans.length; index += 2) {
    const length = timeline.spans[index + 1] - timeline.spans[index]
    if (frame < output + length || edge === 'end' && frame === output + length || index + 2 >= timeline.spans.length) return timeline.spans[index] + Math.max(0, Math.min(length, frame - output))
    output += length
  }
  return 0
}

/** 逐词参考与声音片段共用源录音时钟；成品删掉的词不再作为剪辑依据。 */
export function remapVideoEditLinkedSpeechWord(word: VideoEditCaptionSpeechWord, before: VideoEditLinkedTimeline, after: VideoEditLinkedTimeline): VideoEditCaptionSpeechWord | undefined {
  const from = outputToSource(before, Math.round(word.startUs * before.sampleRate / 1e6)) / before.sampleRate
  if (word.startUs === word.endUs) {
    const frame = Math.round(from * after.sampleRate)
    if (!after.spans.some((start, index) => index % 2 === 0 && frame >= start && frame < after.spans[index + 1])) return undefined
    const timeUs = Math.round(sourceToOutput(after, frame, 'start') * 1e6 / after.sampleRate)
    return { ...word, startUs: timeUs, endUs: timeUs }
  }
  const to = outputToSource(before, Math.round(word.endUs * before.sampleRate / 1e6), 'end') / before.sampleRate
  const start = sourceToOutput(after, Math.round(from * after.sampleRate), 'start')
  const end = sourceToOutput(after, Math.round(to * after.sampleRate), 'end')
  if (end <= start) return undefined
  const startUs = Math.round(start * 1e6 / after.sampleRate), endUs = Math.round(end * 1e6 / after.sampleRate)
  const partial = endUs - startUs < word.endUs - word.startUs
  return { ...word, startUs, endUs, ...(partial ? { precision: 'estimated' as const } : {}) }
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
  const to = outputToSource(before, Math.round(range.to * rate), 'end')
  const start = sourceToOutput(after, from, 'start'), end = sourceToOutput(after, to, 'end')
  if (end <= start) return null
  const sourceInUs = Math.round(start * 1e6 / rate)
  const duration = Math.max(1, Math.round((end - start) / rate * fps))
  return { sourceInUs, duration }
}

/** 按音频编辑字幕段一次性生成剪辑字幕，保留逐词参考；部分源范围只取覆盖到的词。 */
export function videoEditCaptionsFromAudioEdit(clip: VideoEditClip, fps: number, cues: readonly AudioEditSubtitleCue[], sampleRate: number, createId: () => string = () => crypto.randomUUID()): VideoEditCaption[] {
  const range = videoEditClipSourceRange(clip, fps)
  const seconds = (frame: number): number => frame / sampleRate
  const captions: VideoEditCaption[] = []
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
    captions.push({
      id: createId(), clipId: clip.id, start, duration: end - start, text: text.slice(0, 2000),
      speech: { text: text.slice(0, 2000), aligned: true, words: words.map(word => {
        const wordStartUs = Math.round(seconds(word.startFrame) * 1e6), wordEndUs = Math.round(seconds(word.endFrame) * 1e6)
        const startUs = Math.max(wordStartUs, Math.round(range.from * 1e6)), endUs = Math.min(wordEndUs, Math.round(range.to * 1e6))
        return { clipId: clip.id, text: word.text, startUs, endUs, precision: startUs !== wordStartUs || endUs !== wordEndUs ? 'estimated' as const : 'word' as const }
      }) },
    })
  }
  return captions
}
