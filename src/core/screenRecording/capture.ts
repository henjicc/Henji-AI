import { z } from 'zod'
import { recordingSessionOptionsSchema } from './sessionOptions'
import { recordingTracksSchema } from './tracks'

export const captureOptionsSchema = z.object({
  sourceId: z.string().regex(/^(screen|window):\d+:\d+$/),
  backend: z.enum(['auto', 'gfxcapture', 'chromium']).default('auto'),
  width: z.number().int().min(2).max(3840).multipleOf(2),
  height: z.number().int().min(2).max(2160).multipleOf(2),
  fps: z.union([z.literal(30), z.literal(60)]),
  bitrate: z.number().int().min(1_000_000).max(100_000_000),
  /** Normalized coordinates in the selected display; independent of desktop DIP and monitor order. */
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.region && (!value.sourceId.startsWith('screen:') || value.region.x + value.region.width > 1 || value.region.y + value.region.height > 1)) ctx.addIssue({ code: 'custom', path: ['region'], message: '区域必须位于所选屏幕内' })
})
export type ScreenCaptureOptions = z.infer<typeof captureOptionsSchema>
export type CaptureBackendKind = 'gfxcapture' | 'chromium'
export type CaptureOperation = 'start' | 'pause' | 'resume' | 'stop' | 'cancel'
export interface ScreenCaptureBackend {
  prepare(): Promise<void>
  start(signal: AbortSignal): Promise<void>
  pause(signal: AbortSignal): Promise<void>
  resume(signal: AbortSignal): Promise<void>
  stop(signal: AbortSignal): Promise<void>
  cancel(): Promise<void>
}
export interface CaptureCommand { sessionId: string; requestId: string; operation: CaptureOperation }
export const captureSpanSchema = z.object({
  index: z.number().int().nonnegative(), file: z.string().regex(/^screen-\d{6}\.mp4$/),
  monoUs: z.number().int().nonnegative(), durationUs: z.number().int().nonnegative(),
  finalized: z.boolean(),
}).strict()
export const captureManifestSchema = z.object({
  version: z.literal(1), sessionId: z.string().uuid(), options: captureOptionsSchema,
  backend: z.enum(['gfxcapture', 'chromium']), cursorEmbedded: z.boolean(),
  status: z.enum(['prepared', 'recording', 'paused', 'stopped', 'failed']),
  spans: z.array(captureSpanSchema),
}).strict()
export type CaptureManifest = z.infer<typeof captureManifestSchema>
export type CaptureSpan = z.infer<typeof captureSpanSchema>
/** Pass this exact main-process monotonic origin to event and audio/camera capture. */
export interface CapturePrepared { sessionId: string; originUs: number; backend: CaptureBackendKind; cursorEmbedded: boolean; options: ScreenCaptureOptions; directory?: string }
const sessionId = z.string().uuid()
export const captureRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('prepare'), sessionId, options: captureOptionsSchema, session: recordingSessionOptionsSchema.optional() }).strict(),
  z.object({ operation: z.literal('tracks'), sessionId, tracks: recordingTracksSchema }).strict(),
  z.object({ operation: z.literal('recover-session'), sessionId }).strict(),
  z.object({ operation: z.literal('events'), sessionId, offset: z.number().int().nonnegative(), limit: z.number().int().min(1).max(256), markersOnly: z.boolean().default(false) }).strict(),
  z.object({ operation: z.literal('read'), sessionId }).strict(),
  z.object({ operation: z.literal('clock'), sessionId }).strict(),
  z.object({ operation: z.literal('anchor'), sessionId, index: z.number().int().nonnegative(), monoUs: z.number().int().nonnegative() }).strict(),
  z.object({ operation: z.literal('close'), sessionId }).strict(),
  z.object({ operation: z.literal('recover'), sessionId }).strict(),
  z.object({ operation: z.literal('open-span'), sessionId }).strict(),
  z.object({ operation: z.literal('write'), sessionId, index: z.number().int().nonnegative(), position: z.number().int().nonnegative(), data: z.instanceof(Uint8Array).refine(value => value.byteLength <= 2 * 1024 * 1024) }).strict(),
  z.object({ operation: z.literal('seal-span'), sessionId, index: z.number().int().nonnegative(), durationUs: z.number().int().nonnegative() }).strict(),
  z.object({ operation: z.literal('ack'), sessionId, requestId: z.string().uuid(), error: z.string().max(1000).optional() }).strict(),
  z.object({ operation: z.literal('failed'), sessionId, error: z.string().max(1000) }).strict(),
])
export type CaptureRequest = z.infer<typeof captureRequestSchema>

/** Desktop DIP rectangle → normalized selected-display coordinates (including negative desktop origins). */
export function captureRegionFromDip(region: { x: number; y: number; width: number; height: number }, display: { x: number; y: number; width: number; height: number }): NonNullable<ScreenCaptureOptions['region']> {
  return { x: (region.x - display.x) / display.width, y: (region.y - display.y) / display.height, width: region.width / display.width, height: region.height / display.height }
}
export function captureCrop(region: ScreenCaptureOptions['region'], width: number, height: number): { x: number; y: number; width: number; height: number } {
  const r = region ?? { x: 0, y: 0, width: 1, height: 1 }
  const x = Math.floor(r.x * width), y = Math.floor(r.y * height)
  return { x, y, width: Math.max(1, Math.min(width - x, Math.round(r.width * width))), height: Math.max(1, Math.min(height - y, Math.round(r.height * height))) }
}
