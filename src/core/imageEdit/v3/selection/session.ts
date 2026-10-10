import { z } from 'zod';
import { imageEditSelectionMaskShapeSchemaV3, validateImageEditSelectionMaskV3 } from '../subjectSelection';

const ratio = z.number().finite().nonnegative();
const coordinate = z.number().finite();
const point = z.object({ x: coordinate, y: coordinate }).strict();
/** 坐标是未裁剪文档画面的比例；半径与羽化以画面短边为基准。会话态，不写入作品。 */
export const imageEditSelectionShapeSchemaV3 = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rectangle'), x: coordinate, y: coordinate, width: ratio, height: ratio }).strict(),
  z.object({ type: z.literal('ellipse'), x: coordinate, y: coordinate, width: ratio, height: ratio }).strict(),
  z.object({ type: z.literal('lasso'), points: z.array(point).min(3) }).strict(),
  imageEditSelectionMaskShapeSchemaV3,
  z.object({ type: z.literal('brush'), points: z.array(point).min(1), radius: ratio.positive() }).strict(),
]).refine(shape => shape.type !== 'mask' || validateImageEditSelectionMaskV3(shape), '主体遮罩数据或坐标变换无效');
export const imageEditSelectionSessionSchemaV3 = z.object({
  operations: z.array(z.object({
    shape: imageEditSelectionShapeSchemaV3,
    combine: z.enum(['replace', 'add', 'subtract', 'intersect']),
    invertBefore: z.boolean().default(false),
  }).strict()),
  feather: ratio,
  inverted: z.boolean(),
}).strict();
export type ImageEditSelectionSessionV3 = z.infer<typeof imageEditSelectionSessionSchemaV3>;
export type ImageEditSelectionIntentShapeV3 = z.infer<typeof imageEditSelectionShapeSchemaV3>;

export function appendImageEditSelectionV3(
  current: ImageEditSelectionSessionV3 | null,
  shape: ImageEditSelectionIntentShapeV3,
  combine: 'replace' | 'add' | 'subtract' | 'intersect',
): ImageEditSelectionSessionV3 {
  return imageEditSelectionSessionSchemaV3.parse({
    operations: [...(combine === 'replace' ? [] : current?.operations ?? []), { shape, combine, invertBefore: combine !== 'replace' && Boolean(current?.inverted) }],
    feather: current?.feather ?? 0,
    inverted: false,
  });
}

export interface ImageEditSelectionRegionV3 { x: number; y: number; width: number; height: number }
