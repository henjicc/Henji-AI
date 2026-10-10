import { z } from 'zod';
import { decodeTransferFunctionV3, encodeTransferFunctionV3, type RgbTransferFunction } from './rgb';

/** mode 是操作意图，读回默认 convert；不是第二份持久文档状态。 */
export const colorSettingsSchema = z.object({
  mode: z.enum(['convert', 'assign']).default('convert'),
  workingSpace: z.enum(['srgb', 'display-p3', 'rec2020']),
  bitDepth: z.union([z.literal(8), z.literal(16), z.literal('float16'), z.literal('float32')]),
  transferFunction: z.enum(['srgb', 'linear', 'pq', 'hlg']),
}).strict().superRefine((value, context) => {
  if ((value.transferFunction === 'pq' || value.transferFunction === 'hlg')
    && (value.workingSpace !== 'rec2020' || value.bitDepth === 8)) {
    context.addIssue({ code: 'custom', message: 'HDR 需要 Rec.2020 和至少 16 位精度' });
  }
});
export type ColorSettings = z.infer<typeof colorSettingsSchema>;

/** 指定 profile 保留未预乘的编码 RGB 数值，再按目标传递函数解释；绝不冒充颜色转换。 */
export function assignRgbProfilePixels(data: Float32Array, source: RgbTransferFunction,
  target: RgbTransferFunction, sourceWhiteNits = 203, targetWhiteNits = 203): Float32Array {
  if (data.length % 4) throw new Error('颜色像素需要 RGBA 四通道');
  const output = new Float32Array(data.length);
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error('颜色像素透明度无效');
    output[index + 3] = alpha;
    if (alpha === 0) continue;
    for (let channel = 0; channel < 3; channel++) {
      const encoded = encodeTransferFunctionV3(data[index + channel] / alpha, source, sourceWhiteNits);
      output[index + channel] = decodeTransferFunctionV3(encoded, target, targetWhiteNits) * alpha;
    }
  }
  return output;
}
