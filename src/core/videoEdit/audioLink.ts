import { sliceVideoEditClipKeyframes } from './keyframes'
import type { VideoEditClip, VideoEditDocument, VideoEditSequence } from './document'
import { videoEditClipFrameBoundaryAtSource } from './clipSpeed'
import { videoEditFps, videoEditSourceSeconds } from './time'
import type { VideoEditDocumentSource } from './creativeResult'
import type { AudioEditSubtitleCue } from '../audioEdit/subtitles'
import { remapVideoEditLinkedClip, videoEditLinkedCaptions, type VideoEditLinkedTimeline } from './audioEditLink'
import type { VideoEditCaption } from './timedContent'

export interface AudioLinkNotice { clipId: string; message: string }
/** 新成品的源录音时间线与字幕段：给了就按词把片段对回新成品、重新生成链接字幕。 */
export interface AudioLinkContent { timeline: VideoEditLinkedTimeline; cues: readonly AudioEditSubtitleCue[] }

function linkedTo(clip: VideoEditClip, documentId: string): boolean {
  return clip.kind === 'audio' && clip.creativeSource?.type === 'document' && clip.creativeSource.docRef.docId === documentId
}

/**
 * 音频编辑改动后更新链接它的声音片段。有新旧成品的源录音时间线时，每个片段按它原来对应的源录音位置对回新成品
 * （删掉的内容让它变短，恢复的内容让它变长但不盖过同轨后面的片段）；否则新成品变短时只截短尾部。
 * 整段没有了的片段移除；后续片段位置都不变。给了字幕段时一并重新生成这些片段上的链接字幕。
 */
export function updateVideoEditAudioLinks(document: VideoEditDocument, documentId: string, itemId: string, source: VideoEditDocumentSource, durationSeconds: number, content?: AudioLinkContent): { document: VideoEditDocument; notices: AudioLinkNotice[]; changed: number } {
  const notices: AudioLinkNotice[] = []
  let changed = 0
  const timelineOf = (clip: VideoEditClip): VideoEditLinkedTimeline | undefined => document.media.find(media => media.id === document.items.find(item => item.id === clip.itemId)?.mediaId)?.linkedTimeline
  const sequences = document.sequences.map(sequence => {
    const removed = new Set<string>()
    const fps = videoEditFps(sequence.frameRate)
    const clips = sequence.clips.flatMap((clip): VideoEditClip[] => {
      if (!linkedTo(clip, documentId)) return [clip]
      changed++
      const before = timelineOf(clip)
      const remapped = content && before ? remapVideoEditLinkedClip(clip, fps, before, content.timeline) : undefined
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
    // Timeline transitions cannot retain references to exhausted clips.
    const updated = { ...sequence, clips, ...(sequence.transitions ? { transitions: sequence.transitions.filter(t => !removed.has(t.leftClipId ?? "") && !removed.has(t.rightClipId ?? "")) } : {}) }
    return content ? refreshVideoEditLinkedCaptions(updated, documentId, content.cues, content.timeline.sampleRate, removed) : updated
  })
  return { document: { ...document, sequences }, notices, changed }
}

/**
 * 重新生成一条序列里链接到某份音频编辑文档的字幕：去掉这些片段上原来的链接字幕（保留剪辑这边设的样式与译文），按字幕段重建。
 * 片段上的其他字幕（自动字幕、手动字幕）不动。
 */
export function refreshVideoEditLinkedCaptions(sequence: VideoEditSequence, documentId: string, cues: readonly AudioEditSubtitleCue[], sampleRate: number, removedClipIds: ReadonlySet<string> = new Set()): VideoEditSequence {
  const linked = sequence.clips.filter(clip => linkedTo(clip, documentId))
  const ids = new Set([...linked.map(clip => clip.id), ...removedClipIds])
  const stale = (caption: VideoEditCaption): boolean => Boolean(caption.linkedCaptionId && caption.clipId && ids.has(caption.clipId))
  const kept = new Map((sequence.captions ?? []).filter(stale).map(caption => [`${caption.clipId}|${caption.linkedCaptionId}`, { id: caption.id, ...(caption.style ? { style: caption.style } : {}), ...(caption.translation ? { translation: caption.translation } : {}) }]))
  const fps = videoEditFps(sequence.frameRate)
  const fresh = linked.flatMap(clip => videoEditLinkedCaptions(clip, fps, cues, sampleRate, kept))
  if (!fresh.length && !(sequence.captions ?? []).some(stale)) return sequence
  return { ...sequence, captions: [...(sequence.captions ?? []).filter(caption => !stale(caption)), ...fresh].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)) }
}
