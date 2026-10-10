import { z } from 'zod';
import type { ImageEditDocumentV3 } from '../documentTypes';

export const imageEditSmartOriginSchemaV3 = z.object({
  kind: z.enum(['image_edit.document', 'canvas.node', 'generation.result', 'asset']),
  id: z.string().min(1), revision: z.number().int().nonnegative().optional(),
}).strict();

export function imageEditSmartContentSchemaV3(documentSchema: z.ZodType<ImageEditDocumentV3>): z.ZodType {
  return z.object({
    id: z.string().min(1), origin: imageEditSmartOriginSchemaV3.nullable(),
    document: z.lazy(() => documentSchema),
    width: z.number().int().positive(), height: z.number().int().positive(),
  }).strict();
}
