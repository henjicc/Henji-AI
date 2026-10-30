import { sliceVideoEditClipKeyframes } from './keyframes'
import type { VideoEditClip, VideoEditDocument } from './document'
import { videoEditClipFrameBoundaryAtSource, videoEditClipSourceRange } from './clipSpeed'
import { videoEditFps, videoEditSourceSeconds } from './time'
import type { VideoEditDocumentSource } from './creativeResult'
import { remapVideoEditLinkedClip, remapVideoEditLinkedSpeechWord, type VideoEditLinkedTimeline } from './audioEditLink'
import { retimeVideoEditContent } from './timedContent'

export interface AudioLinkNotice { clipId: string; message: string }
function linkedTo(clip: VideoEditClip, documentId: string): boolean {
  return clip.kind === 'audio' && clip.creativeSource?.type === 'document' && clip.creativeSource.docRef.docId === documentId
}

/**
 * 音频编辑改动后更新链接它的声音片段。有新旧成品的源录音时间线时，每个片段按它原来对应的源录音位置对回新成品
 * （删掉的内容让它变短，恢复的内容让它变长但不盖过同轨后面的片段）；否则新成品变短时只截短尾部。
 * 整段没有了的片段移除；后续片段位置都不变。字幕由剪辑持有，声音刷新不提供字幕数据。
 */
export function updateVideoEditAudioLinks(document: VideoEditDocument, documentId: string, itemId: string, source: VideoEditDocumentSource, durationSeconds: number, timeline?: VideoEditLinkedTimeline): { document: VideoEditDocument; notices: AudioLinkNotice[]; changed: number } {
  const notices: AudioLinkNotice[] = []
  let changed = 0
  const timelineOf = (clip: VideoEditClip): VideoEditLinkedTimeline | undefined => document.media.find(media => media.id === document.items.find(item => item.id === clip.itemId)?.mediaId)?.linkedTimeline
  const sequences = document.sequences.map(sequence => {
    const removed = new Set<string>()
    const refreshed = new Map<string, VideoEditLinkedTimeline | undefined>()
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
        if (duration !== clip.duration) notices.push({ clipId: clip.id, message: duration < remapped.duration ? '音频编辑里这段变长了，后面紧挨着别的片段，只展开到下一个片段之前。' : duration < clip.duration ? '音频编辑里这段剪短了，片段已按原来的词对回并截短，后续片段位置保持不变。' : '音频编辑里这段变长了，片段已按原来的词对回。' })
        const sliced = duration < clip.duration ? sliceVideoEditClipKeyframes(clip, 0, duration) : clip
        return [{ ...sliced, itemId, duration, sourceInUs: remapped.sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 }, ...(clip.fadeInFrames ? { fadeInFrames: Math.min(duration, clip.fadeInFrames) } : {}), ...(clip.fadeOutFrames ? { fadeOutFrames: Math.min(duration, clip.fadeOutFrames) } : {}), creativeSource: source }]
      }
      const head = videoEditSourceSeconds(clip)
      const boundary = clip.frameHold ? clip.duration : videoEditClipFrameBoundaryAtSource(clip, clip.reverse ? 0 : durationSeconds, fps) - clip.start
      const duration = (clip.reverse ? head > durationSeconds : head >= durationSeconds) ? 0 : Math.min(clip.duration, Math.max(0, Math.floor(boundary + 1e-7)))
      if (duration < clip.duration) notices.push({ clipId: clip.id, message: duration ? '音频作品变短，片段结尾已截短，后续片段位置保持不变。' : '音频作品已短于片段入点，该声音片段已移除，后续片段位置保持不变。' })
      if (!duration) { removed.add(clip.id); return [] }
      return [{ ...sliceVideoEditClipKeyframes(clip, 0, duration), itemId, duration, ...(clip.fadeInFrames ? { fadeInFrames: Math.min(duration, clip.fadeInFrames) } : {}), ...(clip.fadeOutFrames ? { fadeOutFrames: Math.min(duration, clip.fadeOutFrames) } : {}), creativeSource: source }]
    })
    // 整段删除使用普通剪辑的字幕归属规则；保留片段只更新参考词，不改字幕成品。
    const retained = removed.size ? retimeVideoEditContent(sequence, { ...sequence, clips: sequence.clips.filter(clip => !removed.has(clip.id)) }).captions : sequence.captions
    const captions = retained?.map(caption => {
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
      if (!owner || !refreshed.has(owner.id) || result.start >= owner.start && result.start + result.duration <= owner.start + owner.duration) return result
      // 越界字幕按节目时钟保留成品；同时解除逐词参考，避免后续片段编辑重新认领并裁掉字幕。
      const { clipId: _clipId, speech: _speech, ...independent } = result
      return { ...independent, reviewReasons: [...new Set([...(independent.reviewReasons ?? []), 'timing' as const])] }
    })
    const updated = { ...sequence, clips, ...(sequence.transitions ? { transitions: sequence.transitions.filter(t => !removed.has(t.leftClipId ?? "") && !removed.has(t.rightClipId ?? "")) } : {}) }
    return { ...updated, ...(captions ? { captions } : {}) }
  })
  return { document: { ...document, sequences }, notices, changed }
}
