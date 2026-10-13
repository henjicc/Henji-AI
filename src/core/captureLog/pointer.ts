import { z } from 'zod'
import { applicationRefSchema } from '../application-control/identifiers'
import { dualClockShape, idSchema, pointSchema, safeClockSchema } from './clock'
const eventBase = { ...dualClockShape, eventId: idSchema }
export const pointerEventSchema = z.object({ ...eventBase, kind: z.literal('pointer'), surfaceRef: applicationRefSchema, geometrySnapshotRef: idSchema, viewPoint: pointSchema, documentPoint: pointSchema.nullable(), compositionPoint: pointSchema.nullable(), hoverRefs: z.array(applicationRefSchema), pointedRefs: z.array(applicationRefSchema), selectedRefs: z.array(applicationRefSchema), intent: z.enum(['navigate', 'demonstrate']), phase: z.enum(['down', 'move', 'up', 'cancel']), uncertaintyUs: safeClockSchema }).strict()
