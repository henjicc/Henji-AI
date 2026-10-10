import {
  createDefaultImageEditColorModeV3,
  type ImageEditColorModeV3,
} from '@/core/imageEdit/v3/colorTypes'
import type {
  ImageEditorV3SourceLocator,
  ImageEditorV3SourceMetadata,
} from '@/platform/contracts/imageEditorV3'
import { decodeMediaFileUrl } from '@/utils/mediaFileUrl'
import { persistImageSource } from '@/commands/image'
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
  if (!metadata.format) throw new Error('无法识别图片编码');
  if (metadata.pages && metadata.pages > 1) throw new Error('请先选取多页图片中的一页');
  if (metadata.hdr) throw new Error('HDR 源图片解码尚未通过颜色保真验证；可继续编辑工作文档中的 HDR 浮点内容');
  // Source provider performs ICC decoding to canonical sRGB/scRGB. An input ICC must
  // never be reattached to these converted pixels as if it were their working profile.
  const floatingWorkingPixels = metadata.colorSpace === 'display-p3' || metadata.depth === 'float' || metadata.bitsPerSample > 16;
  return { ...createDefaultImageEditColorModeV3(), bitDepth: floatingWorkingPixels ? 'float32' : metadata.bitsPerSample > 8 ? 16 : 8,
    transferFunction: floatingWorkingPixels ? 'linear' : 'srgb' };
}

/** 不透明媒体能力先经唯一持久化边界转成可读路径；原始路径、HTTP 和 Data URL 直接受管导入。 */
export async function prepareImageEditSourceLocatorV3(source: string): Promise<ImageEditorV3SourceLocator> {
  const normalized = decodeMediaFileUrl(source)
  if (/^(?:henji-media:|blob:|asset:)/i.test(normalized)) return { kind: 'local-path', filePath: await persistImageSource(normalized) }
  return resolveImageMarkV3SourceLocator(normalized)
}
