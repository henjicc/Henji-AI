import { sampleScreenAttention, screenAttentionZoom, SCREEN_ATTENTION_LOOKBACK_US, screenAttentionSettingsSchema, type ScreenAttentionSettings, type ScreenAttentionRegion } from '@/core/videoEdit/screenAttention'
import { generateVideoEditReframeKeyframes, videoEditReframeViewport, type VideoEditAttentionBox } from '@/core/videoEdit/reframe'
import { videoEditClipMedia, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditClipSourceTimeAt, videoEditClipSpeedValue } from '@/core/videoEdit/clipSpeed'
import { videoEditSourceSeconds } from '@/core/videoEdit/time'
import type { VideoEditSize } from '@/core/videoEdit/clipGeometry'
import { VideoEditRecordingCursorSource, type RecordingCursorPageReader } from './videoEditRecordingCursorSource'

export interface VideoEditScreenAttentionRequest {
  composition: VideoEditComposition; clipId: string; target: VideoEditSize; settings: ScreenAttentionSettings
  regions?: ScreenAttentionRegion[]
}
export interface VideoEditScreenAttentionResult { clip: VideoEditClip; quietFrames: number; impreciseCapabilities: number }

/** No decoding/model needed. Read at most eight source seconds plus one two-second output chunk; frame math runs in a Worker. */
export async function analyzeVideoEditScreenAttention(request: VideoEditScreenAttentionRequest, signal = new AbortController().signal, read?: RecordingCursorPageReader): Promise<VideoEditScreenAttentionResult> {
  const clip = request.composition.clips.find(value => value.id === request.clipId)
  if (!clip) throw new Error('屏幕原片片段不存在。')
  const media = videoEditClipMedia(request.composition, clip); const source = media?.recordingCursor
  if (!media || !source) throw new Error('此原片没有录制事件日志，请先绑定录制来源。')
  const settings = screenAttentionSettingsSchema.parse(request.settings)
  if (settings.sections.some(section => section.endSeconds > clip.duration / request.composition.fps)) throw new Error('sections 的段落终点超过片段时长，请使用片段内秒。')
  const picture = { width: source.width, height: source.height }
  if (media.width * source.height !== media.height * source.width) throw new Error('原片与事件坐标画幅不同，请恢复匹配的录制来源。')
  const reader = new VideoEditRecordingCursorSource(read)
  const viewport = videoEditReframeViewport(picture, request.target)
  const boxes: Array<VideoEditAttentionBox | null> = []; const zoom: number[] = []; const imprecise = new Set<string>(); let quietFrames = 0
  const chunkFrames = Math.max(1, Math.floor(request.composition.fps * 2 / Math.max(1, videoEditClipSpeedValue(clip))))
  try {
    for (let start = 0; start < clip.duration; start += chunkFrames) {
      signal.throwIfAborted()
      const times = Array.from({ length: Math.min(chunkFrames, clip.duration - start) }, (_, i) => source.recordingStartUs + Math.round(videoEditSourceSeconds(videoEditClipSourceTimeAt(clip, start + i, request.composition.frameRate)) * 1_000_000))
      const from = Math.min(times[0], times[times.length - 1]); const to = Math.max(times[0], times[times.length - 1])
      const events = await reader.range(source, from - SCREEN_ATTENTION_LOOKBACK_US, to, signal)
      for (const e of events) if (e.kind === 'capability' && e.phase === 'started' && e.recordingUs + Math.max(2_000_000, settings.minimumStaySeconds * 1_000_000) >= from && !request.regions?.some(value => value.eventId === e.eventId)) imprecise.add(e.eventId)
      const samples = sampleScreenAttention(events, times, picture, request.target, settings, request.regions)
      for (const [i, sample] of samples.entries()) {
        const seconds = (start + i) / request.composition.fps
        const section = settings.sections.find(value => seconds >= value.startSeconds && seconds < value.endSeconds)
        // Resolve paragraph strength in clip time; all signals and source timing stay identical.
        const sectionZoom = section ? screenAttentionZoom(sample.box, viewport, section.strength) : sample.zoom
        boxes.push(sample.box); zoom.push(Math.max(1, sectionZoom)); if (!sample.box) quietFrames++
      }
    }
    signal.throwIfAborted()
    return { clip: generateVideoEditReframeKeyframes(clip, boxes, picture, request.target, request.composition.fps, { motion: 'default', attention: 'auto' }, [], { source: 'screen_attention', zoom, transitionSeconds: settings.transitionSeconds }), quietFrames, impreciseCapabilities: imprecise.size }
  } finally { reader.clear() }
}
