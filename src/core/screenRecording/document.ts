import { z } from 'zod'
import { captureOptionsSchema } from './capture'
import { recordingTrackOptionsSchema, recordingTracksSchema } from './tracks'
import { recordingUnderstandingSchema, emptyRecordingUnderstanding } from './understanding'
import { recordingScriptCaptureSchema } from './script'
import { recordingDirectorRunSchema } from './director'

export const recordingMediaSchema = z.object({
  id: z.string().min(1), kind: z.enum(['screen', 'microphone', 'systemAudio', 'camera']),
  path: z.string().min(1), monoUs: z.number().int().nonnegative(), durationUs: z.number().int().nonnegative(),
}).strict()
export const recordingPageReferenceSchema = z.object({
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
  source: z.object({ name: z.string(), options: captureOptionsSchema, cursorEmbedded: z.boolean() }).strict().nullable(),
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
export function createRecordingDocument(): RecordingDocument {
  return recordingDocumentSchema.parse({ sessionId: null, originUs: 0, status: 'empty', source: null, devices: { systemAudio: false }, media: [], tracks: null, eventPages: [], markers: [], understanding: emptyRecordingUnderstanding(), scriptCapture: { baselines: [], calls: [] }, compositions: [] })
}
