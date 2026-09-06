import { createTileRegion, type ImageEditRect, type ImageEditSize } from '../tileGeometry'

export function resolveImageEditRasterStorageSizeV3(source: ImageEditSize | null, canvas: ImageEditSize): ImageEditSize {
  return { width: Math.max(source?.width ?? 0, canvas.width), height: Math.max(source?.height ?? 0, canvas.height) }
}

/** 画笔存储坐标属于图层 mip0 空间，边缘尺寸由源图与画布共同确定的可写域决定。 */
export function imageEditRasterOverrideRectV3(storage: ImageEditSize, key: string): ImageEditRect {
  const match = /^0\/(0|[1-9]\d*)\/(0|[1-9]\d*)$/.exec(key)
  if (!match) throw new Error(`画笔瓦片键无效：${key}`)
  return createTileRegion(storage, { mip: 0, x: Number(match[1]), y: Number(match[2]) }, 0).outputRect
}

/** 派生可采样范围，不改变资源金字塔，也不把未画过的整个画布塞进小原图。 */
export function resolveImageEditRasterSourceExtentV3(
  source: ImageEditSize | null,
  canvas: ImageEditSize,
  sparseKeys: readonly string[],
): ImageEditSize {
  if (sparseKeys.length === 0) return source ?? canvas
  const size = { width: source?.width ?? 1, height: source?.height ?? 1 }
  for (const key of sparseKeys) {
    const rect = imageEditRasterOverrideRectV3(resolveImageEditRasterStorageSizeV3(source, canvas), key)
    size.width = Math.max(size.width, rect.x + rect.width)
    size.height = Math.max(size.height, rect.y + rect.height)
  }
  return size
}
