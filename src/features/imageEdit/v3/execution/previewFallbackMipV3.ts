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
