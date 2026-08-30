import {
  createFloat32PremultipliedRgbaTile,
  type Float32PremultipliedRgbaTile,
} from '@/core/imageEdit/v3/effects'
import type { ImageEditDocumentV3, ImageEditRotationV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditorPreviewDimensionsV3 } from './previewPixelsV3'

function rotateAndMirror(
  source: Float32PremultipliedRgbaTile,
  mirrored: boolean,
  rotate: ImageEditRotationV3,
): Float32PremultipliedRgbaTile {
  const rotated = rotate === 90 || rotate === 270
  const width = rotated ? source.height : source.width
  const height = rotated ? source.width : source.height
  const data = new Float32Array(width * height * 4)
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const mirroredX = mirrored ? source.width - 1 - x : x
      const [outputX, outputY] = rotatePoint(
        mirroredX,
        y,
        source.width,
        source.height,
        rotate,
      )
      const sourceOffset = (y * source.width + x) * 4
      const outputOffset = (outputY * width + outputX) * 4
      data.set(source.data.subarray(sourceOffset, sourceOffset + 4), outputOffset)
    }
  }
  return createFloat32PremultipliedRgbaTile(
    width,
    height,
    source.colorDomain,
    data,
    source.workingSpace,
    source.transferFunction,
    source.referenceWhiteNits,
  )
}

function rotatePoint(
  x: number,
  y: number,
  width: number,
  height: number,
  rotate: ImageEditRotationV3,
): readonly [number, number] {
  if (rotate === 90) return [height - 1 - y, x]
  if (rotate === 180) return [width - 1 - x, height - 1 - y]
  if (rotate === 270) return [y, width - 1 - x]
  return [x, y]
}

function cropTile(
  source: Float32PremultipliedRgbaTile,
  x: number,
  y: number,
  width: number,
  height: number,
): Float32PremultipliedRgbaTile {
  const left = Math.max(0, Math.min(source.width - 1, Math.floor(x)))
  const top = Math.max(0, Math.min(source.height - 1, Math.floor(y)))
  const right = Math.max(left + 1, Math.min(source.width, Math.ceil(x + width)))
  const bottom = Math.max(top + 1, Math.min(source.height, Math.ceil(y + height)))
  const outputWidth = right - left
  const outputHeight = bottom - top
  const data = new Float32Array(outputWidth * outputHeight * 4)
  for (let row = 0; row < outputHeight; row += 1) {
    const sourceStart = ((top + row) * source.width + left) * 4
    const sourceEnd = sourceStart + outputWidth * 4
    data.set(source.data.subarray(sourceStart, sourceEnd), row * outputWidth * 4)
  }
  return createFloat32PremultipliedRgbaTile(
    outputWidth,
    outputHeight,
    source.colorDomain,
    data,
    source.workingSpace,
    source.transferFunction,
    source.referenceWhiteNits,
  )
}

/** 文档输出几何在图层求值之后执行，不会让裁剪失效底层渲染缓存。 */
export function applyImageEditorPreviewGeometryV3(
  tile: Float32PremultipliedRgbaTile,
  document: ImageEditDocumentV3,
  dimensions: ImageEditorPreviewDimensionsV3,
): Float32PremultipliedRgbaTile {
  const oriented = rotateAndMirror(
    tile,
    document.geometry.orientation.mirrored,
    document.geometry.orientation.rotate,
  )
  const crop = document.geometry.crop
  if (!crop) return oriented
  const rotated = document.geometry.orientation.rotate === 90
    || document.geometry.orientation.rotate === 270
  const scaleX = rotated ? dimensions.scaleY : dimensions.scaleX
  const scaleY = rotated ? dimensions.scaleX : dimensions.scaleY
  return cropTile(
    oriented,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
  )
}
