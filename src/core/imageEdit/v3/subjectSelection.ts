import { z } from 'zod'

const ratio = z.number().finite().min(0).max(1)
export const imageEditSubjectRegionSchemaV3 = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('subject') }).strict(),
  z.object({ kind: z.literal('portrait'), quality: z.enum(['fine', 'fast']).default('fine') }).strict(),
  z.object({ kind: z.literal('point'), points: z.array(z.object({ x: ratio, y: ratio, foreground: z.boolean().default(true) }).strict()).min(1) }).strict(),
  z.object({ kind: z.literal('box'), x: ratio, y: ratio, width: ratio.positive(), height: ratio.positive() }).strict(),
])
export type ImageEditSubjectRegionV3 = z.infer<typeof imageEditSubjectRegionSchemaV3>
/** 会话遮罩 RLE：(起始像素、连续长度、覆盖率字节)。matrix 将遮罩比例坐标映射到文档比例坐标。 */
export const imageEditSelectionMaskShapeSchemaV3 = z.object({
  type: z.literal('mask'), width: z.number().int().positive().safe(), height: z.number().int().positive().safe(),
  runs: z.array(z.tuple([z.number().int().nonnegative().safe(), z.number().int().positive().safe(), z.number().int().min(1).max(255)])),
  matrix: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
}).strict()
export type ImageEditSelectionMaskShapeV3 = z.infer<typeof imageEditSelectionMaskShapeSchemaV3>

export function validateImageEditSelectionMaskV3(mask: ImageEditSelectionMaskShapeV3): boolean {
  const pixels = mask.width * mask.height
  const [a, b, c, d] = mask.matrix
  const determinant = a * d - b * c
  if (!Number.isSafeInteger(pixels) || pixels > 0xffffffff || !Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return false
  let end = 0
  for (const [start, length] of mask.runs) { if (start < end || start + length > pixels) return false; end = start + length }
  return true
}

export function encodeImageEditSelectionMaskV3(bytes: Uint8Array, width: number, height: number): ImageEditSelectionMaskShapeV3 {
  if (bytes.length !== width * height) throw new Error('主体遮罩尺寸不匹配')
  const runs: ImageEditSelectionMaskShapeV3['runs'] = []
  for (let i = 0; i < bytes.length;) {
    const start = i, value = bytes[i++]
    while (i < bytes.length && bytes[i] === value) i++
    if (value) runs.push([start, i - start, value])
  }
  return { type: 'mask', width, height, runs, matrix: [1, 0, 0, 1, 0, 0] }
}
