import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes';
import { decodeSrgbExtended, linearWorkingSpaceMatrixV3 } from '@/core/imageEdit/v3/execution/tileColor';

/** UI colours are sRGB; pixels and gradients are premultiplied in the document's linear primaries. */
export function paintColorInDocument(document: ImageEditDocumentV3, hex: string, alpha = 1): readonly [number, number, number, number] {
  if (!/^#[a-f\d]{6}$/i.test(hex) || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error('绘画颜色无效');
  const rgb = [1, 3, 5].map(offset => decodeSrgbExtended(Number.parseInt(hex.slice(offset, offset + 2), 16) / 255));
  const matrix = linearWorkingSpaceMatrixV3('srgb', document.color.workingSpace);
  return [
    (matrix[0] * rgb[0] + matrix[1] * rgb[1] + matrix[2] * rgb[2]) * alpha,
    (matrix[3] * rgb[0] + matrix[4] * rgb[1] + matrix[5] * rgb[2]) * alpha,
    (matrix[6] * rgb[0] + matrix[7] * rgb[1] + matrix[8] * rgb[2]) * alpha, alpha,
  ];
}
