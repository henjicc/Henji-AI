const IMAGE_EDITOR_COARSE_PREVIEW_MAX_EDGE = 1_024

/**
 * 完整文档兜底帧需要足够小以便快速生成，也必须保留可辨认的图像结构。
 * 选择后最长边落在 (512, 1024]；小图直接使用 mip 0。
 */
export function resolveImageEditorCoarsePreviewMipV3(
  size: { width: number; height: number },
): number {
  if (!Number.isSafeInteger(size.width) || size.width <= 0
    || !Number.isSafeInteger(size.height) || size.height <= 0) {
    throw new Error('图片编辑粗略预览尺寸必须是正整数')
  }
  const longestEdge = Math.max(size.width, size.height)
  if (longestEdge <= IMAGE_EDITOR_COARSE_PREVIEW_MAX_EDGE) return 0
  return Math.min(30, Math.ceil(Math.log2(
    longestEdge / IMAGE_EDITOR_COARSE_PREVIEW_MAX_EDGE,
  )))
}

/**
 * 交互首帧只覆盖当前可见区，并允许每个 mip 像素对应至多两个设备像素。
 * 相比目标 mip 线性减半、工作量约为四分之一，同时仍保留可辨认的图片结构。
 */
export function resolveImageEditorInteractiveDraftMipV3(
  viewport: { zoom: number; devicePixelRatio: number },
): number {
  const physicalPixelsPerDocumentPixel = viewport.zoom * viewport.devicePixelRatio
  if (!Number.isFinite(physicalPixelsPerDocumentPixel) || physicalPixelsPerDocumentPixel <= 0) {
    throw new Error('图片编辑交互草稿显示倍率必须是正数')
  }
  const idealMip = physicalPixelsPerDocumentPixel >= 1
    ? 0
    : Math.max(0, Math.floor(Math.log2(1 / physicalPixelsPerDocumentPixel)))
  return Math.min(30, idealMip + 1)
}
