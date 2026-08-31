import {
  createDefaultImageEditColorModeV3,
  type ImageEditColorModeV3,
} from '@/core/imageEdit/v3/colorTypes'
import type {
  ImageEditorV3SourceLocator,
  ImageEditorV3SourceMetadata,
} from '@/platform/contracts/imageEditorV3'
import { isLikelyLocalImagePath } from '@/services/imageSource'

export function resolveImageMarkV3SourceLocator(sourceImageUrl: string): ImageEditorV3SourceLocator {
  if (isLikelyLocalImagePath(sourceImageUrl)) {
    return { kind: 'local-path', filePath: sourceImageUrl }
  }
  if (sourceImageUrl.startsWith('data:')) {
    return { kind: 'data-url', dataUrl: sourceImageUrl }
  }
  if (/^https?:\/\//i.test(sourceImageUrl)) {
    return { kind: 'http-url', url: sourceImageUrl }
  }
  throw new Error('当前图片来源还不能导入新版编辑器')
}

export function createImageMarkV3ColorMode(
  metadata: ImageEditorV3SourceMetadata,
): ImageEditColorModeV3 {
  const format = metadata.format?.toLowerCase()
  if (!format || !['jpeg', 'png', 'webp'].includes(format)) {
    throw new Error(`当前新版编辑器仅支持 JPEG、PNG 和 WebP：${format ?? '未知格式'}`)
  }
  if (metadata.hdr || metadata.bitsPerSample > 8 || metadata.depth === 'float') {
    throw new Error('当前新版编辑器仅支持 8-bit SDR 图片')
  }
  // 候选版统一在导入边界转换到 sRGB；ICC/P3/HDR 文档模式留待后续版本重新开放。
  return createDefaultImageEditColorModeV3()
}
