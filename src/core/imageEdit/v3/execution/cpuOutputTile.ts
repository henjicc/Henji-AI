import { convertFloat32TileColorDomainV3, convertFloat32TileWorkingSpaceV3, encodeTransferFunctionV3, decodeSrgbExtended, encodeSrgbExtended } from './tileColor'
import { cropImageEditRgbaRegionV3 } from './affineTransform'
import { createFloat32PremultipliedRgbaTile, type Float32PremultipliedRgbaTile } from '../effects/contracts'
import type { ImageEditRect } from '../tileGeometry'
import { mapImageEditOutputPixelToSourceV3, type ImageEditOutputGeometryV3 } from '../outputGeometry'
import type { ImageEditTransferFunctionV3, ImageEditWorkingSpaceV3 } from '../colorTypes'

export interface ImageEditCpuOutputDescriptionV3 {
  width?: number
  height?: number
  sampleFormat?: 'uint' | 'float'
  bitDepth: 8 | 16 | 32
  colorSpace: ImageEditWorkingSpaceV3
  transferFunction: ImageEditTransferFunctionV3
  alphaMode: 'straight' | 'premultiplied'
}
export interface ImageEditCpuOutputTileV3 extends ImageEditRect {
  rowStride: number
  pixels: Uint8Array
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

const SRGB8_THRESHOLDS = Float64Array.from({ length: 255 }, (_, index) => decodeSrgbExtended((index + .5) / 255))
const SRGB8_ESTIMATE = Uint8Array.from({ length: 65_536 }, (_, index) => Math.round(encodeSrgbExtended(index / 65_535) * 255))

/** 离散输出的精确阈值查表；临界点仍回到原公式，禁止近似 LUT 改变像素金样。 */
export function encodeSrgbUnorm8V3(value: number): number {
  if (!Number.isFinite(value)) throw new Error('导出颜色计算结果不是有限数')
  if (value <= 0) return 0
  if (value >= 1) return 255
  let code = SRGB8_ESTIMATE[Math.floor(value * 65_535)]
  while (code > 0 && value < SRGB8_THRESHOLDS[code - 1]) code--
  while (code < 255 && value >= SRGB8_THRESHOLDS[code]) code++
  if ((code > 0 && Math.abs(value - SRGB8_THRESHOLDS[code - 1]) < 1e-12)
    || (code < 255 && Math.abs(value - SRGB8_THRESHOLDS[code]) < 1e-12)) {
    return Math.round(clamp01(encodeSrgbExtended(value)) * 255)
  }
  return code
}

export function projectImageEditorV3RenderedRegionToOutput(
  rendered: Float32PremultipliedRgbaTile,
  region: ImageEditRect,
  outputRect: ImageEditRect,
  geometry: ImageEditOutputGeometryV3,
): Float32PremultipliedRgbaTile {
  if (rendered.width !== region.width || rendered.height !== region.height) {
    throw new Error('渲染结果与请求的源区域尺寸不一致')
  }
  if (geometry.rotate === 0 && !geometry.mirrored) {
    const mapped = { ...outputRect, x: outputRect.x + geometry.cropX, y: outputRect.y + geometry.cropY }
    if (mapped.x === region.x && mapped.y === region.y && mapped.width === region.width && mapped.height === region.height) return rendered
    return cropImageEditRgbaRegionV3(rendered, region, mapped)
  }
  const data = new Float32Array(outputRect.width * outputRect.height * 4)
  for (let y = 0; y < outputRect.height; y += 1) {
    for (let x = 0; x < outputRect.width; x += 1) {
      const [sourceX, sourceY] = mapImageEditOutputPixelToSourceV3(
        outputRect.x + x,
        outputRect.y + y,
        geometry,
      )
      const localX = sourceX - region.x
      const localY = sourceY - region.y
      if (localX < 0 || localY < 0 || localX >= region.width || localY >= region.height) {
        throw new Error('输出像素映射超出当前分块渲染区域')
      }
      const sourceOffset = (localY * rendered.width + localX) * 4
      const targetOffset = (y * outputRect.width + x) * 4
      for (let channel = 0; channel < 4; channel++) data[targetOffset + channel] = rendered.data[sourceOffset + channel]
    }
  }
  return createFloat32PremultipliedRgbaTile(
    outputRect.width,
    outputRect.height,
    rendered.colorDomain,
    data,
    rendered.workingSpace,
    rendered.transferFunction,
    rendered.referenceWhiteNits,
  )
}

function writeIntegerSample(
  output: Uint8Array,
  view: DataView,
  byteOffset: number,
  bitDepth: 8 | 16,
  value: number,
): void {
  if (bitDepth === 8) output[byteOffset] = Math.round(clamp01(value) * 255)
  else view.setUint16(byteOffset, Math.round(clamp01(value) * 65_535), true)
}

export function encodeImageEditorV3RenderedOutputTile(
  tile: Float32PremultipliedRgbaTile,
  outputRect: ImageEditRect,
  description: ImageEditCpuOutputDescriptionV3,
): ImageEditCpuOutputTileV3 {
  const linear = convertFloat32TileWorkingSpaceV3(
    convertFloat32TileColorDomainV3(tile, 'linear-light'),
    description.colorSpace,
  )
  const bytesPerChannel = description.bitDepth / 8
  const rowStride = tile.width * 4 * bytesPerChannel
  const output = new Uint8Array(rowStride * tile.height)
  const view = new DataView(output.buffer)
  if (description.bitDepth === 8 && description.transferFunction === 'srgb' && description.alphaMode === 'straight') {
    for (let offset = 0; offset < linear.data.length; offset += 4) {
      const alpha = clamp01(linear.data[offset + 3])
      output[offset] = encodeSrgbUnorm8V3(alpha > 0 ? linear.data[offset] / alpha : 0)
      output[offset + 1] = encodeSrgbUnorm8V3(alpha > 0 ? linear.data[offset + 1] / alpha : 0)
      output[offset + 2] = encodeSrgbUnorm8V3(alpha > 0 ? linear.data[offset + 2] / alpha : 0)
      output[offset + 3] = Math.round(alpha * 255)
    }
    return { ...outputRect, rowStride, pixels: output }
  }
  for (let pixel = 0; pixel < tile.width * tile.height; pixel += 1) {
    const sourceOffset = pixel * 4
    const byteOffset = pixel * 4 * bytesPerChannel
    const alpha = clamp01(linear.data[sourceOffset + 3])
    for (let channel = 0; channel < 3; channel += 1) {
      const straight = alpha > 0 ? linear.data[sourceOffset + channel] / alpha : 0
      const encoded = encodeTransferFunctionV3(
        straight,
        description.transferFunction,
        linear.referenceWhiteNits,
      )
      const sample = description.alphaMode === 'premultiplied' ? encoded * alpha : encoded
      if (!Number.isFinite(sample)) throw new Error('导出颜色计算结果不是有限数')
      if (description.bitDepth === 32) view.setFloat32(byteOffset + channel * 4, sample, true)
      else writeIntegerSample(output, view, byteOffset + channel * bytesPerChannel, description.bitDepth, sample)
    }
    if (description.bitDepth === 32) view.setFloat32(byteOffset + 12, alpha, true)
    else writeIntegerSample(output, view, byteOffset + 3 * bytesPerChannel, description.bitDepth, alpha)
  }
  return {
    x: outputRect.x,
    y: outputRect.y,
    width: outputRect.width,
    height: outputRect.height,
    rowStride,
    pixels: output,
  }
}
