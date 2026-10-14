import { z } from 'zod'
import { recordingTrackOptionsSchema } from './tracks'

export const recordingSessionOptionsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  projectId: z.string().min(1).optional(),
  tracks: recordingTrackOptionsSchema,
}).strict()
export type RecordingSessionOptions = z.infer<typeof recordingSessionOptionsSchema>
