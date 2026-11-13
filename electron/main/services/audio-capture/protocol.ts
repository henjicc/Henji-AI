import { z } from 'zod'
import { NativeFrameReader, NativeProcessError, nativeErrorSchema } from '../native-process/protocol'

const nativeAudioMessageSchema = z.object({
  id: z.string().optional(), ok: z.boolean().optional(), result: z.unknown().optional(), error: nativeErrorSchema.optional(),
  event: z.enum(['level', 'samples', 'interrupted', 'health', 'segment', 'device', 'systemHealth']).optional(), binaryBytes: z.number().int().min(0).max(8192),
}).passthrough()
export type NativeAudioMessage = z.infer<typeof nativeAudioMessageSchema>
export class AudioCaptureError extends NativeProcessError {}

export class AudioCaptureFrameReader extends NativeFrameReader<NativeAudioMessage> {
  constructor() { super(nativeAudioMessageSchema, '录音服务') }
}
