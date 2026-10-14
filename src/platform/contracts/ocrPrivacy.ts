import { z } from 'zod'
import type { RecordingPrivacy } from '../../core/screenRecording/privacy'
const time = z.number().int().nonnegative().safe().max(24 * 3600 * 1e6)
export const ocrQualitySchema = z.enum(['fast', 'precise']).describe('fast 为快速识别；precise 对小字和复杂符号更准确但处理更慢。').optional()
export const ocrCursorSampleSchema = z.object({ monoUs: z.number().int().nonnegative().safe(), point: z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()]).nullable() }).strict()
export const ocrPrivacyRequestSchema = z.object({ requestId: z.string().uuid(), source: z.string().min(1), mediaId: z.string().min(1), startUs: time, endUs: time, originUs: z.number().int().nonnegative().safe(), quality: ocrQualitySchema, cursor: z.array(ocrCursorSampleSchema).max(864001).optional() }).strict().refine(v => v.endUs > v.startUs, '识别结束时间必须晚于开始').refine(v => !v.cursor || v.cursor.every((c, i) => i === 0 || c.monoUs >= v.cursor![i - 1].monoUs), '光标样本必须按时间排序')
export type OcrPrivacyRequest = z.infer<typeof ocrPrivacyRequestSchema>
export interface OcrPrivacyProgress { requestId: string; progress: number }
export interface OcrPrivacyResponse { privacy: RecordingPrivacy; frames: number; inferredFrames: number }
