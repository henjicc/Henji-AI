import { z } from 'zod'
import { clockAnchorSchema, monoSpanSchema, safeClockSchema } from '../captureLog/clock'

export const recordingTrackKindSchema = z.enum(['microphone', 'systemAudio', 'camera'])
export type RecordingTrackKind = z.infer<typeof recordingTrackKindSchema>
export const recordingTrackOptionsSchema = z.object({
  microphone: z.object({ deviceId: z.string().min(1).optional() }).strict().optional(),
  systemAudio: z.boolean().default(false),
  camera: z.object({ deviceId: z.string().min(1).optional(), width: z.number().int().min(160).max(3840).default(1280), height: z.number().int().min(120).max(2160).default(720), frameRate: z.number().int().min(1).max(60).default(30) }).strict().optional(),
}).strict()
export type RecordingTrackOptions = z.infer<typeof recordingTrackOptionsSchema>
export const recordingTrackSegmentSchema = z.object({
  id: z.string().uuid(), file: z.string().regex(/^[a-f0-9-]+\.(wav|mp4)$/), monoSpanUs: monoSpanSchema,
  sampleRate: z.number().int().positive().optional(), channels: z.number().int().min(1).max(2).optional(),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
  units: safeClockSchema.positive(), latencyCompensationUs: z.number().int(), sourceClockOffsetUs: z.number().int().optional(), anchors: z.array(clockAnchorSchema).min(1),
}).strict()
export type RecordingTrackSegment = z.infer<typeof recordingTrackSegmentSchema>
export const recordingTracksSchema = z.object({
  version: z.literal(1), sessionId: z.string().uuid(), originUs: safeClockSchema,
  tracks: z.array(z.object({
    kind: recordingTrackKindSchema, segments: z.array(recordingTrackSegmentSchema),
    gaps: z.array(z.object({ monoSpanUs: monoSpanSchema, reason: z.enum(['pause', 'device', 'muted', 'missing-data']) }).strict()),
    warnings: z.array(z.enum(['system-audio-silent', 'system-audio-unavailable'])),
  }).strict()).max(3),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.tracks.map(track => track.kind)).size !== value.tracks.length) ctx.addIssue({ code: 'custom', message: '录制轨道重复' })
  for (const track of value.tracks) for (const [index, segment] of track.segments.entries()) {
    if (index && segment.monoSpanUs[0] < track.segments[index - 1].monoSpanUs[1]) ctx.addIssue({ code: 'custom', message: '录制分段重叠' })
    if (segment.anchors.some(anchor => anchor.monoUs < segment.monoSpanUs[0] || anchor.monoUs > segment.monoSpanUs[1])) ctx.addIssue({ code: 'custom', message: '录制校准点越界' })
  }
})
export type RecordingTracks = z.infer<typeof recordingTracksSchema>
export function createRecordingTracks(sessionId: string, originUs: number, tracks: RecordingTracks['tracks']): RecordingTracks {
  return recordingTracksSchema.parse({ version: 1, sessionId, originUs, tracks })
}

/** Consumers place each real segment separately. Gaps are not filled with fabricated samples. */
export function recordingTrackPlacement(segment: RecordingTrackSegment, recordingStartUs: number, fps: number): { startFrame: number; durationFrames: number } {
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isSafeInteger(recordingStartUs)) throw new Error('录制导入时钟无效')
  return { startFrame: Math.round((segment.monoSpanUs[0] - recordingStartUs) * fps / 1_000_000), durationFrames: Math.ceil((segment.monoSpanUs[1] - segment.monoSpanUs[0]) * fps / 1_000_000) }
}
