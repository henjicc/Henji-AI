import {
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
} from '../effects/contracts'
import type { ImageEditTransformV3 } from '../layerTypes'
import type { ImageEditRect, ImageEditSize } from '../tileGeometry'

const MIN_AFFINE_DETERMINANT_V3 = 1e-8

export class ImageEditSingularTransformErrorV3 extends Error {
  constructor() {
    super('图层变换矩阵不可逆')
    this.name = 'ImageEditSingularTransformErrorV3'
  }
}

export function imageEditTransformDeterminantV3(
  transform: readonly number[],
): number {
  return transform[0] * transform[3] - transform[1] * transform[2]
}

export function isImageEditTransformV3(value: unknown): value is ImageEditTransformV3 {
  return Array.isArray(value)
    && value.length === 6
    && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
}

export function isImageEditTransformInvertibleV3(
  transform: unknown,
): transform is ImageEditTransformV3 {
  if (!isImageEditTransformV3(transform)) return false
  const determinant = imageEditTransformDeterminantV3(transform)
  return Number.isFinite(determinant) && Math.abs(determinant) >= MIN_AFFINE_DETERMINANT_V3
}

export function assertImageEditTransformInvertibleV3(
  transform: readonly number[],
): asserts transform is ImageEditTransformV3 {
  if (!isImageEditTransformInvertibleV3(transform)) {
    throw new ImageEditSingularTransformErrorV3()
  }
}

export function invertImageEditTransformV3(
  transform: readonly number[],
): ImageEditTransformV3 {
  assertImageEditTransformInvertibleV3(transform)
  const [a, b, c, d, e, f] = transform
  const determinant = a * d - b * c
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ]
}

export function mapImageEditTransformPointV3(
  transform: readonly number[],
  x: number,
  y: number,
): readonly [number, number] {
  return [
    transform[0] * x + transform[2] * y + transform[4],
    transform[1] * x + transform[3] * y + transform[5],
  ]
}

/** 返回 `outer(inner(point))`。 */
export function multiplyImageEditTransformsV3(
  outer: readonly number[],
  inner: readonly number[],
): ImageEditTransformV3 {
  assertImageEditTransformInvertibleV3(outer)
  assertImageEditTransformInvertibleV3(inner)
  const [a1, b1, c1, d1, e1, f1] = outer
  const [a2, b2, c2, d2, e2, f2] = inner
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

/**
 * 把文档坐标中的矩阵共轭到另一个像素空间。预览可以非等比缩放，
 * mip 则传入相同的 x/y 比例。
 */
export function scaleImageEditTransformV3(
  transform: readonly number[],
  scaleX: number,
  scaleY: number,
): ImageEditTransformV3 {
  assertImageEditTransformInvertibleV3(transform)
  if (!Number.isFinite(scaleX) || scaleX <= 0 || !Number.isFinite(scaleY) || scaleY <= 0) {
    throw new Error('图层变换坐标比例必须是正数')
  }
  const [a, b, c, d, e, f] = transform
  return [
    a,
    b * scaleY / scaleX,
    c * scaleX / scaleY,
    d,
    e * scaleX,
    f * scaleY,
  ]
}

function clipRectToSize(rect: ImageEditRect, size: ImageEditSize): ImageEditRect {
  const left = Math.max(0, Math.min(size.width, Math.floor(rect.x)))
  const top = Math.max(0, Math.min(size.height, Math.floor(rect.y)))
  const right = Math.max(left, Math.min(size.width, Math.ceil(rect.x + rect.width)))
  const bottom = Math.max(top, Math.min(size.height, Math.ceil(rect.y + rect.height)))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function expandImageEditRectV3(
  rect: ImageEditRect,
  amount: number,
  size: ImageEditSize,
): ImageEditRect {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('图片区域扩展量无效')
  return clipRectToSize({
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  }, size)
}

/** 求一个输出区域经仿射逆变换后需要读取的最小整数源区域。 */
export function resolveImageEditInverseSourceRectV3(
  outputRect: ImageEditRect,
  transform: readonly number[],
  sourceSize: ImageEditSize,
): ImageEditRect {
  const inverse = invertImageEditTransformV3(transform)
  const left = outputRect.x + 0.5
  const top = outputRect.y + 0.5
  const right = outputRect.x + outputRect.width - 0.5
  const bottom = outputRect.y + outputRect.height - 0.5
  const corners = [
    mapImageEditTransformPointV3(inverse, left, top),
    mapImageEditTransformPointV3(inverse, right, top),
    mapImageEditTransformPointV3(inverse, left, bottom),
    mapImageEditTransformPointV3(inverse, right, bottom),
  ]
  // resampleAffine 会先减去 0.5 把全局像素中心换成数组坐标。
  const xs = corners.map(([x]) => x - 0.5)
  const ys = corners.map(([, y]) => y - 0.5)
  const sourceLeft = Math.floor(Math.min(...xs))
  const sourceTop = Math.floor(Math.min(...ys))
  const sourceRight = Math.ceil(Math.max(...xs)) + 1
  const sourceBottom = Math.ceil(Math.max(...ys)) + 1
  return clipRectToSize({
    x: sourceLeft,
    y: sourceTop,
    width: sourceRight - sourceLeft,
    height: sourceBottom - sourceTop,
  }, sourceSize)
}

function resampleAffine(
  source: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  sourceRect: ImageEditRect,
  outputRect: ImageEditRect,
  transform: readonly number[],
  channels: 1 | 4,
): Float32Array {
  const inverse = invertImageEditTransformV3(transform)
  const [inverseA, inverseB, inverseC, inverseD, inverseE, inverseF] = inverse
  const output = new Float32Array(outputRect.width * outputRect.height * channels)
  const firstGlobalX = outputRect.x + 0.5
  for (let y = 0; y < outputRect.height; y += 1) {
    const globalY = outputRect.y + y + 0.5
    let localX = inverseA * firstGlobalX + inverseC * globalY + inverseE
      - sourceRect.x - 0.5
    let localY = inverseB * firstGlobalX + inverseD * globalY + inverseF
      - sourceRect.y - 0.5
    for (let x = 0; x < outputRect.width; x += 1) {
      const x0 = Math.floor(localX)
      const y0 = Math.floor(localY)
      const x1 = x0 + 1
      const y1 = y0 + 1
      const tx = localX - x0
      const ty = localY - y0
      const leftWeight = 1 - tx
      const topWeight = 1 - ty
      const weight00 = leftWeight * topWeight
      const weight10 = tx * topWeight
      const weight01 = leftWeight * ty
      const weight11 = tx * ty
      const offset00 = x0 >= 0 && y0 >= 0 && x0 < sourceWidth && y0 < sourceHeight
        ? (y0 * sourceWidth + x0) * channels
        : -1
      const offset10 = x1 >= 0 && y0 >= 0 && x1 < sourceWidth && y0 < sourceHeight
        ? (y0 * sourceWidth + x1) * channels
        : -1
      const offset01 = x0 >= 0 && y1 >= 0 && x0 < sourceWidth && y1 < sourceHeight
        ? (y1 * sourceWidth + x0) * channels
        : -1
      const offset11 = x1 >= 0 && y1 >= 0 && x1 < sourceWidth && y1 < sourceHeight
        ? (y1 * sourceWidth + x1) * channels
        : -1
      const outputOffset = (y * outputRect.width + x) * channels
      for (let channel = 0; channel < channels; channel += 1) {
        output[outputOffset + channel] = (
          (offset00 < 0 ? 0 : source[offset00 + channel]) * weight00
          + (offset10 < 0 ? 0 : source[offset10 + channel]) * weight10
          + (offset01 < 0 ? 0 : source[offset01 + channel]) * weight01
          + (offset11 < 0 ? 0 : source[offset11 + channel]) * weight11
        )
      }
      localX += inverseA
      localY += inverseB
    }
  }
  return output
}

export function resampleImageEditRgbaAffineV3(
  tile: Float32PremultipliedRgbaTile,
  sourceRect: ImageEditRect,
  outputRect: ImageEditRect,
  transform: readonly number[],
): Float32PremultipliedRgbaTile {
  if (tile.width !== sourceRect.width || tile.height !== sourceRect.height) {
    throw new Error('仿射采样的 RGBA 瓦片与源区域尺寸不一致')
  }
  return createFloat32PremultipliedRgbaTile(
    outputRect.width,
    outputRect.height,
    tile.colorDomain,
    resampleAffine(
      tile.data,
      tile.width,
      tile.height,
      sourceRect,
      outputRect,
      transform,
      4,
    ),
    tile.workingSpace,
    tile.transferFunction,
    tile.referenceWhiteNits,
  )
}

export function resampleImageEditMaskAffineV3(
  tile: Float32MaskTile,
  sourceRect: ImageEditRect,
  outputRect: ImageEditRect,
  transform: readonly number[],
): Float32MaskTile {
  if (tile.width !== sourceRect.width || tile.height !== sourceRect.height) {
    throw new Error('仿射采样的蒙版瓦片与源区域尺寸不一致')
  }
  return createFloat32MaskTile(
    outputRect.width,
    outputRect.height,
    resampleAffine(
      tile.data,
      tile.width,
      tile.height,
      sourceRect,
      outputRect,
      transform,
      1,
    ),
  )
}

export function cropImageEditRgbaRegionV3(
  tile: Float32PremultipliedRgbaTile,
  sourceRect: ImageEditRect,
  outputRect: ImageEditRect,
): Float32PremultipliedRgbaTile {
  if (tile.width !== sourceRect.width || tile.height !== sourceRect.height) {
    throw new Error('裁剪的 RGBA 瓦片与源区域尺寸不一致')
  }
  const offsetX = outputRect.x - sourceRect.x
  const offsetY = outputRect.y - sourceRect.y
  if (offsetX < 0 || offsetY < 0
    || offsetX + outputRect.width > tile.width
    || offsetY + outputRect.height > tile.height) {
    throw new Error('RGBA 裁剪区域超出源瓦片')
  }
  const data = new Float32Array(outputRect.width * outputRect.height * 4)
  for (let y = 0; y < outputRect.height; y += 1) {
    const start = ((offsetY + y) * tile.width + offsetX) * 4
    data.set(tile.data.subarray(start, start + outputRect.width * 4), y * outputRect.width * 4)
  }
  return createFloat32PremultipliedRgbaTile(
    outputRect.width,
    outputRect.height,
    tile.colorDomain,
    data,
    tile.workingSpace,
    tile.transferFunction,
    tile.referenceWhiteNits,
  )
}
