import type { SourceImageMetadata } from '../contracts'

const RELEASE_SOURCE_FORMATS = new Set(['jpeg', 'png', 'webp', 'tiff', 'avif', 'heif'])

export class ImageEditorV3UnsupportedSourceError extends Error {
  constructor(readonly reason: 'format' | 'hdr' | 'animated', detail: string) {
    super(detail)
    this.name = 'ImageEditorV3UnsupportedSourceError'
  }
}

/** 由实际解码样本决定能力边界，不把仅识别到 CICP 当作正确 HDR 解码。 */
export function assertImageEditorV3SourceColor(metadata: SourceImageMetadata): void {
  if (metadata.hdr) throw new ImageEditorV3UnsupportedSourceError('hdr',
    'HDR 源图片解码尚未通过颜色保真验证；可继续编辑工作文档中的 HDR 浮点内容');
  if (metadata.cicp && metadata.cicp.colorPrimaries !== 1 && !metadata.hasIccProfile) {
    throw new ImageEditorV3UnsupportedSourceError('format', '此图片的宽色域缺少可验证的 ICC 配置，暂不能正确解码');
  }
}

/** 静态高精度 SDR 沿原 ICC 解码保留精度；未验证的 HDR/多页输入明确拒绝。 */
export function assertImageEditorV3ReleaseSource(metadata: SourceImageMetadata): void {
  const format = metadata.format?.toLowerCase() ?? '';
  if (!RELEASE_SOURCE_FORMATS.has(format)) throw new ImageEditorV3UnsupportedSourceError('format',
    `无法解码此图片格式：${format || '未知格式'}`);
  assertImageEditorV3SourceColor(metadata);
  if ((metadata.pages ?? 1) > 1) throw new ImageEditorV3UnsupportedSourceError('animated', '请先选取多页图片中的一页');
}
