import { z } from 'zod';

const fraction = z.number().finite().min(0).max(1);
const point = z.object({ x: z.number().finite(), y: z.number().finite(), pressure: fraction.default(1),
  tiltX: z.number().min(-90).max(90).default(0), tiltY: z.number().min(-90).max(90).default(0) }).strict();
const color = z.string().regex(/^#[a-f\d]{6}$/i);
export const imageEditPaintIntentSchemaV3 = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stroke'), tool: z.enum(['brush', 'eraser']).default('brush'), points: z.array(point).min(1),
    sizeRatio: z.number().finite().positive(), hardness: fraction.default(.8), opacity: fraction.default(1), flow: fraction.default(1),
    spacing: z.number().finite().positive().default(.15), smoothing: fraction.default(0),
    pressureSize: z.boolean().default(true), pressureFlow: z.boolean().default(false), pressureCurve: z.enum(['linear', 'soft', 'firm']).default('linear'),
    tip: z.enum(['round', 'chisel']).default('round'), angle: z.number().finite().default(0), tilt: z.boolean().default(false),
    texture: fraction.default(0), scatter: fraction.default(0), seed: z.number().int().default(1), color: color.optional(), maskValue: fraction.default(1),
  }).strict(),
  z.object({ kind: z.literal('solid'), opacity: fraction.default(1), color: color.optional(), maskValue: fraction.default(1) }).strict(),
  z.object({ kind: z.enum(['linear', 'radial']), start: point, end: point, opacity: fraction.default(1),
    stops: z.array(z.object({ position: fraction, color: color.optional(), alpha: fraction.default(1), maskValue: fraction.default(1) }).strict()).min(2),
  }).strict(),
]);
export type ImageEditPaintIntentV3 = z.infer<typeof imageEditPaintIntentSchemaV3>;
