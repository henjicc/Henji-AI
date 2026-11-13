import { z } from 'zod'
import { captureOptionsSchema } from './capture'
import { recordingTrackOptionsSchema, recordingTracksSchema } from './tracks'
import { recordingUnderstandingSchema, emptyRecordingUnderstanding } from './understanding'
import { recordingScriptCaptureSchema } from './script'
import { recordingDirectorRunSchema } from './director'

const recordingMediaSchema = z.object({
  id: z.string().min(1), kind: z.enum(['screen', 'microphone', 'systemAudio', 'camera']),
  path: z.string().min(1), monoUs: z.number().int().nonnegative(), durationUs: z.number().int().nonnegative(),
  /**
   * 有这一项说明文件是“连续文件”：会话时钟上的这些时间段（暂停、来源丢失）不在文件里，文件时间轴直接跳过它们。
   * 没有这一项的文件，文件内位置就是“会话时刻减 monoUs”。两种都经 range.ts 的 recordingFileUs 换算，不要自己减。
   */
  gaps: z.array(z.object({ startUs: z.number().int().nonnegative(), endUs: z.number().int().nonnegative() }).strict()).optional(),
}).strict()
const recordingPageReferenceSchema = z.object({
  path: z.string().min(1), firstSequence: z.number().int().nonnegative(), lastSequence: z.number().int().nonnegative(),
}).strict()
export const recordingDocumentSchema = z.object({
  directorRun: recordingDirectorRunSchema.optional(),
  sessionId: z.string().uuid().nullable(), originUs: z.number().int().nonnegative(),
  /** Session clock when the countdown ended and the recording really began; capture warmed up before it is not part of the result. */
  startUs: z.number().int().nonnegative().optional(),
  /** Session clock when the person pressed stop; every track ends here even if an encoder flushes a moment longer. */
  endUs: z.number().int().nonnegative().optional(),
  /** Paused stretches on the session clock: from the pause press until every track was capturing again. No track keeps anything inside them. */
  pauses: z.array(z.object({ startUs: z.number().int().nonnegative(), endUs: z.number().int().nonnegative() }).strict().refine(value => value.endUs >= value.startUs, '暂停结束早于开始')).optional(),
  status: z.enum(['empty', 'prepared', 'recording', 'paused', 'stopped', 'interrupted']),
  source: z.object({
    name: z.string(), options: captureOptionsSchema, cursorEmbedded: z.boolean(),
    /** The person's own pointer when recording: arrow height as % of the picture height, and light or black. The redrawn pointer starts out like it. */
    cursor: z.object({ size: z.number().positive().max(20), style: z.enum(['light', 'dark']) }).strict().optional(),
  }).strict().nullable(),
  devices: recordingTrackOptionsSchema,
  media: z.array(recordingMediaSchema),
  tracks: recordingTracksSchema.nullable(),
  eventPages: z.array(recordingPageReferenceSchema),
  markers: z.array(z.object({ id: z.string(), monoUs: z.number().int().nonnegative(), note: z.string().max(4000) }).strict()),
  understanding: recordingUnderstandingSchema,
  scriptCapture: recordingScriptCaptureSchema,
  compositions: z.array(z.object({ documentId: z.string(), compositionId: z.string() }).strict()),
}).strict()
export type RecordingDocument = z.infer<typeof recordingDocumentSchema>
export type RecordingMedia = z.infer<typeof recordingMediaSchema>
/** 应用崩溃时停在录制中，或中断后还有没补齐时长的画面分片：导入前要先恢复。 */
export function recordingNeedsRecovery(content: Pick<RecordingDocument, 'status' | 'media'>): boolean {
  return ['prepared', 'recording', 'paused'].includes(content.status) || content.status === 'interrupted' && content.media.some(media => media.kind === 'screen' && media.durationUs === 0)
}
export function createRecordingDocument(): RecordingDocument {
  return recordingDocumentSchema.parse({ sessionId: null, originUs: 0, status: 'empty', source: null, devices: { systemAudio: false }, media: [], tracks: null, eventPages: [], markers: [], understanding: emptyRecordingUnderstanding(), scriptCapture: { baselines: [], calls: [] }, compositions: [] })
}
