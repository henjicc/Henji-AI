import { z } from 'zod'
import { capturePageEnvelope as envelope, validateCapturePage } from '../captureLog/page'
import { clockSegmentSchema, sampleSchema } from './contracts'
import { audioEventSchema, annotationEventSchema, commandEventSchema, controlEventSchema, deltaEventSchema, geometryEventSchema, pointerEventSchema, timelineEventSchema, transcriptEventSchema } from './schema'

export const creativeIntentPageSchema = z.discriminatedUnion('kind', [
  z.object({ ...envelope, kind: z.literal('samples'), entries: z.array(sampleSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('timeline'), entries: z.array(timelineEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('control'), entries: z.array(controlEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('pointer'), entries: z.array(pointerEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('command'), entries: z.array(commandEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('delta'), entries: z.array(deltaEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('transcript'), entries: z.array(transcriptEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('annotation'), entries: z.array(annotationEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('geometry'), entries: z.array(geometryEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('audio'), entries: z.array(audioEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('clock'), entries: z.array(clockSegmentSchema) }).strict(),
]).superRefine(validateCapturePage)
export type CreativeIntentPage = z.infer<typeof creativeIntentPageSchema>
