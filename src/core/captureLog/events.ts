import { z } from 'zod'
import { applicationRefSchema } from '../application-control/identifiers'
import { clockEventIssue, clockSegmentsSchema, dualClockShape, finiteSchema, idSchema, pointSchema, safeClockSchema } from './clock'
import { capturePageEnvelope, validateCapturePage } from './page'

export const cursorShapes = ['arrow', 'text', 'hand', 'crosshair', 'wait', 'progress', 'resize-horizontal', 'resize-vertical', 'resize-diagonal', 'move', 'forbidden', 'hidden', 'unknown'] as const
const base = { ...dualClockShape, eventId: idSchema, recordingUs: safeClockSchema }
const rect = z.object({ x: finiteSchema, y: finiteSchema, width: finiteSchema.positive(), height: finiteSchema.positive() }).strict()
export const capabilityCaptureSchema = z.object({
  callId: idSchema, capability: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  targets: z.array(z.object({ kind: applicationRefSchema.shape.kind, id: applicationRefSchema.shape.id }).strict()),
  phase: z.enum(['started', 'completed', 'failed', 'cancelled']),
}).strict()
export type CapabilityCapture = z.infer<typeof capabilityCaptureSchema>
export const captureEventSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('cursor'), point: pointSchema.nullable(), shape: z.enum(cursorShapes) }).strict(),
  z.object({ ...base, kind: z.literal('click'), point: pointSchema, button: z.enum(['left', 'middle', 'right', 'other']), phase: z.enum(['down', 'up']) }).strict(),
  z.object({ ...base, kind: z.literal('scroll'), point: pointSchema, axis: z.enum(['horizontal', 'vertical']), amount: finiteSchema }).strict(),
  z.object({ ...base, kind: z.literal('key'), category: z.enum(['typing', 'copy', 'paste', 'cut', 'undo', 'redo', 'select-all', 'shortcut', 'navigation', 'confirm', 'cancel']) }).strict(),
  z.object({ ...base, kind: z.literal('window'), windowId: idSchema.nullable(), bounds: rect.nullable(), available: z.boolean() }).strict(),
  z.object({ ...base, kind: z.literal('capability'), ...capabilityCaptureSchema.shape }).strict(),
  z.object({ ...base, kind: z.literal('mark'), note: z.string().max(4000).optional() }).strict(),
  z.object({ ...base, kind: z.literal('control'), action: z.enum(['start', 'pause', 'resume', 'stop']) }).strict(),
])
export type CaptureEvent = z.infer<typeof captureEventSchema>
export type CapturePayload = CaptureEvent extends infer E ? E extends CaptureEvent ? Omit<E, keyof typeof base> : never : never
export const captureLogPageSchema = z.object({
  ...capturePageEnvelope, kind: z.literal('events'), entries: z.array(captureEventSchema), clockSegments: clockSegmentsSchema,
}).strict().superRefine((page, ctx) => {
  validateCapturePage(page, ctx)
  for (const [index, event] of page.entries.entries()) {
    const issue = clockEventIssue(event, page.clockSegments)
    if (issue) ctx.addIssue({ code: 'custom', path: ['entries', index], message: issue })
  }
})
export type CaptureLogPage = z.infer<typeof captureLogPageSchema>
