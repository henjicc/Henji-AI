import { z } from 'zod'

export const videoEditMulticamSchema = z.object({
  cameras: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), clipId: z.string().min(1).max(100), speaker: z.string().trim().max(200).optional() }).strict()).min(2),
  audioCameraId: z.string().min(1).max(100).optional(),
}).strict()
export type VideoEditMulticam = z.infer<typeof videoEditMulticamSchema>
