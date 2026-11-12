import { sliceVideoEditClipKeyframes } from './keyframes'
import type { VideoEditClip, VideoEditDocument } from './document'
import { videoEditClipFrameBoundaryAtSource, videoEditClipSourceRange, videoEditClipSourceSecondsAtTime } from './clipSpeed'
import { videoEditFps, videoEditSourceSeconds } from './time'
import type { VideoEditDocumentSource } from './creativeResult'
import { remapVideoEditLinkedClip, remapVideoEditLinkedSeconds, remapVideoEditLinkedSpeechWord, videoEditCaptionsFromAudioEdit, videoEditRestoredCues, type VideoEditLinkedTimeline } from './audioEditLink'
import type { AudioEditSubtitleCue } from '../audioEdit/subtitles'
import { retimeVideoEditContent, type VideoEditCaption } from './timedContent'
import { retimeVideoEditTransitions } from './transitions'
import { retainedCaptionText, type VideoEditCaptionReview, type VideoEditCaptionSpeechWord } from './captionSpeech'
import { normalizeTranscriptSearch } from '../media/transcriptSearch'
import { joinAudioEditText } from '../audioEdit/captions'

export interface AudioLinkNotice { clipId: string; message: string }
function linkedTo(clip: VideoEditClip, documentId: string): boolean {
  return clip.kind === 'audio' && clip.creativeSource?.type === 'document' && clip.creativeSource.docRef.docId === documentId
}
const withReview = (caption: VideoEditCaption, reasons: readonly VideoEditCaptionReview[number][]): VideoEditCaption['reviewReasons'] => {
  const merged = [...new Set([...(caption.reviewReasons ?? []), ...reasons])]
  return merged.length ? merged : undefined
}

/** 按词对回得到的片段：旧片段、新片段和两版成品的源录音时间线。 */
interface RemappedClip { before: VideoEditClip; after: VideoEditClip; from: VideoEditLinkedTimeline; to: VideoEditLinkedTimeline }

/**
 * 一条只属于一个按词对回片段的字幕跟着声音走：首尾按旧成品→源录音→新成品换算，保留用户在剪辑里留的前后余量；
 * 词全部被剪掉时整条移除（口播删掉了这句）。剪掉一部分词时，没手改过的文字按剩下的词重写，手改过的文字保留并标“正文待复核”。
 * 只有剪到词中间、首尾落进剪掉的地方或换算不出范围时才标“时间待复核”。
 */
function retimeLinkedCaption(caption: VideoEditCaption, link: RemappedClip, fps: number): VideoEditCaption[] {
  const { before, after, from, to } = link
  const range = videoEditClipSourceRange(after, fps)
  const lowUs = Math.round(range.from * 1e6), highUs = Math.round(range.to * 1e6)
  const toProgram = (frame: number, edge: 'start' | 'end'): number => videoEditClipFrameBoundaryAtSource(after, remapVideoEditLinkedSeconds(videoEditClipSourceSecondsAtTime(before, frame / fps, fps), from, to, edge), fps)
  const clampToClip = (start: number, end: number): [number, number] => [Math.max(after.start, Math.round(start)), Math.min(after.start + after.duration, Math.round(end))]
  const oldStart = Math.max(before.start, caption.start), oldEnd = Math.min(before.start + before.duration, caption.start + caption.duration)
  let [start, end] = clampToClip(toProgram(oldStart, 'start'), toProgram(oldEnd, 'end'))
  const speech = caption.speech
  if (!speech) {
    // 手动字幕没有逐词依据：能换算出范围就跟着走，中间被剪短才请用户复核时间。
    if (end <= start) return [{ ...caption, reviewReasons: withReview(caption, ['timing']) }]
    if (start === caption.start && end - start === caption.duration) return [caption]
    return [{ ...caption, start, duration: end - start, ...(end - start !== caption.duration ? { reviewReasons: withReview(caption, ['timing']) } : {}) }]
  }
  const words: VideoEditCaptionSpeechWord[] = [], indices: number[] = []
  let partial = false, outside = 0
  speech.words.forEach((word, index) => {
    const mapped = remapVideoEditLinkedSpeechWord(word, from, to)
    if (!mapped) return
    const startUs = Math.max(mapped.startUs, lowUs), endUs = Math.min(mapped.endUs, highUs)
    // 词还在口播里，只是片段被同轨后面的片段挡住没能展开到它：不算删掉
    if (mapped.startUs === mapped.endUs ? startUs !== mapped.startUs || startUs >= highUs : endUs <= startUs) { outside++; return }
    const clipped = startUs !== mapped.startUs || endUs !== mapped.endUs
    partial ||= clipped || mapped.precision === 'estimated' && word.precision !== 'estimated'
    words.push({ ...mapped, startUs, endUs, ...(clipped ? { precision: 'estimated' as const } : {}) }); indices.push(index)
  })
  if (!words.length && !outside) return []
  if (!words.length || outside) {
    // 有词落到片段之外（片段被同轨后面的片段挡住没能展开）：对不上，保留字幕成品（含手改）并解除归属，请用户复核时间。
    // 按声音换算出的新位置有效就放到新位置，免得留在原处与这段时间现在播的（可能是刚恢复的）句子叠在一起。
    const { clipId: _clipId, speech: _speech, ...independent } = caption
    return [{ ...independent, ...(end > start ? { start, duration: end - start } : {}), reviewReasons: withReview(caption, ['timing']) }]
  }
  if (end <= start) {
    // 首尾都落在剪掉的地方：退回按剩下的词定范围。
    const a = videoEditClipFrameBoundaryAtSource(after, words[0].startUs / 1e6, fps), b = videoEditClipFrameBoundaryAtSource(after, words.at(-1)!.endUs / 1e6, fps);
    [start, end] = clampToClip(Math.min(a, b), Math.max(a, b))
    partial = true
    if (end <= start) return [{ ...caption, speech: { ...speech, words }, reviewReasons: withReview(caption, ['timing']) }]
  }
  const dropped = words.length !== speech.words.length
  const untouched = speech.aligned && normalizeTranscriptSearch(caption.text) === normalizeTranscriptSearch(speech.text)
  const rewritten = dropped && untouched ? retainedCaptionText(caption.text, speech.words, indices)?.slice(0, 2000) : undefined
  if (rewritten !== undefined && !rewritten.trim()) return []
  const sameWords = !dropped && words.every((word, index) => word.startUs === speech.words[index].startUs && word.endUs === speech.words[index].endUs && word.precision === speech.words[index].precision)
  if (sameWords && start === caption.start && end - start === caption.duration) return [caption]
  const reviewReasons = withReview(caption, [
    ...(dropped && rewritten === undefined ? ['text' as const] : []), ...(dropped && caption.translation ? ['translation' as const] : []), ...(partial ? ['timing' as const] : []),
  ])
  const { reviewReasons: _previous, ...rest } = caption
  return [{ ...rest, clipId: after.id, start, duration: end - start, ...(rewritten !== undefined ? { text: rewritten, sourceText: words.reduce((text, word) => joinAudioEditText(text, word.text), '') } : {}),
    speech: { ...speech, text: rewritten ?? speech.text, words, aligned: speech.aligned && (rewritten !== undefined || !dropped) },
    ...(reviewReasons ? { reviewReasons } : {}) }]
}

/**
 * 音频编辑改动后更新链接它的声音片段。有新旧成品的源录音时间线时，每个片段按它原来对应的源录音位置对回新成品
 * （删掉的内容让它变短，恢复的内容让它变长但不盖过同轨后面的片段）；否则新成品变短时只截短尾部。
 * 整段没有了的片段移除；后续片段位置都不变。按词对回的片段上的字幕跟着声音一起更新（见 retimeLinkedCaption），
 * 其余字幕只对回逐词参考，换算不了时标“时间待复核”。给了新成品的字幕段（cues）时，这次才恢复的整句在原来就有口播字幕的片段上补回字幕。
 */
export function updateVideoEditAudioLinks(document: VideoEditDocument, documentId: string, itemId: string, source: VideoEditDocumentSource, durationSeconds: number, timeline?: VideoEditLinkedTimeline, cues?: readonly AudioEditSubtitleCue[]): { document: VideoEditDocument; notices: AudioLinkNotice[]; changed: number } {
  const notices: AudioLinkNotice[] = []
  let changed = 0
  const timelineOf = (clip: VideoEditClip): VideoEditLinkedTimeline | undefined => document.media.find(media => media.id === document.items.find(item => item.id === clip.itemId)?.mediaId)?.linkedTimeline
  const sequences = document.sequences.map(sequence => {
    const removed = new Set<string>()
    const refreshed = new Map<string, VideoEditLinkedTimeline | undefined>()
    const remappedClips = new Map<string, RemappedClip>()
    const fps = videoEditFps(sequence.frameRate)
    const clips = sequence.clips.flatMap((clip): VideoEditClip[] => {
      if (!linkedTo(clip, documentId)) return [clip]
      changed++
      const before = timelineOf(clip)
      refreshed.set(clip.id, before)
      const remapped = timeline && before ? remapVideoEditLinkedClip(clip, fps, before, timeline) : undefined
      if (remapped === null) {
        notices.push({ clipId: clip.id, message: '这段声音在音频编辑里已整段剪掉，片段已移除，后续片段位置保持不变。' })
        removed.add(clip.id)
        return []
      }
      if (remapped) {
        // 变长时不盖过同一轨道后面的片段
        const next = Math.min(...sequence.clips.filter(other => other.id !== clip.id && other.track === clip.track && other.start >= clip.start + clip.duration).map(other => other.start))
        const duration = Math.min(remapped.duration, Number.isFinite(next) ? next - clip.start : remapped.duration)
        if (duration !== clip.duration) notices.push({ clipId: clip.id, message: duration < remapped.duration ? '音频编辑里这段变长了，后面紧挨着别的片段，只展开到下一个片段之前。' : duration < clip.duration ? '音频编辑里这段剪短了，片段已按原来的词对回并截短，字幕跟着更新，后续片段位置保持不变。' : '音频编辑里这段变长了，片段已按原来的词对回。' })
        const sliced = duration < clip.duration ? sliceVideoEditClipKeyframes(clip, 0, duration) : clip
        const updatedClip = { ...sliced, itemId, duration, sourceInUs: remapped.sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 }, creativeSource: source }
        remappedClips.set(clip.id, { before: clip, after: updatedClip, from: before!, to: timeline! })
        return [updatedClip]
      }
      const head = videoEditSourceSeconds(clip)
      const boundary = clip.frameHold ? clip.duration : videoEditClipFrameBoundaryAtSource(clip, clip.reverse ? 0 : durationSeconds, fps) - clip.start
      const duration = (clip.reverse ? head > durationSeconds : head >= durationSeconds) ? 0 : Math.min(clip.duration, Math.max(0, Math.floor(boundary + 1e-7)))
      if (duration < clip.duration) notices.push({ clipId: clip.id, message: duration ? '音频作品变短，片段结尾已截短，后续片段位置保持不变。' : '音频作品已短于片段入点，该声音片段已移除，后续片段位置保持不变。' })
      if (!duration) { removed.add(clip.id); return [] }
      return [{ ...sliceVideoEditClipKeyframes(clip, 0, duration), itemId, duration, creativeSource: source }]
    })
    // 整段删除使用普通剪辑的字幕归属规则。
    const retained = removed.size ? retimeVideoEditContent(sequence, { ...sequence, clips: sequence.clips.filter(clip => !removed.has(clip.id)) }).captions : sequence.captions
    const captions = retained?.flatMap((caption): VideoEditCaption[] => {
      const owners = new Set([...(caption.clipId ? [caption.clipId] : []), ...(caption.speech?.words.map(word => word.clipId) ?? [])])
      const only = owners.size === 1 ? remappedClips.get([...owners][0]) : undefined
      if (only) return retimeLinkedCaption(caption, only, fps)
      let referenceChanged = false
      const words = caption.speech?.words.flatMap(word => {
        if (!refreshed.has(word.clipId)) return [word]
        const before = refreshed.get(word.clipId)
        let mapped = before && timeline ? remapVideoEditLinkedSpeechWord(word, before, timeline) : undefined
        const clip = clips.find(value => value.id === word.clipId)
        if (mapped && clip) {
          const range = videoEditClipSourceRange(clip, fps)
          const startUs = Math.max(mapped.startUs, Math.round(range.from * 1e6)), endUs = Math.min(mapped.endUs, Math.round(range.to * 1e6))
          const retained = mapped.startUs === mapped.endUs ? startUs === mapped.startUs && startUs < Math.round(range.to * 1e6) : endUs > startUs
          mapped = retained ? { ...mapped, startUs, endUs, ...(startUs !== mapped.startUs || endUs !== mapped.endUs ? { precision: 'estimated' as const } : {}) } : undefined
        }
        referenceChanged ||= !mapped || mapped.startUs !== word.startUs || mapped.endUs !== word.endUs || mapped.precision !== word.precision
        return mapped ? [mapped] : []
      })
      const result = referenceChanged ? { ...caption,
        speech: words?.length ? { ...caption.speech!, words, aligned: caption.speech!.aligned && words.length === caption.speech!.words.length } : undefined,
        reviewReasons: [...new Set([...(caption.reviewReasons ?? []), 'timing' as const])],
      } : caption
      const owner = clips.find(clip => clip.id === result.clipId)
      if (!owner || !refreshed.has(owner.id) || result.start >= owner.start && result.start + result.duration <= owner.start + owner.duration) return [result]
      // 越界字幕按节目时钟保留成品；同时解除逐词参考，避免后续片段编辑重新认领并裁掉字幕。
      const { clipId: _clipId, speech: _speech, ...independent } = result
      return [{ ...independent, reviewReasons: [...new Set([...(independent.reviewReasons ?? []), 'timing' as const])] }]
    })
    const fromThisAudio = new Set(sequence.captions?.filter(caption => (caption.clipId && refreshed.has(caption.clipId)) || caption.speech?.words.some(word => refreshed.has(word.clipId))).map(caption => caption.id))
    // 恢复的句子：只补在原来就带着这份口播字幕的片段上，用户删光字幕的片段不会被重新加上；与已有字幕时间重叠的不补
    const restored = cues && timeline ? [...remappedClips.values()].flatMap(link => {
      const captioned = sequence.captions?.some(caption => caption.clipId === link.before.id || caption.speech?.words.some(word => word.clipId === link.before.id))
      return captioned ? videoEditCaptionsFromAudioEdit(link.after, fps, videoEditRestoredCues(cues, link.from, link.to), timeline.sampleRate) : []
    }).filter(added => !captions?.some(caption => fromThisAudio.has(caption.id) && caption.start < added.start + added.duration && added.start < caption.start + caption.duration)) : []
    if (captions && restored.length) { captions.push(...restored); captions.sort((left, right) => left.start - right.start) }
    // 片段变短时两端的过渡（含淡入淡出）跟着缩短，放不下就去掉
    const updated = retimeVideoEditTransitions(sequence, { ...sequence, clips, ...(sequence.transitions ? { transitions: sequence.transitions.filter(t => !removed.has(t.leftClipId ?? "") && !removed.has(t.rightClipId ?? "")) } : {}) })
    return { ...updated, ...(captions ? { captions } : {}) }
  })
  return { document: { ...document, sequences }, notices, changed }
}
