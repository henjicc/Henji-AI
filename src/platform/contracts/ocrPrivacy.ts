import { z } from 'zod'
import type { RecordingPrivacy } from '../../core/screenRecording/privacy'
const time = z.number().int().nonnegative().safe().max(24 * 3600 * 1e6)
export const ocrPrivacyRequestSchema = z.object({ requestId: z.string().uuid(), source: z.string().min(1), mediaId: z.string().min(1), startUs: time, endUs: time, originUs: z.number().int().nonnegative().safe() }).strict().refine(v => v.endUs > v.startUs, '识别结束时间必须晚于开始')
export type OcrPrivacyRequest = z.infer<typeof ocrPrivacyRequestSchema>
export interface OcrPrivacyProgress { requestId: string; progress: number }
export interface OcrPrivacyResponse { privacy: RecordingPrivacy; frames: number; inferredFrames: number }
