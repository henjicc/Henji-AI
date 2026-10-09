import { z } from 'zod';
const ratio = z.number().finite().min(0).max(1);
const point = z.object({ x: ratio, y: ratio }).strict();
export const imageEditAdvancedSelectionIntentSchemaV3 = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('wand'), point, tolerance: ratio, contiguous: z.boolean() }).strict(),
  z.object({ kind: z.literal('color-range'), points: z.array(point).min(1), tolerance: ratio }).strict(),
  z.object({ kind: z.literal('focus'), range: ratio, noise: ratio }).strict(),
  z.object({ kind: z.literal('modify'), mode: z.enum(['expand', 'contract', 'smooth', 'feather', 'border']), radiusRatio: ratio.positive() }).strict(),
]);
export type ImageEditAdvancedSelectionIntentV3 = z.infer<typeof imageEditAdvancedSelectionIntentSchemaV3>;
