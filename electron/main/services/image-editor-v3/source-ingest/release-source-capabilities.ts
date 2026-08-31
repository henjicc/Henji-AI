import type { SourceImageMetadata } from '../contracts'

const RELEASE_SOURCE_FORMATS = new Set(['jpeg', 'png', 'webp'])

export class ImageEditorV3UnsupportedSourceError extends Error {
  constructor(readonly reason: 'format' | 'precision' | 'hdr' | 'animated', detail: string) {
    super(detail)
    this.name = 'ImageEditorV3UnsupportedSourceError'
  }
}

/** macOS 候选版只接纳静态 8-bit SDR JPEG/PNG/WebP，其他源交给旧版入口。 */
export function assertImageEditorV3ReleaseSource(metadata: SourceImageMetadata): void {
  const format = metadata.format?.toLowerCase() ?? ''
  if (!RELEASE_SOURCE_FORMATS.has(format)) {
    throw new ImageEditorV3UnsupportedSourceError(
      'format',
      `当前新版编辑器仅支持 JPEG、PNG 和 WebP，检测到：${format || '未知格式'}`,
    )
  }
  if (metadata.hdr) {
    throw new ImageEditorV3UnsupportedSourceError(
      'hdr',
      '当前新版编辑器暂不支持 HDR 图片，请使用旧版入口打开',
    )
  }
  if (metadata.bitsPerSample > 8 || metadata.depth === 'ushort' || metadata.depth === 'float') {
    throw new ImageEditorV3UnsupportedSourceError(
      'precision',
      '当前新版编辑器暂不支持 16 位或浮点图片，请使用旧版入口打开',
    )
  }
  if ((metadata.pages ?? 1) > 1) {
    throw new ImageEditorV3UnsupportedSourceError(
      'animated',
      '当前新版编辑器暂不支持多帧图片，请使用旧版入口打开',
    )
  }
}
