import type { ImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
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
  const cicp = metadata.cicp ? { ...metadata.cicp } : null
  const transfer = cicp?.transferCharacteristics === 16
    ? 'pq'
    : cicp?.transferCharacteristics === 18
      ? 'hlg'
      : 'srgb'
  const hdr = transfer === 'pq' || transfer === 'hlg'
  const colorSpace = metadata.colorSpace?.toLowerCase() ?? ''
  const workingSpace = hdr
    ? 'rec2020'
    : cicp?.colorPrimaries === 12 || colorSpace.includes('p3')
      ? 'display-p3'
      : 'srgb'
  const bitDepth = metadata.depth === 'float' || metadata.bitsPerSample > 16
    ? 'float32'
    : metadata.bitsPerSample > 8 || hdr
      ? 16
      : 8
  return {
    workingSpace,
    bitDepth,
    transferFunction: transfer,
    hdrMetadata: hdr ? { standard: transfer, ...(cicp ? { cicp } : {}) } : null,
    iccProfileResourceId: metadata.iccProfileResourceRef,
  }
}
