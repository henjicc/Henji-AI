import { z } from 'zod'
import { captureOptionsSchema } from './capture'
import { recordingTrackOptionsSchema, recordingTracksSchema } from './tracks'
import { recordingUnderstandingSchema, emptyRecordingUnderstanding } from './understanding'
import { recordingScriptCaptureSchema } from './script'

export const recordingMediaSchema = z.object({
  id: z.string().min(1), kind: z.enum(['screen', 'microphone', 'systemAudio', 'camera']),
  path: z.string().min(1), monoUs: z.number().int().nonnegative(), durationUs: z.number().int().nonnegative(),
}).strict()
export const recordingPageReferenceSchema = z.object({
  path: z.string().min(1), firstSequence: z.number().int().nonnegative(), lastSequence: z.number().int().nonnegative(),
}).strict()
export const recordingDocumentSchema = z.object({
  sessionId: z.string().uuid().nullable(), originUs: z.number().int().nonnegative(),
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
