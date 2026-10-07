import { z } from 'zod'
import type { VideoEditClip } from './document'
import { evaluateVideoEditKeyframes, isVideoEditDuckingKeyframe, videoEditKeyframesSchema, type VideoEditKeyframe, type VideoEditKeyframes } from './keyframes'

export const videoEditAudioRoleSchema = z.enum(['dialogue', 'music', 'sound_effect', 'ambience'])
export type VideoEditAudioRole = z.infer<typeof videoEditAudioRoleSchema>
export const videoEditDuckingSettingsSchema = z.object({
  targetRole: z.enum(['dialogue', 'sound_effect']).default('dialogue'),
  reductionDb: z.number().finite().min(0).max(60).default(12),
  sensitivity: z.number().finite().min(0).max(100).default(50),
  fadeSeconds: z.number().finite().min(0.01).max(5).default(0.3),
}).strict()
export type VideoEditDuckingSettings = z.infer<typeof videoEditDuckingSettingsSchema>
export interface VideoEditAudioActivity { startSeconds: number; endSeconds: number }
/** Higher sensitivity includes quieter sounds. Keep breath-sized gaps in one phrase. */
export function videoEditActivityThreshold(sensitivity: number): number {
  return -20 - z.number().min(0).max(100).parse(sensitivity) * 0.4
}
export function mergeVideoEditAudioActivity(ranges: readonly VideoEditAudioActivity[], gapSeconds = 0): VideoEditAudioActivity[] {
  const result: VideoEditAudioActivity[] = []
  for (const range of [...ranges].sort((a, b) => a.startSeconds - b.startSeconds)) {
    if (!Number.isFinite(range.startSeconds) || !Number.isFinite(range.endSeconds) || range.endSeconds <= range.startSeconds) continue
    const last = result[result.length - 1]
    if (last && range.startSeconds <= last.endSeconds + gapSeconds) last.endSeconds = Math.max(last.endSeconds, range.endSeconds)
    else result.push({ ...range })
  }
  return result
}
/** Non-silent ranges from FFmpeg; times are relative to the supplied PCM, not source media. */
export function invertVideoEditSilence(silence: readonly VideoEditAudioActivity[], durationSeconds: number): VideoEditAudioActivity[] {
  const result: VideoEditAudioActivity[] = []; let cursor = 0
  for (const range of mergeVideoEditAudioActivity(silence)) {
    const start = Math.max(0, Math.min(durationSeconds, range.startSeconds)); const end = Math.max(start, Math.min(durationSeconds, range.endSeconds))
    if (start > cursor) result.push({ startSeconds: cursor, endSeconds: start })
    cursor = Math.max(cursor, end)
  }
  if (cursor < durationSeconds) result.push({ startSeconds: cursor, endSeconds: durationSeconds })
  return result
}
/** Preserve hand-authored points verbatim, including collisions; replace only generated points. */
export function replaceVideoEditDuckingKeyframes(clip: VideoEditClip, activity: readonly VideoEditAudioActivity[], fps: number, rawSettings: VideoEditDuckingSettings): VideoEditKeyframes {
  const settings = videoEditDuckingSettingsSchema.parse(rawSettings)
  const manual = (clip.curves?.volume ?? []).filter(point => !isVideoEditDuckingKeyframe(point))
  const end = clip.duration - 1; const fade = Math.max(1, Math.round(settings.fadeSeconds * fps))
  const relative = activity.map(range => ({ startSeconds: Math.max(0, Math.floor(range.startSeconds * fps - clip.start)), endSeconds: Math.min(clip.duration, Math.ceil(range.endSeconds * fps - clip.start)) }))
    .filter(range => range.endSeconds > range.startSeconds)
  // Merge complete fade windows so close phrases never pump back up between words.
  const phrases = mergeVideoEditAudioActivity(relative, fade * 2)
  const generated = new Map<number, VideoEditKeyframe>()
  const put = (time: number, gain: number): void => {
    if (manual.some(point => point.time === time)) return
    const value = evaluateVideoEditKeyframes(manual, time, clip.volume) * gain
    generated.set(time, { time, value, interpolation: 'linear', source: 'ducking', duckingOrigin: { time, value } })
  }
  const gain = 10 ** (-settings.reductionDb / 20)
  for (const phrase of phrases) {
    const start = phrase.startSeconds; const stop = Math.min(end, phrase.endSeconds)
    if (start > 0) put(Math.max(0, start - fade), 1)
    put(start, gain); put(stop, gain)
    if (stop < end) put(Math.min(end, stop + fade), 1)
  }
  const result = [...manual, ...generated.values()].sort((a, b) => a.time - b.time)
  return videoEditKeyframesSchema.parse(result)
}
